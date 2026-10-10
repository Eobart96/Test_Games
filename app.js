/* ============================================================
   WordPlay — логика игры (Vanilla JS)
   Режимы:
   1. "pic2word"  — картинка → выбери слово на плитке
   2. "word2pic"  — слово → выбери картинку на плитке
   3. "build"     — собери слово по буквам (плитки-буквы)
   + свои колоды слов (localStorage), streak, очки, озвучка sk-SK
   ============================================================ */

// ---------- Утилиты ----------
const $ = (sel, root = document) => root.querySelector(sel);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sample = (arr, n) => shuffle(arr).slice(0, n);
const normalize = (s) => s.toLowerCase().trim().replace(/\s+/g, " ");

// ---------- Состояние / localStorage ----------
const LS_KEY = "wordplay_state_v1";
const defaultState = {
  xp: 0,
  bestStreak: 0,
  gamesPlayed: 0,
  customDeck: [], // {id, sk, ru, emoji}
  sound: true,
};
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...defaultState };
    return { ...defaultState, ...JSON.parse(raw) };
  } catch (e) {
    return { ...defaultState };
  }
}
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}

// ---------- Звук (WebAudio, без файлов) ----------
let audioCtx = null;
function beep(type = "correct") {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = {
      correct: [[660, 0], [880, 0.09]],
      wrong: [[220, 0], [180, 0.12]],
      finish: [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3]],
      click: [[440, 0]],
    };
    (notes[type] || []).forEach(([freq, t]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type === "wrong" ? "sawtooth" : "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + t);
      osc.stop(audioCtx.currentTime + t + 0.25);
    });
  } catch (e) {}
}

// ---------- Озвучка словацкого ----------
function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance !== "function") return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "sk-SK";
    u.rate = 0.85;
    const voices = synth.getVoices ? synth.getVoices() : [];
    const skVoice = voices.find(v => v.lang && v.lang.startsWith("sk"));
    if (skVoice) u.voice = skVoice;
    synth.speak(u);
  } catch (e) {}
}

// ---------- Конфетти ----------
function celebrate(big = false) {
  if (typeof confetti !== "function") return;
  confetti({ particleCount: big ? 160 : 70, spread: big ? 100 : 60, origin: { y: 0.6 }, colors: ["#FF6B5B", "#FFC145", "#7ED9B6", "#0E6B75", "#9B5DE5"] });
  if (big) setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 70, origin: { x: 0 } }), 250);
  if (big) setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 70, origin: { x: 1 } }), 400);
}

// ---------- Игровое состояние (не сохраняется) ----------
const game = {
  mode: "pic2word",
  category: "all",
  level: 0,          // 0 = все уровни
  useCustom: false,
  queue: [],         // слова раунда
  index: 0,
  score: 0,
  streak: 0,
  correctCount: 0,
  totalRounds: 8,
  locked: false,
  builtLetters: [],  // для режима build
};

// ---------- Получение пула слов ----------
function getPool() {
  let pool;
  if (game.useCustom) {
    pool = state.customDeck.map(w => ({ ...w, cat: "custom", level: 1, display: w.sk }));
  } else {
    pool = WORDS.filter(w => {
      if (game.category !== "all" && w.cat !== game.category) return false;
      if (game.level !== 0 && w.level !== game.level) return false;
      return true;
    });
  }
  return pool;
}

