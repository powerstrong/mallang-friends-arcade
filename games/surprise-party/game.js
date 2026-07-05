/* game.js — 말랑 깜짝파티 오케스트레이터
 * 화면(로비/플레이/결과) · 라운드 루프 · HUD · 라이벌 스트립.
 * 판정은 마이크로게임 모듈 + rush-engine 이 담당하고, 여기서는 흐름만 잇는다.
 */
(function () {
  'use strict';

  var Engine = window.SurpriseRushEngine;
  var Games = window.SurpriseMicrogames;
  var boot = window.GameBoot || {};

  var $ = function (id) { return document.getElementById(id); };
  var ui = {
    lobby: $('lobbyScreen'), play: $('playScreen'), over: $('overScreen'),
    roomCodeBox: $('roomCodeBox'), roomCode: $('roomCode'),
    nameInput: $('nameInput'), charPicker: $('charPicker'),
    playerList: $('playerList'), ongoingHint: $('ongoingHint'),
    btnStart: $('btnStart'), btnExit: $('btnExit'),
    rivalStrip: $('rivalStrip'),
    hudLives: $('hudLives'), hudRound: $('hudRound'), hudScore: $('hudScore'),
    timerFill: $('timerFill'), stage: $('stage'),
    promptSplash: $('promptSplash'), promptIcon: $('promptIcon'),
    promptText: $('promptText'), promptHint: $('promptHint'),
    resultFlash: $('resultFlash'), countOverlay: $('countOverlay'),
    deadOverlay: $('deadOverlay'), deadText: $('deadText'),
    spectateText: $('spectateText'), btnSkipWait: $('btnSkipWait'),
    resultTitle: $('resultTitle'), finalRound: $('finalRound'),
    finalDetail: $('finalDetail'), finalRanking: $('finalRanking'),
    btnRestart: $('btnRestart'), btnExitOver: $('btnExitOver'),
  };

  var mp = window.SurprisePartyMP.create();
  var engine = null;
  var playing = false;
  var finished = false;
  var myFinal = null; // { round, score, bestCombo }
  var roundToken = 0; // 라운드 타이머 무효화용

  /* ── 이름 · 캐릭터 ─────────────────────────── */
  var storedName = '';
  try { storedName = localStorage.getItem('mallangName') || ''; } catch (e) {}
  ui.nameInput.value = boot.name || storedName || '';

  var chars = window.CHARACTERS || [];
  var myChar = null;
  try { myChar = localStorage.getItem('surprisePartyChar') || null; } catch (e) {}
  if (!chars.some(function (c) { return c.worldId === myChar; })) myChar = null;
  if (!myChar && chars.length) myChar = chars[0].worldId;

  function charOf(worldId) {
    return chars.find(function (c) { return c.worldId === worldId; }) || null;
  }
  function myName() {
    return (ui.nameInput.value || '').trim() || '말랑이';
  }

  function renderCharPicker() {
    ui.charPicker.innerHTML = '';
    chars.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'char-option' + (c.worldId === myChar ? ' is-selected' : '');
      b.style.backgroundImage = 'url(' + c.portrait + ')';
      b.title = c.label;
      b.addEventListener('click', function () {
        myChar = c.worldId;
        try { localStorage.setItem('surprisePartyChar', myChar); } catch (e) {}
        renderCharPicker();
      });
      ui.charPicker.appendChild(b);
    });
  }
  renderCharPicker();

  /* ── 멀티 연결 ─────────────────────────────── */
  function renderRoster(list) {
    ui.playerList.innerHTML = '';
    (list || []).forEach(function (p) {
      var li = document.createElement('li');
      li.textContent = p.name || '친구';
      ui.playerList.appendChild(li);
    });
  }

  if (mp.available) {
    mp.on('players', renderRoster);
    mp.on('start', function () {
      if (!playing && !finished) beginCountdown();
    });
    mp.on('snapshot', function () {
      // 로비에 있는데 누군가 이미 진행 중이면 힌트
      if (!playing && !finished) ui.ongoingHint.hidden = false;
      renderRivals();
      checkAllDead();
    });
    mp.on('change', function () { renderRivals(); checkAllDead(); });
    mp.connect(myName(), myChar).then(function (info) {
      ui.roomCode.textContent = info.code;
    }).catch(function () {
      ui.roomCode.textContent = '오프라인 연습 모드';
      renderRoster([{ name: myName() + ' (나)' }]);
    });
  } else {
    ui.roomCode.textContent = '오프라인 연습 모드';
    renderRoster([{ name: '나' }]);
  }

  /* ── 라이벌 스트립 ─────────────────────────── */
  function renderRivals() {
    var list = mp.remoteList();
    ui.rivalStrip.innerHTML = '';
    list.forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'rival' + (r.alive === false ? ' is-dead' : '');
      var av = document.createElement('span');
      av.className = 'rival-avatar';
      var c = charOf(r.char);
      if (c) av.style.backgroundImage = 'url(' + c.portrait + ')';
      else av.textContent = '🐾';
      var nm = document.createElement('span');
      nm.className = 'rival-name';
      nm.textContent = r.name || '친구';
      var st = document.createElement('span');
      st.className = 'rival-stat';
      st.textContent = r.alive === false
        ? '😵 R' + (r.round || 0)
        : '❤️' + (r.lives != null ? r.lives : '?') + ' R' + (r.round || 0);
      d.appendChild(av); d.appendChild(nm); d.appendChild(st);
      ui.rivalStrip.appendChild(d);
    });
  }

  /* ── 화면 전환 ─────────────────────────────── */
  function showScreen(el) {
    [ui.lobby, ui.play, ui.over].forEach(function (s) { s.classList.remove('is-active'); });
    el.classList.add('is-active');
  }

  /* ── 시작 흐름 ─────────────────────────────── */
  ui.btnStart.addEventListener('click', function () {
    try { localStorage.setItem('mallangName', myName()); } catch (e) {}
    if (mp.isMulti) mp.broadcastStart();
    beginCountdown();
  });
  ui.btnExit.addEventListener('click', function () { if (boot.exit) boot.exit(); });
  ui.btnExitOver.addEventListener('click', function () { if (boot.exit) boot.exit(); });
  ui.btnRestart.addEventListener('click', function () { window.location.reload(); });
  ui.btnSkipWait.addEventListener('click', function () { showResult(); });

  function beginCountdown() {
    if (playing) return;
    playing = true;
    var seed = mp.seedString() || ('solo-' + Math.random().toString(36).slice(2));
    engine = Engine.create({ seedString: seed, catalog: Games.catalog });
    showScreen(ui.play);
    updateHud(engine.getState());
    renderRivals();
    var n = 3;
    ui.countOverlay.hidden = false;
    ui.countOverlay.textContent = String(n);
    var iv = setInterval(function () {
      n -= 1;
      if (n > 0) { ui.countOverlay.textContent = String(n); return; }
      clearInterval(iv);
      ui.countOverlay.hidden = true;
      nextRound();
    }, 600);
  }

  /* ── HUD ──────────────────────────────────── */
  function updateHud(s) {
    var hearts = '';
    for (var i = 0; i < 3; i++) hearts += i < s.lives ? '❤️' : '🤍';
    ui.hudLives.textContent = hearts;
    ui.hudRound.textContent = 'R' + Math.max(1, s.round);
    ui.hudScore.textContent = String(s.score);
  }

  function sendSnap(force) {
    if (!mp.isMulti || !engine) return;
    var s = engine.getState();
    mp.sendSnapshot({
      round: s.round, lives: s.lives, score: s.score,
      alive: !s.dead, name: myName(), char: myChar,
    }, force);
  }

  /* ── 라운드 루프 ───────────────────────────── */
  function nextRound() {
    var spec = engine.nextRound();
    updateHud(engine.getState());
    sendSnap(true);
    var mod = Games.byId[spec.gameId];
    showSplash(spec, mod, function () { runMicrogame(spec, mod); });
  }

  function showSplash(spec, mod, done) {
    var splashMs = Math.max(420, 700 / spec.speed);
    function promptPhase() {
      ui.promptIcon.textContent = mod.icon;
      ui.promptText.textContent = mod.prompt;
      ui.promptText.classList.remove('is-speedup');
      ui.promptHint.textContent = mod.hint;
      ui.promptSplash.hidden = false;
      setTimeout(function () { ui.promptSplash.hidden = true; done(); }, splashMs);
    }
    if (spec.speedUp) {
      ui.promptIcon.textContent = '⚡';
      ui.promptText.textContent = '스피드 업!';
      ui.promptText.classList.add('is-speedup');
      ui.promptHint.textContent = '×' + spec.speed.toFixed(2);
      ui.promptSplash.hidden = false;
      setTimeout(promptPhase, 750);
    } else {
      promptPhase();
    }
  }

  function runMicrogame(spec, mod) {
    var token = ++roundToken;
    ui.stage.innerHTML = '';
    var resolved = false;
    var cleanup = null;
    var raf = null;
    var startTs = null;

    var rng = Engine.createRng(spec.roundSeed);
    function settle(success) {
      if (resolved || token !== roundToken) return;
      resolved = true;
      if (raf) cancelAnimationFrame(raf);
      if (cleanup) { try { cleanup(); } catch (e) {} }
      finishRound(success);
    }
    var ctx = {
      root: ui.stage,
      rng: rng,
      speed: spec.speed,
      durationMs: spec.durationMs,
      success: function () { settle(true); },
      fail: function () { settle(false); },
    };
    try {
      cleanup = mod.mount(ctx) || null;
    } catch (e) {
      // 모듈 오류 시 라운드를 성공 처리해 게임이 멈추지 않게 한다
      settle(true);
      return;
    }

    function frame(ts) {
      if (resolved || token !== roundToken) return;
      if (startTs === null) startTs = ts;
      var remain = 1 - (ts - startTs) / spec.durationMs;
      if (remain <= 0) {
        ui.timerFill.style.width = '0%';
        settle(!!mod.winOnTimeout);
        return;
      }
      ui.timerFill.style.width = (remain * 100) + '%';
      raf = requestAnimationFrame(frame);
    }
    ui.timerFill.style.width = '100%';
    raf = requestAnimationFrame(frame);
  }

  function finishRound(success) {
    var r = engine.reportResult(success);
    updateHud(engine.getState());
    ui.resultFlash.textContent = success ? '⭕' : '❌';
    ui.resultFlash.classList.toggle('is-fail', !success);
    ui.resultFlash.hidden = false;
    sendSnap(true);
    setTimeout(function () {
      ui.resultFlash.hidden = true;
      if (r.dead) handleDeath();
      else nextRound();
    }, success ? 480 : 650);
  }

  /* ── 사망 · 관전 · 결과 ────────────────────── */
  function handleDeath() {
    var s = engine.getState();
    myFinal = { round: s.round, score: s.score, bestCombo: s.bestCombo };
    if (boot.submitResult) boot.submitResult({ score: s.round, points: s.score });
    sendSnap(true);
    ui.stage.innerHTML = '';
    ui.deadText.textContent = '탈락! R' + s.round + ' · ' + s.score + '점';
    var anyAlive = mp.remoteList().some(function (r) { return r.alive !== false; });
    if (mp.isMulti && anyAlive) {
      ui.spectateText.textContent = '친구들이 아직 버티는 중... 👀';
      ui.deadOverlay.hidden = false;
    } else {
      ui.deadOverlay.hidden = false;
      ui.spectateText.textContent = '';
      setTimeout(showResult, 1100);
    }
  }

  function checkAllDead() {
    if (!myFinal || finished) return;
    var anyAlive = mp.remoteList().some(function (r) { return r.alive !== false; });
    if (!anyAlive) setTimeout(showResult, 900);
  }

  function showResult() {
    if (finished || !myFinal) return;
    finished = true;
    ui.deadOverlay.hidden = true;
    showScreen(ui.over);

    var entries = [{
      me: true, name: myName() + ' (나)',
      round: myFinal.round, score: myFinal.score,
    }];
    mp.remoteList().forEach(function (r) {
      entries.push({ me: false, name: r.name || '친구', round: r.round || 0, score: r.score || 0 });
    });
    entries.sort(function (a, b) { return (b.round - a.round) || (b.score - a.score); });

    var myRank = entries.findIndex(function (e) { return e.me; }) + 1;
    ui.resultTitle.textContent = entries.length > 1
      ? (myRank === 1 ? '🏆 1등!' : myRank + '등!')
      : '기록 달성!';
    ui.finalRound.textContent = 'R' + myFinal.round;
    ui.finalDetail.textContent = '점수 ' + myFinal.score + ' · 최고 콤보 ' + myFinal.bestCombo;

    ui.finalRanking.innerHTML = '';
    entries.forEach(function (e, i) {
      var li = document.createElement('li');
      if (e.me) li.className = 'is-me';
      var nm = document.createElement('span');
      nm.textContent = ['🥇', '🥈', '🥉'][i] ? ['🥇', '🥈', '🥉'][i] + ' ' + e.name : (i + 1) + '위 ' + e.name;
      var st = document.createElement('span');
      st.className = 'rank-stat';
      st.textContent = 'R' + e.round + ' · ' + e.score + '점';
      li.appendChild(nm); li.appendChild(st);
      ui.finalRanking.appendChild(li);
    });
  }

  // 페이지 이탈 시 relay 정리
  window.addEventListener('beforeunload', function () { mp.leave(); });

  // 검증용 디버그 핸들 (프리뷰 하니스 전용 — 게임 로직은 여기 의존 금지)
  window.__sp = {
    mp: mp,
    get engine() { return engine; },
    get playing() { return playing; },
    get finished() { return finished; },
    beginCountdown: beginCountdown,
    showResult: showResult,
  };
})();
