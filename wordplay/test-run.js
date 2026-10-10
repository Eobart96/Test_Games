/* Автотест логики WordPlay в jsdom */
const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = `<!DOCTYPE html><html><body><div id="app"></div></body></html>`;
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
const w = dom.window;

// заглушки
w.confetti = () => {};
w.speechSynthesis = undefined;
w.AudioContext = undefined;
w.webkitAudioContext = undefined;

function loadScript(file) {
  const code = fs.readFileSync(`/workspace/wordplay/${file}`, "utf8");
  const s = w.document.createElement("script");
  s.textContent = code;
  w.document.body.appendChild(s);
}
loadScript("data.js");
loadScript("app.js");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}
function click(el) { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }
function $$(sel) { return [...w.document.querySelectorAll(sel)]; }
function $(sel) { return w.document.querySelector(sel); }

// ускорить таймеры: переопределяем setTimeout на немедленный для >500мс? Проще — промис-тик с реальными таймерами сократим: патчим через eval
w.eval(`
  const _origST = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms) => _origST(fn, Math.min(ms || 0, 5));
`);

async function wait(ms = 30) { await new Promise(r => setTimeout(r, ms)); }

(async () => {
  // дождёмся DOMContentLoaded renderHome
  await wait(50);

  check("home rendered", !!$(".hero-card"));
  check("settings row present (round length + tiles)", $$(".settings-row .level-btn").length === 6);

  // выбрать режим pic2word, старт
  click($('[data-action="pick-mode"][data-mode="pic2word"]'));
  await wait();
  click($('[data-action="start-game"]'));
  await wait();
  check("game screen rendered", !!$(".board") && $$(".tile").length >= 4);
  check("hearts shown", $$(".heart").length === 5);

  // прочитать текущее слово и ответить правильно
  const game = w.eval("game");
  const wordDisplay = w.eval("normalize(game.queue[game.index].display)");
  let tile = $$(".tile").find(t => w.eval("normalize")(t.dataset.answer) === wordDisplay);
  check("correct tile exists on board", !!tile);
  click(tile);
  await wait(50);
  check("XP awarded after correct answer", w.eval("state.xp") > 0);
  check("SRS recorded for correct word", Object.keys(w.eval("state.srs")).length === 1);

  // теперь отвечаем неправильно несколько раз → hearts должны кончиться
  let guard = 0;
  while (w.eval("game.hearts") > 0 && guard < 20) {
    guard++;
    const cur = w.eval("normalize(game.queue[game.index] ? game.queue[game.index].display : '')");
    const wrongTile = $$(".tile").find(t => t.classList.contains("disabled") === false && w.eval("normalize")(t.dataset.answer) !== cur);
    if (!wrongTile) break;
    click(wrongTile);
    await wait(60);
  }
  check("out of hearts → results screen with 💔", !!$(".result-card") && $(".result-medal").textContent.includes("💔"));
  check("practice-wrong button appears", !!$('[data-action="practice-wrong"]'));

  // кнопка повторения ошибок
  click($('[data-action="practice-wrong"]'));
  await wait();
  check("practice mode started", !!$(".board") || !!$(".keypad"));

  // настройки: tiles=4
  click($('[data-action="quit-game"]'));
  await wait();
  click($('[data-action="pick-tiles"][data-tiles="4"]'));
  await wait();
  check("tilesCount saved = 4", w.eval("state.tilesCount") === 4);
  click($('[data-action="pick-length"][data-len="0"]'));
  await wait();
  check("roundLength saved = 0 (endless)", w.eval("state.roundLength") === 0);

  // бесконечный раунд: старт, 6 правильных ответов подряд — игра не заканчивается экраном результатов
  click($('[data-action="start-game"]'));
  await wait();
  for (let i = 0; i < 6; i++) {
    const cur = w.eval("normalize(game.queue[game.index].display)");
    const t = $$(".tile").find(x => w.eval("normalize")(x.dataset.answer) === cur);
    if (!t) { fail++; console.log("FAIL: endless queue tile missing at", i); break; }
    click(t);
    await wait(60);
  }
  check("endless mode still in game after 6 rounds", !!$(".board") && !$(".result-card"));
  check("endless queue grew beyond initial", w.eval("game.queue.length") >= 6);

  // дедуп в колоде: чистый DOM без лишних кнопок (в тесте таймеры ускорены, поэтому
  // отложенные nextRound уже перерисовали app — вставляем кнопку и кликаем синхронно)
  const appEl = w.document.getElementById("app");
  appEl.innerHTML = '<button data-action="open-deck"></button>';
  click($('[data-action="open-deck"]'));
  console.log("DEBUG modal sync:", !!$(".modal-backdrop"));
  $("#inp-sk").value = "testovacie";
  $("#inp-ru").value = "тестовое";
  $("#inp-emoji").value = "🧪";
  click($('[data-action="add-word"]'));
  await wait();
  check("custom word added", w.eval("state.customDeck.length") === 1);
  // дубликат: снова открываем модалку (после addWord она пересоздана)
  if (!$(".modal-backdrop")) {
    appEl.insertAdjacentHTML("beforeend", ""); // noop
    w.eval("renderDeckModal()");
  }
  $("#inp-sk").value = "Testovacie"; // дубликат с другим регистром
  click($('[data-action="add-word"]'));
  await wait();
  check("duplicate custom word rejected", w.eval("state.customDeck.length") === 1);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST CRASH:", e); process.exit(2); });