// дедупликация по display, чтобы плитки не повторялись
function uniqueByDisplay(pool) {
  const seen = new Set();
  return pool.filter(w => {
    const k = normalize(w.display);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- Рендер: каркас ----------
const app = $("#app");

function renderTopbar(showHud = true) {
  return `
    <header class="topbar">
      <div class="brand" data-action="home" style="cursor:pointer">
        <div class="brand-logo">🎲</div>
        <div>
          <div class="brand-name">WordPlay</div>
          <div class="brand-sub">slovenčina hrou · словацкий с игрой</div>
        </div>
      </div>
      ${showHud ? `
      <div class="hud">
        <div class="chip"><span class="ico">⭐</span><span>${state.xp} XP</span></div>
        <div class="chip chip-streak ${state.bestStreak >= 5 ? "hot" : ""}"><span class="ico">🔥</span><span>${state.bestStreak}</span></div>
        <button class="icon-btn" data-action="toggle-sound" title="Звук">${state.sound ? "🔊" : "🔇"}</button>
        <button class="icon-btn" data-action="open-deck" title="Свои слова">🗂️</button>
      </div>` : ""}
    </header>`;
}

// ---------- Экран: Home ----------
function renderHome() {
  const cats = [{ id: "all", label: "🌈 Všetko / Все темы", color: "var(--teal)" }]
    .concat(Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, color: c.color })));

  const customCount = state.customDeck.length;

  app.innerHTML = `
    ${renderTopbar()}
    <main class="home">
      <div class="float-tile" style="top:6%; left:4%;">🧩</div>
      <div class="float-tile" style="top:12%; right:6%; animation-delay:1.4s;">🃏</div>
      <div class="float-tile" style="bottom:10%; left:8%; animation-delay:2.2s;">🎯</div>
      <div class="float-tile" style="bottom:16%; right:5%; animation-delay:0.8s;">✨</div>

      <section class="hero-card">
        <h1 class="hero-title">Uč sa slovenčinu <em>hrou!</em><br/>Учи словацкий плитками 🧱</h1>
        <p class="hero-desc">Слово ↔ картинка. Выбирай режим, тему и сложность — и вперёд. За серию правильных ответов дают бонусные XP.</p>
        <div class="hero-emoji-row">🐶 🍞 ☀️ 🚗 🎨 ⚽</div>

        <div class="section-label">1 · Vyber režim / Режим</div>
        <div class="mode-grid">
          ${[
            { id: "pic2word", ico: "🖼️", name: "Obrázok → slovo", hint: "Показываем картинку — ты ищешь слово среди плиток" },
            { id: "word2pic", ico: "🔤", name: "Slovo → obrázok", hint: "Показываем слово — выбирай подходящую картинку-плитку" },
            { id: "build", ico: "🧩", name: "Poskladaj slovo", hint: "Собери слово по буквам из плиток-букв (со словарём акцентов)" },
          ].map(m => `
            <button class="mode-card ${game.mode === m.id ? "selected" : ""}" data-action="pick-mode" data-mode="${m.id}">
              <div class="mode-ico">${m.ico}</div>
              <div class="mode-name">${m.name}</div>
              <div class="mode-hint">${m.hint}</div>
            </button>`).join("")}
        </div>

        <div class="section-label">2 · Téma / Тема</div>
        <div class="cat-grid">
          ${cats.map(c => `
            <button class="cat-pill ${game.category === c.id ? "selected" : ""}"
                    data-action="pick-cat" data-cat="${c.id}"
                    style="${game.category === c.id ? `background:${c.color}` : ""}">${c.label}</button>`).join("")}
        </div>

        <div class="section-label">3 · Obťažnosť / Сложность</div>
        <div class="level-row">
          ${[
            { lv: 0, label: "🎒 Všetky / все" },
            { lv: 1, label: "🌱 Začiatočník · A1" },
            { lv: 2, label: "🌿 Stredne · A2-B1" },
            { lv: 3, label: "🌳 Pokročilejšie · B1+" },
          ].map(l => `
            <button class="level-btn ${game.level === l.lv ? "selected" : ""}" data-action="pick-level" data-level="${l.lv}">${l.label}</button>`).join("")}
        </div>

        <div class="cta-row">
          <button class="btn-primary" data-action="start-game">▶ Hrať! Играть</button>
          ${customCount > 0 ? `<button class="btn-secondary" data-action="toggle-custom">
            ${game.useCustom ? "✅" : "⬜"} Moja karta · Мои слова (${customCount})</button>` : ""}
          <button class="btn-secondary" data-action="open-deck">➕ Pridať slová / Добавить слова</button>
        </div>
      </section>
      <div class="footer-note">WordPlay · ${WORDS.length} slov v databáze · ${customCount} vlastných</div>
    </main>`;
}

// ---------- Старт игры ----------
function startGame() {
  const pool = uniqueByDisplay(getPool());
  if (pool.length < 4) {
    showToast("❌ Málo slov v tejto téme! Выбери другую тему или добавь свои слова.", "bad");
    return;
  }
  game.totalRounds = Math.min(8, pool.length);
  game.queue = sample(pool, game.totalRounds);
  game.index = 0;
  game.score = 0;
  game.streak = 0;
  game.correctCount = 0;
  game.locked = false;
  state.gamesPlayed++;
  saveState();
  renderGame();
}

// ---------- Экран: Игра ----------
function renderGame() {
  const word = game.queue[game.index];
  const pool = uniqueByDisplay(getPool()).filter(w => normalize(w.display) !== normalize(word.display));

  const progressPct = Math.round((game.index / game.totalRounds) * 100);

  let stageHTML = "";

  if (game.mode === "build") {
    stageHTML = buildStage(word);
  } else {
    const tilesCount = Math.min(6, Math.max(4, pool.length));
    const options = sample(pool, tilesCount - 1);
    const tiles = shuffle([word, ...options]);

    stageHTML = `
      <div class="prompt-card">
        ${game.mode === "pic2word"
          ? `<div class="prompt-emoji">${word.emoji}</div>
             <div class="hint-caption">Aké je to slovo? · Что это за слово?</div>`
          : `<div class="prompt-word">${word.display}</div>
             <div class="prompt-trans">${word.ru}</div>
             <button class="speak-btn" data-action="speak" data-word="${escAttr(word.display)}">🔈</button>
             <div class="hint-caption">Vyber správny obrázok · Выбери нужную картинку</div>`}
      </div>
      <div class="board">
        ${tiles.map((t, i) => `
          <button class="tile" data-action="pick-tile" data-id="${i}"
                  data-answer="${escAttr(t.display)}">
            ${game.mode === "pic2word"
              ? `<div class="tile-word">${t.display}</div>`
              : `<div class="tile-emoji">${t.emoji}</div>`}
          </button>`).join("")}
      </div>`;
  }

  app.innerHTML = `
    ${renderTopbar()}
    <main class="game-wrap">
      <div class="round-info">
        <span>Kolo ${game.index + 1} / ${game.totalRounds}</span>
        <span>🏆 ${game.score} b · 🔥 ${game.streak}</span>
        <button class="mini-btn" data-action="quit-game">✕ Koniec</button>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${progressPct}%"></div></div>
      <section class="stage">${stageHTML}</section>
    </main>`;

  if (game.mode === "pic2word") {
    // подсказка звуком не нужна сразу
  }
}

function escAttr(s) { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

// ---------- Режим "поскладaj slovo" ----------
const SK_ALPHABET = ["a","á","ä","b","c","č","d","ď","dz","dž","e","é","f","g","h","ch","i","í","j","k","l","ĺ","ľ","m","n","ň","o","ô","p","r","ŕ","s","š","t","ť","u","v","y","ý","z","ž"];

function buildStage(word) {
  const target = normalize(word.display);
  const letters = target.split(""); // включая пробелы
  const needed = {};
  letters.forEach(ch => { if (ch !== " ") needed[ch] = (needed[ch] || 0) + 1; });

  // клавиатура: все буквы целевого слова + случайные из алфавита
  const extra = sample(SK_ALPHABET.filter(l => !needed[l]), 6);
  const keys = shuffle(Object.keys(needed).concat(extra)).filter(k => k !== " ");

  game.builtLetters = game.builtLetters || [];
  game.buildKeys = game.buildKeys || keys;
  game.buildNeeded = game.buildNeeded || needed;
  game.buildTarget = game.buildTarget || word;

  const usedCount = {};
  game.builtLetters.forEach(ch => { usedCount[ch] = (usedCount[ch] || 0) + 1; });

  const slots = letters.map((ch, i) => {
    if (ch === " ") return `<div class="slot" style="border:none;background:transparent;width:20px"></div>`;
    const filled = i < game.builtLetters.length;
    const shown = filled ? game.builtLetters[i] : "";
    return `<div class="slot ${filled ? "filled" : ""}">${shown}</div>`;
  }).join("");

  const keypad = game.buildKeys.map(k => {
    const total = needed[k] || 0;
    const used = usedCount[k] || 0;
    const disabled = total === 0 || used >= total;
    return `<button class="key" data-action="type-letter" data-letter="${k}" ${disabled ? "disabled" : ""}>${k}</button>`;
  }).join("");

  return `
    <div class="prompt-card">
      <div class="prompt-emoji">${word.emoji}</div>
      <div class="prompt-trans">${word.ru}</div>
      <div class="hint-caption">Poskladaj slovo po písmenách · Собери слово по буквам</div>
    </div>
    <div class="word-slots">${slots}</div>
    <div class="keypad">
      ${keypad}
      <button class="key delete" data-action="del-letter">⌫</button>
    </div>`;
}

function handleTypeLetter(letter) {
  const word = game.buildTarget;
  const target = normalize(word.display).split("");
  if (game.builtLetters.length >= target.filter(c => c !== " ").length) return;

  // найти следующую нужную позицию (пропуская пробелы автоматически)
  const pos = game.builtLetters.length;
  let expected = null;
  let idx = 0;
  for (let i = 0; i < target.length; i++) {
    if (target[i] === " ") continue;
    if (idx === pos) { expected = target[i]; break; }
    idx++;
  }

  if (letter === expected) {
    game.builtLetters.push(letter);
    beep("click");
    renderGame();
    // проверка завершения
    const letterCount = target.filter(c => c !== " ").length;
    if (game.builtLetters.length === letterCount) {
      finishRound(true, word);
    }
  } else {
    const tile = $(".keypad");
    if (tile) { tile.style.animation = "shake 0.4s ease"; setTimeout(() => tile.style.animation = "", 450); }
    beep("wrong");
    game.streak = 0;
    showToast(`❌ Nie je to «${letter}». Не та буква!`, "bad");
    renderGame();
  }
}

function handleDeleteLetter() {
  if (game.builtLetters.length > 0) {
    game.builtLetters.pop();
    beep("click");
    renderGame();
  }
}

// ---------- Ответ на плитку ----------
function handlePickTile(el) {
  if (game.locked) return;
  game.locked = true;
  const word = game.queue[game.index];
  const chosen = el.dataset.answer;
  const isCorrect = normalize(chosen) === normalize(word.display);

  if (isCorrect) {
    el.classList.add("correct");
    finishRound(true, word);
  } else {
    el.classList.add("wrong");
    beep("wrong");
    game.streak = 0;
    showToast(`❌ Správne je: «${word.display}»`, "bad");
    // подсветить правильный
    setTimeout(() => {
      document.querySelectorAll(".tile").forEach(t => {
        if (normalize(t.dataset.answer) === normalize(word.display)) t.classList.add("correct");
        else t.classList.add("disabled");
      });
    }, 300);
    setTimeout(nextRound, 1600);
  }
}

function finishRound(correct, word) {
  if (correct) {
    game.correctCount++;
    game.streak++;
    const bonus = Math.min(game.streak - 1, 5) * 2;
    game.score += 10 + bonus;
    state.xp += 10 + bonus;
    state.bestStreak = Math.max(state.bestStreak, game.streak);
    saveState();
    beep("correct");
    celebrate(false);
    speak(word.display);
    showToast(streakMsg(game.streak, word), "good");
    setTimeout(nextRound, 1300);
  }
}

function streakMsg(streak, word) {
  if (streak >= 5) return `🔥 SPLNKA! ×${streak} — Super!`;
  if (streak >= 3) return `✅ ✅ ✅ Výborne! Серия ${streak}!`;
  return `✅ Správne! «${word.display}» = ${word.ru}`;
}

function nextRound() {
  game.locked = false;
  game.builtLetters = [];
  game.buildKeys = null;
  game.buildNeeded = null;
  game.buildTarget = null;
  game.index++;
  if (game.index >= game.totalRounds) {
    renderResults();
  } else {
    renderGame();
  }
}

// ---------- Экран: Результаты ----------
function renderResults() {
  const pct = Math.round((game.correctCount / game.totalRounds) * 100);
  const medal = pct === 100 ? "🏆" : pct >= 75 ? "🥇" : pct >= 50 ? "🥈" : "🎖️";
  const title = pct === 100 ? "Perfektné! Идеально!" : pct >= 75 ? "Výborná práca! Отличная работа!" : pct >= 50 ? "Dobré! Неплохо!" : "Skús znova! Попробуй ещё!";

  const learnedWords = game.queue.slice(0, game.totalRounds).map(w => `${w.emoji} ${w.display}`);

  app.innerHTML = `
    ${renderTopbar()}
    <main class="results">
      <section class="result-card">
        <div class="result-medal">${medal}</div>
        <h2 class="result-title">${title}</h2>
        <div class="result-stats">
          <div class="stat-box"><div class="stat-num">${game.correctCount}/${game.totalRounds}</div><div class="stat-label">Správne / верно</div></div>
          <div class="stat-box"><div class="stat-num">${game.score}</div><div class="stat-label">Body / очки</div></div>
          <div class="stat-box"><div class="stat-num">+${game.score}</div><div class="stat-label">XP celkom ${state.xp}</div></div>
        </div>
        <div class="learned-list">${learnedWords.map(w => `<span class="learned-item">${w}</span>`).join("")}</div>
        <div class="cta-row" style="justify-content:center">
          <button class="btn-primary" data-action="again">🔁 Hrať znova / Ещё раз</button>
          <button class="btn-secondary" data-action="home">🏠 Domov / Меню</button>
        </div>
      </section>
    </main>`;

  beep("finish");
  if (pct >= 75) celebrate(true);
}

// ---------- Модалка: своя колода ----------
function renderDeckModal() {
  const deck = state.customDeck;
  app.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" data-action="close-modal-bg">
      <div class="modal" onclick="event.stopPropagation()">
        <h2>🗂️ Moja karta slov</h2>
        <p class="sub">Добавляй свои слова — и играй ими как плитками. Данные хранятся в твоём браузере.</p>

        <div class="form-row"><label>Slovenské slovo *</label><input id="inp-sk" placeholder="napr. mačka" /></div>
        <div class="form-row"><label>Перевод (рус.)</label><input id="inp-ru" placeholder="напр. кошка" /></div>
        <div class="form-row"><label>Emoji-obrázok 🖼️</label><input id="inp-emoji" placeholder="напр. 🐱" maxlength="4" /></div>

        <div class="deck-list">
          ${deck.length === 0
            ? `<div class="empty-note">Zatiaľ žiadne vlastné slová · Пока пусто</div>`
            : deck.map(d => `
              <div class="deck-item">
                <div><span class="d-word">${d.emoji} ${d.sk}</span> <span style="color:var(--ink-soft)">— ${d.ru || "?"}</span></div>
                <button class="mini-btn danger" data-action="del-word" data-id="${d.id}">✕</button>
              </div>`).join("")}
        </div>

        <div class="modal-actions">
          <button class="btn-primary" style="font-size:17px;padding:12px 26px" data-action="add-word">➕ Pridať / Добавить</button>
          <button class="btn-secondary" data-action="close-modal">Hotovo ✓</button>
        </div>
      </div>
    </div>`);
}

function addWord() {
  const sk = $("#inp-sk").value.trim();
  const ru = $("#inp-ru").value.trim();
  const emoji = $("#inp-emoji").value.trim() || "🔤";
  if (!sk) { showToast("⚠️ Zadaj slovenské slovo! Нужно слово!", "bad"); return; }
  state.customDeck.push({ id: Date.now(), sk, ru, emoji });
  saveState();
  beep("correct");
  closeModal();
  renderDeckModal();
  showToast(`✅ «${sk}» pridané · добавлено`, "good");
}

function delWord(id) {
  state.customDeck = state.customDeck.filter(d => d.id != id);
  saveState();
  closeModal();
  renderDeckModal();
}

function closeModal() {
  const bg = $(".modal-backdrop");
  if (bg) bg.remove();
}

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg, kind = "") {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------- Делегирование событий ----------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case "home": renderHome(); break;
    case "pick-mode": game.mode = el.dataset.mode; renderHome(); break;
    case "pick-cat": game.category = el.dataset.cat; renderHome(); break;
    case "pick-level": game.level = Number(el.dataset.level); renderHome(); break;
    case "toggle-custom": game.useCustom = !game.useCustom; renderHome(); break;
    case "start-game": startGame(); break;
    case "quit-game": renderHome(); break;
    case "pick-tile": handlePickTile(el); break;
    case "type-letter": handleTypeLetter(el.dataset.letter); break;
    case "del-letter": handleDeleteLetter(); break;
    case "speak": speak(el.dataset.word); break;
    case "toggle-sound": state.sound = !state.sound; saveState(); renderHome(); break;
    case "open-deck": renderDeckModal(); break;
    case "close-modal": case "close-modal-bg": closeModal(); renderHome(); break;
    case "add-word": addWord(); break;
    case "del-word": delWord(Number(el.dataset.id)); break;
    case "again": startGame(); break;
  }
});

// поддержка физической клавиатуры в режиме build
document.addEventListener("keydown", (e) => {
  if (game.mode !== "build" || !game.buildTarget) return;
  if ($(".modal-backdrop")) return;
  if (e.key === "Backspace") { handleDeleteLetter(); e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (game.buildKeys && game.buildKeys.includes(k)) {
    handleTypeLetter(k);
  }
});

// ---------- Старт ----------
window.addEventListener("DOMContentLoaded", () => {
  // подстраховка: app существует только после загрузки HTML
  const root = $("#app");
  if (root) renderHome();
});
