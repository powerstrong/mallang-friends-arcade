/* Mallang Stairs controller (plain window globals, no modules). */
(function () {
  'use strict';

  var Chars = window.MallangCharacters;
  var Engine = window.MallangStairsEngine;
  var Boot = window.GameBoot || { submitResult: function () {}, exit: function () {} };

  var STEP_DX = 72;
  var STEP_DY = 56;
  var POOL = 18;
  var DURATIONS = [60, 120, 180];
  var DEFAULT_DURATION = 180;
  var FALL_RESTART_MS = 620;

  var $ = function (id) { return document.getElementById(id); };
  var setupScreen = $('setupScreen'), playScreen = $('playScreen');
  var stage = $('stage'), stairLayer = $('stairLayer');
  var playerEl = $('player'), playerImg = $('playerImg');
  var hudTime = $('hudTime'), hudStep = $('hudStep'), hudBest = $('hudBest'),
      hudScore = $('hudScore'), hudCombo = $('hudCombo');
  var timeFill = $('timeFill'), feverFill = $('feverFill'), timeGauge = timeFill.parentElement;
  var rivalWrap = $('rivalWrap'), feverFx = $('feverFx'), floatLayer = $('floatLayer');
  var countdown = $('countdown'), countNum = $('countNum');
  var charIntro = $('charIntro'), introImg = $('introImg'), introName = $('introName'),
      introAbility = $('introAbility'), introTag = $('introTag');
  var resultOverlay = $('resultOverlay');
  var roomPanel = $('roomPanel'), roomCode = $('roomCode'), rosterList = $('rosterList'),
      roomStatus = $('roomStatus'), copyInvite = $('copyInvite');
  var startSoloBtn = $('startSolo'), startMultiBtn = $('startMulti'), multiNote = $('multiNote');

  var selectedId = 'mochi-rabbit';
  var activeChar = null;
  var engine = null;
  var mp = window.MallangStairsMP ? window.MallangStairsMP.create() : null;
  var playing = false;
  var lifeRestarting = false;
  var rafId = 0;
  var lastTs = 0;
  var camX = 0, camY = 0, camTX = 0, camTY = 0;
  var xCache = [0];
  var poolNodes = [];
  var shadowLayer = null;
  var shadowNodes = {};
  var rankRows = {};

  var isMulti = false;
  var connected = false;
  var connecting = false;
  var selectedDuration = DEFAULT_DURATION;
  var roundDurationMs = Infinity;
  var roundEndAt = Infinity;
  var roundSeed = 'solo';
  var currentRunId = null;
  var bestStep = 0;
  var bestScore = 0;
  var roundMaxCombo = 0;
  var roundPerfect = 0;
  var lastResult = null;
  var latestRoster = [];
  var remoteChars = {};
  var waitingForNext = false;

  function safeChar(id) {
    return Chars.get(id) || Chars.get('mochi-rabbit');
  }
  function playerName() {
    return (Boot.name || '말랑이').slice(0, 16);
  }
  function normalizeId(p) {
    return p && (p.playerId || p.id);
  }
  function myId() {
    return mp ? mp.myId : 'me';
  }
  function isHost() {
    return connected && latestRoster.length > 0 && normalizeId(latestRoster[0]) === myId();
  }
  function currentCharIdForRoom() {
    if (selectedId === 'random') {
      var picked = Chars.pickRandomId();
      selectChar(picked);
      return picked;
    }
    return safeChar(selectedId).id;
  }

  function stepX(i) {
    i = Math.max(0, Math.floor(i));
    while (xCache.length <= i) {
      var k = xCache.length;
      xCache.push(xCache[k - 1] + engine.dirAt(k) * STEP_DX);
    }
    return xCache[i];
  }
  function interpStepX(v) {
    var lo = Math.max(0, Math.floor(v));
    var hi = Math.max(lo, Math.ceil(v));
    if (lo === hi) return stepX(lo);
    return stepX(lo) + (stepX(hi) - stepX(lo)) * (v - lo);
  }
  function stepY(i) { return -i * STEP_DY; }
  function interpStepY(v) { return -v * STEP_DY; }
  function homeX() { return stage.clientWidth / 2; }
  function homeY() { return stage.clientHeight * 0.64; }
  function placePlayer() {
    playerEl.style.transform = 'translate3d(' + homeX() + 'px,' + homeY() + 'px,0)';
  }

  function buildCharPick() {
    var pick = $('charPick');
    pick.innerHTML = '';
    Chars.PUBLIC_LIST.forEach(function (c) {
      pick.appendChild(makeChip(c.id, c.assets.main, c.name, false));
    });
    pick.appendChild(makeChip('random', null, '랜덤', true));
    selectChar(validBootCharacter() || 'mochi-rabbit');
  }
  function validBootCharacter() {
    var raw = Boot.characterId || new URLSearchParams(window.location.search).get('characterId');
    if (!raw) return null;
    return Chars.get(raw) ? raw : null;
  }
  function makeChip(id, img, label, isRandom) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'char-chip' + (isRandom ? ' char-chip--random' : '');
    el.dataset.id = id;
    if (isRandom) {
      el.innerHTML = '<div class="char-chip__dice">🎲</div><span class="char-chip__label">랜덤</span>';
    } else {
      el.innerHTML = '<img src="' + img + '" alt="" draggable="false" />' +
        '<span class="char-chip__label">' + escapeHtml(label) + '</span>';
    }
    el.addEventListener('click', function () { selectChar(id); });
    return el;
  }
  function selectChar(id) {
    if (id !== 'random' && !Chars.get(id)) id = 'mochi-rabbit';
    selectedId = id;
    Array.prototype.forEach.call(document.querySelectorAll('.char-chip'), function (el) {
      el.classList.toggle('is-selected', el.dataset.id === id);
    });
    var setupImg = $('setupCharImg'), name = $('setupCharName'),
        role = $('setupCharRole'), ability = $('setupCharAbility');
    if (id === 'random') {
      setupImg.src = '';
      setupImg.style.visibility = 'hidden';
      name.textContent = '랜덤 친구';
      role.textContent = '누가 나올까?';
      ability.textContent = '숨은 친구까지 깜짝 등장할 수 있어요.';
    } else {
      var c = safeChar(id);
      setupImg.src = c.assets.main;
      setupImg.style.visibility = 'visible';
      name.textContent = c.name;
      role.textContent = c.role;
      ability.textContent = c.desc;
    }
    if (connected && mp) {
      mp.broadcastChar(currentCharIdForRoom(), playerName());
      renderRoomPanel();
    }
  }
  function resolveCharacter() {
    var id = selectedId === 'random' ? Chars.pickRandomId() : selectedId;
    return safeChar(id);
  }
  function preloadPoses(c) {
    Object.keys(c.assets).forEach(function (k) { var im = new Image(); im.src = c.assets[k]; });
  }

  function buildPool() {
    stairLayer.innerHTML = '';
    poolNodes = [];
    shadowNodes = {};
    for (var i = 0; i < POOL; i++) {
      var el = document.createElement('div');
      el.className = 'stair';
      el.innerHTML = '<span class="stair__booster"></span>';
      stairLayer.appendChild(el);
      poolNodes.push(el);
    }
    shadowLayer = document.createElement('div');
    shadowLayer.className = 'remote-layer';
    stairLayer.appendChild(shadowLayer);
  }
  function layoutStairs() {
    if (!engine) return;
    var pos = engine.getState().pos;
    var lo = Math.max(0, pos - 3);
    for (var n = 0; n < POOL; n++) {
      var idx = lo + n;
      var el = poolNodes[n];
      el.style.transform = 'translate3d(' + stepX(idx) + 'px,' + stepY(idx) + 'px,0)';
      el.classList.toggle('is-next', idx === pos + 1);
      var badge = el.firstChild;
      var b = idx > pos ? engine.boosterAt(idx) : null;
      badge.textContent = b ? boosterIcon(b) : '';
    }
  }
  function boosterIcon(t) {
    return t === 'speed' ? '⚡' : t === 'stable' ? '🛡️' : t === 'combo' ? '💫' : '⭐';
  }
  function show(screen) {
    setupScreen.classList.toggle('is-active', screen === 'setup');
    playScreen.classList.toggle('is-active', screen === 'play');
  }

  function beginRound(seedStr, durationSec, runId) {
    if (playing || lifeRestarting) return;
    isMulti = true;
    currentRunId = runId || makeRunId();
    // 방코드에 공유 runId를 섞어 라운드마다 계단 패턴이 달라진다(전원 동일 시드 유지).
    roundSeed = runId ? seedStr + ':' + runId : seedStr;
    roundDurationMs = Math.max(1, durationSec || selectedDuration) * 1000;
    bestStep = 0;
    bestScore = 0;
    roundMaxCombo = 0;
    roundPerfect = 0;
    lastResult = null;
    activeChar = resolveCharacter();
    preloadPoses(activeChar);
    createLifeEngine(false);
    resultOverlay.classList.add('is-hidden');
    feverFx.classList.remove('is-on');
    show('play');
    placePlayer();
    camX = camTX = homeX() - stepX(0);
    camY = camTY = homeY() - stepY(0);
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';
    layoutStairs();
    updateHud(engine.getState());
    var afterIntro = function () { runCountdown(); };
    if (selectedId === 'random') showIntro(activeChar, afterIntro);
    else afterIntro();
  }
  function startSolo() {
    if (playing || lifeRestarting) return;
    isMulti = false;
    currentRunId = null;
    roundSeed = String(Math.floor(Math.random() * 1e9));
    roundDurationMs = Infinity;
    bestStep = 0;
    bestScore = 0;
    roundMaxCombo = 0;
    roundPerfect = 0;
    activeChar = resolveCharacter();
    preloadPoses(activeChar);
    createLifeEngine(false);
    resultOverlay.classList.add('is-hidden');
    feverFx.classList.remove('is-on');
    show('play');
    placePlayer();
    camX = camTX = homeX() - stepX(0);
    camY = camTY = homeY() - stepY(0);
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';
    layoutStairs();
    updateHud(engine.getState());
    runCountdown();
  }
  function createLifeEngine(startNow) {
    engine = Engine.create({ seed: roundSeed, character: activeChar });
    xCache = [0];
    buildPool();
    playerImg.src = activeChar.assets.main;
    playerEl.classList.remove('is-dead');
    if (startNow) engine.start();
  }
  function showIntro(c, done) {
    introImg.src = c.assets.main;
    introName.textContent = c.name;
    introAbility.textContent = c.desc;
    introTag.textContent = c.secret ? '숨은 친구!' : '랜덤 등장!';
    charIntro.classList.remove('is-hidden');
    setTimeout(function () { charIntro.classList.add('is-hidden'); done(); }, 1500);
  }
  function runCountdown() {
    var n = 3;
    countNum.textContent = n;
    countdown.classList.remove('is-hidden');
    var iv = setInterval(function () {
      n--;
      if (n <= 0) {
        clearInterval(iv);
        countdown.classList.add('is-hidden');
        startPlay();
      } else {
        countNum.textContent = n;
        countNum.style.animation = 'none';
        void countNum.offsetWidth;
        countNum.style.animation = '';
      }
    }, 700);
  }
  function startPlay() {
    engine.start();
    playing = true;
    lifeRestarting = false;
    lastTs = 0;
    roundEndAt = Number.isFinite(roundDurationMs) ? performance.now() + roundDurationMs : Infinity;
    rafId = requestAnimationFrame(frame);
  }

  function doInput(dir) {
    if (!playing || lifeRestarting) return;
    var ev = engine.input(dir);
    if (!ev) return;
    flashTouch(dir);
    if (ev.dead) { onDeath(); return; }
    playerImg.src = dir < 0 ? activeChar.assets.left : activeChar.assets.right;
    hop();
    if (ev.grade) popFloat(ev.grade, ev.gain);
    if (ev.booster) popBooster(ev.booster);
    if (ev.fever && !feverFx.classList.contains('is-on')) enterFever();
    updateRoundBest(engine.getState());
    layoutStairs();
  }
  function hop() {
    playerImg.style.animation = 'none';
    void playerImg.offsetWidth;
    playerImg.style.animation = 'introHop .25s';
  }
  function flashTouch(dir) {
    var sel = dir < 0 ? '.touch-zones__side--left' : '.touch-zones__side--right';
    var z = document.querySelector(sel);
    if (!z) return;
    z.classList.add('is-hit');
    setTimeout(function () { z.classList.remove('is-hit'); }, 90);
  }
  function spawnFloat(text, cls, yOff) {
    var el = document.createElement('div');
    el.className = 'float-pop float-pop--' + cls;
    el.textContent = text;
    el.style.setProperty('--px', homeX() + 'px');
    el.style.setProperty('--py', (homeY() - yOff) + 'px');
    floatLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 700);
  }
  function popFloat(grade, gain) {
    var label = grade === 'perfect' ? 'PERFECT' : grade === 'good' ? 'GOOD' : '+';
    spawnFloat(label + ' ' + gain, grade, 70);
  }
  function popBooster(type) { spawnFloat(boosterIcon(type) + ' GET', 'good', 110); }
  function enterFever() {
    feverFx.classList.add('is-on');
    for (var i = 0; i < 6; i++) spawnStar();
  }
  function spawnStar() {
    var s = document.createElement('div');
    s.className = 'fever-star';
    s.textContent = '⭐';
    var sx = 20 + Math.random() * (stage.clientWidth - 40);
    var sy = stage.clientHeight * 0.5 + Math.random() * 60;
    s.style.setProperty('--px', sx + 'px');
    s.style.setProperty('--py', sy + 'px');
    feverFx.appendChild(s);
    setTimeout(function () { s.remove(); }, 1100);
  }

  function frame(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(64, ts - lastTs);
    lastTs = ts;
    if (Number.isFinite(roundEndAt) && performance.now() >= roundEndAt) {
      finishRound('time');
      return;
    }

    engine.tick(dt);
    var s = engine.getState();
    if (s.dead) { onDeath(); return; }

    camTX = homeX() - stepX(s.pos);
    camTY = homeY() - stepY(s.pos);
    camX += (camTX - camX) * 0.18;
    camY += (camTY - camY) * 0.18;
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';

    if (!s.feverActive && feverFx.classList.contains('is-on')) feverFx.classList.remove('is-on');
    if (s.feverActive && Math.random() < 0.3) spawnStar();

    updateRoundBest(s);
    updateHud(s);
    if (isMulti && mp) {
      sendSnapshot(s, false);
      renderRanking();
      renderShadows();
    }
    rafId = requestAnimationFrame(frame);
  }
  function updateRoundBest(s) {
    if (!s) return;
    if (s.pos > bestStep) {
      bestStep = s.pos;
      bestScore = s.score;
    } else if (s.pos === bestStep && s.score > bestScore) {
      bestScore = s.score;
    }
    if (s.maxCombo > roundMaxCombo) roundMaxCombo = s.maxCombo;
    if (s.perfectCount > roundPerfect) roundPerfect = s.perfectCount;
  }
  function remainingMs() {
    if (!Number.isFinite(roundEndAt)) return Infinity;
    return Math.max(0, roundEndAt - performance.now());
  }
  function updateHud(s) {
    hudStep.textContent = s.pos;
    hudBest.textContent = bestStep;
    hudScore.textContent = s.score;
    hudCombo.textContent = s.combo;
    timeFill.style.transform = 'scaleX(' + Math.max(0, s.gaugeRatio) + ')';
    feverFill.style.transform = 'scaleX(' + Math.min(1, s.feverRatio) + ')';
    timeGauge.classList.toggle('is-danger', s.gaugeRatio < 0.25);
    var left = remainingMs();
    if (Number.isFinite(left)) {
      hudTime.textContent = formatTime(left);
      hudTime.parentElement.classList.toggle('is-danger', left <= 10000);
    } else {
      hudTime.textContent = '--:--';
      hudTime.parentElement.classList.remove('is-danger');
    }
  }
  function formatTime(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function sendSnapshot(s, force) {
    if (!mp || !mp.isMulti) return;
    mp.sendSnapshot({
      step: s.pos,
      best: bestStep,
      score: bestScore,
      combo: s.combo,
      gaugeRatio: s.gaugeRatio,
      feverActive: s.feverActive,
      alive: !s.dead && playing,
      characterId: activeChar ? activeChar.id : selectedId,
      runId: currentRunId,
      running: playing || lifeRestarting,
      name: playerName(),
    }, force);
  }

  function renderRanking() {
    if (!isMulti || !mp) { rivalWrap.innerHTML = ''; return; }
    var rows = [{
      id: myId(), name: playerName(), best: bestStep, score: bestScore,
      alive: playing, me: true,
    }];
    mp.remoteList().forEach(function (r) {
      if (currentRunId && r.runId && r.runId !== currentRunId) return;
      rows.push({
        id: r.id, name: r.name || '친구', best: r.best || 0,
        score: r.score || 0, alive: r.alive !== false, me: false,
      });
    });
    rows.sort(function (a, b) { return (b.best - a.best) || (b.score - a.score); });
    var keep = {};
    rows.slice(0, 6).forEach(function (r, idx) {
      keep[r.id] = true;
      var row = rankRows[r.id];
      if (!row) {
        row = document.createElement('div');
        row.className = 'live-rank__row';
        row.innerHTML = '<span class="live-rank__place"></span><span class="live-rank__name"></span><span class="live-rank__score"></span>';
        rankRows[r.id] = row;
        rivalWrap.appendChild(row);
      }
      row.classList.toggle('is-me', !!r.me);
      row.classList.toggle('is-dead', r.alive === false);
      row.children[0].textContent = String(idx + 1);
      row.children[1].textContent = r.name;
      row.children[2].textContent = r.best + '층';
      if (row.parentElement !== rivalWrap) rivalWrap.appendChild(row);
    });
    Object.keys(rankRows).forEach(function (id) {
      if (!keep[id]) {
        rankRows[id].remove();
        delete rankRows[id];
      }
    });
  }
  function renderShadows() {
    if (!shadowLayer || !engine || !mp) return;
    var remotes = mp.remoteList();
    var keep = {};
    remotes.forEach(function (r) {
      if (currentRunId && r.runId && r.runId !== currentRunId) return;
      keep[r.id] = true;
      var node = shadowNodes[r.id];
      if (!node) {
        var el = document.createElement('div');
        el.className = 'remote-player';
        var img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        var label = document.createElement('span');
        label.className = 'remote-player__name';
        el.appendChild(img);
        el.appendChild(label);
        shadowLayer.appendChild(el);
        node = { el: el, img: img, label: label, visualStep: r.step || 0, ch: null };
        shadowNodes[r.id] = node;
      }
      var target = Math.max(0, r.step || 0);
      node.visualStep += (target - node.visualStep) * 0.35;
      var c = safeChar(r.characterId || remoteChars[r.id] || 'mochi-rabbit');
      var pose = r.alive === false ? c.assets.fall : c.assets.main;
      if (node.ch !== pose) {
        node.img.src = pose;
        node.ch = pose;
      }
      node.label.textContent = r.name || '친구';
      node.el.classList.toggle('is-dead', r.alive === false);
      node.el.style.transform = 'translate3d(' + interpStepX(node.visualStep) + 'px,' + interpStepY(node.visualStep) + 'px,0)';
    });
    Object.keys(shadowNodes).forEach(function (id) {
      if (!keep[id]) {
        shadowNodes[id].el.remove();
        delete shadowNodes[id];
      }
    });
  }

  function onDeath() {
    if (!playing) return;
    updateRoundBest(engine.getState());
    playing = false;
    lifeRestarting = true;
    cancelAnimationFrame(rafId);
    var s = engine.getState();
    playerImg.src = activeChar.assets.fall;
    playerEl.classList.add('is-dead');
    stage.classList.add('is-shake');
    setTimeout(function () { stage.classList.remove('is-shake'); }, 320);
    if (isMulti && mp) sendSnapshot(s, true);
    if (!isMulti) {
      setTimeout(function () { finishRound(s.deadReason || 'dead'); }, FALL_RESTART_MS);
      return;
    }
    setTimeout(function () {
      if (remainingMs() <= 0) { finishRound('time'); return; }
      restartLife();
    }, FALL_RESTART_MS);
  }
  function restartLife() {
    createLifeEngine(true);
    playerEl.classList.remove('is-dead');
    placePlayer();
    camX = camTX = homeX() - stepX(0);
    camY = camTY = homeY() - stepY(0);
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';
    layoutStairs();
    playing = true;
    lifeRestarting = false;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }
  function finishRound(reason) {
    if (!engine || lastResult) return;
    var s = engine.getState();
    updateRoundBest(s);
    playing = false;
    lifeRestarting = false;
    cancelAnimationFrame(rafId);
    if (isMulti && mp) sendSnapshot(s, true);
    lastResult = {
      reason: reason,
      best: isMulti ? bestStep : s.pos,
      score: isMulti ? bestScore : s.score,
      maxCombo: isMulti ? roundMaxCombo : s.maxCombo,
      perfect: isMulti ? roundPerfect : s.perfectCount,
    };
    if (reason === 'time') spawnFloat('시간 종료!', 'perfect', 140);
    setTimeout(function () { showResult(s, reason); }, reason === 'time' ? 450 : 0);
  }
  function showResult(s, reason) {
    var result = lastResult || { best: s.pos, score: s.score, maxCombo: s.maxCombo, perfect: s.perfectCount };
    Boot.submitResult({
      score: result.score,
      step: result.best,
      best: result.best,
      maxCombo: result.maxCombo,
      duration: Number.isFinite(roundDurationMs) ? Math.round(roundDurationMs / 1000) : 0,
    });
    $('resStep').textContent = result.best;
    $('resScore').textContent = result.score;
    $('resCombo').textContent = result.maxCombo;
    $('resPerfect').textContent = result.perfect;
    $('resultCharImg').src = activeChar.assets.main;
    $('resCharName').textContent = activeChar.name;
    $('resCharAbility').textContent = activeChar.desc;
    $('resultTitle').textContent = reason === 'time' ? '시간 종료!' :
      (s.deadReason === 'wrong' ? '발을 헛디뎠어요!' : (s.deadReason === 'gauge' ? '게이지가 비었어요!' : '결과'));
    renderResultRank(result);
    renderRetryState();
    resultOverlay.classList.remove('is-hidden');
  }
  function renderResultRank(result) {
    var rankEl = $('resultRank');
    if (!isMulti || !mp) { rankEl.classList.add('is-hidden'); return; }
    var rows = [{ name: playerName(), best: result.best, score: result.score, me: true }];
    mp.remoteList().forEach(function (r) {
      if (currentRunId && r.runId && r.runId !== currentRunId) return;
      rows.push({ name: r.name || '친구', best: r.best || 0, score: r.score || 0, me: false });
    });
    rows.sort(function (a, b) { return (b.best - a.best) || (b.score - a.score); });
    rankEl.innerHTML = rows.map(function (r, i) {
      return '<div class="result-rank__row' + (r.me ? ' is-me' : '') + '">' +
        '<span>' + (i + 1) + '위 ' + escapeHtml(r.name) + '</span>' +
        '<span>' + r.best + '층 · ' + r.score + '점</span></div>';
    }).join('');
    rankEl.classList.remove('is-hidden');
  }
  function renderRetryState() {
    var retry = $('retryBtn');
    var hint = $('retryHint');
    if (!isMulti) {
      retry.disabled = false;
      retry.textContent = '다시 도전';
      hint.textContent = '';
      return;
    }
    if (isHost()) {
      retry.disabled = false;
      retry.textContent = '한판 더';
      hint.textContent = selectedDuration + '초로 다시 시작해요.';
    } else {
      retry.disabled = true;
      retry.textContent = '방장을 기다려요';
      hint.textContent = '방장(👑)이 시작하면 자동으로 함께 달려요.';
    }
  }

  function connectRoom() {
    if (!mp || !mp.available) {
      multiNote.textContent = '지금은 방 연결을 사용할 수 없어 혼자 도전만 가능해요.';
      return;
    }
    if (connected || connecting) {
      renderRoomPanel();
      return;
    }
    connecting = true;
    roomPanel.classList.remove('is-hidden');
    roomStatus.textContent = '방에 들어가는 중...';
    var roomChar = currentCharIdForRoom();
    mp.connect(roomChar, playerName()).then(function (info) {
      connected = true;
      connecting = false;
      isMulti = true;
      roomCode.textContent = info.code || '????';
      mp.broadcastChar(roomChar, playerName());
      renderRoomPanel();
    }).catch(function () {
      connecting = false;
      roomStatus.textContent = '방 연결에 실패했어요. 잠시 뒤 다시 눌러 주세요.';
    });
  }
  function startMulti() {
    if (!connected) { connectRoom(); return; }
    if (!isHost() || waitingForNext) return;
    var runId = makeRunId();
    selectedDuration = clampDuration(selectedDuration);
    mp.broadcastStart(selectedDuration, runId);
    beginRound(mp.seedString(), selectedDuration, runId);
  }
  function makeRunId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clampDuration(sec) {
    sec = Number(sec) || DEFAULT_DURATION;
    return DURATIONS.indexOf(sec) >= 0 ? sec : DEFAULT_DURATION;
  }
  function renderRoomPanel() {
    if (!connected && !connecting) return;
    roomPanel.classList.remove('is-hidden');
    latestRoster = mp ? mp.roster() : latestRoster;
    roomCode.textContent = mp && mp.code ? mp.code : '...';
    renderRoster();
    renderTimeButtons();
    waitingForNext = !playing && !lifeRestarting && remoteRoundRunning();
    if (connecting) roomStatus.textContent = '방에 들어가는 중...';
    else if (waitingForNext) roomStatus.textContent = '라운드 진행 중 - 다음 판부터 함께해요.';
    else if (isHost()) roomStatus.textContent = '방장(👑)이 시간을 고르고 시작해요.';
    else roomStatus.textContent = '방장(👑)이 시작해요.';
    startMultiBtn.disabled = !connected || !isHost() || waitingForNext;
    startMultiBtn.textContent = connected
      ? (isHost() ? (waitingForNext ? '다음 판 대기' : '레이스 시작') : '방장(👑)이 시작해요')
      : '친구와 경쟁';
  }
  function renderRoster() {
    rosterList.innerHTML = '';
    latestRoster.forEach(function (p, idx) {
      var id = normalizeId(p);
      var ch = (id === myId()) ? safeChar(selectedId === 'random' ? 'mochi-rabbit' : selectedId) :
        safeChar(remoteChars[id] || p.characterId || 'mochi-rabbit');
      var li = document.createElement('li');
      var img = document.createElement('img');
      img.src = ch.assets.main;
      img.alt = '';
      var name = document.createElement('span');
      name.textContent = (p.name || '친구');
      li.appendChild(img);
      li.appendChild(name);
      if (idx === 0) {
        var crown = document.createElement('b');
        crown.textContent = '👑';
        li.appendChild(crown);
      }
      rosterList.appendChild(li);
    });
  }
  function renderTimeButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.time-option'), function (btn) {
      var sec = Number(btn.dataset.sec);
      btn.classList.toggle('is-selected', sec === selectedDuration);
      btn.disabled = connected && !isHost();
    });
  }
  function remoteRoundRunning() {
    return mp && mp.remoteList().some(function (r) { return r.running && (!currentRunId || r.runId !== currentRunId); });
  }
  function inviteUrl() {
    return window.location.origin + window.location.pathname + '?code=' + encodeURIComponent((mp && mp.code) || '');
  }
  function copyInviteLink() {
    if (!mp || !mp.code) return;
    var url = inviteUrl();
    var done = function () {
      copyInvite.textContent = '복사 완료';
      setTimeout(function () { copyInvite.textContent = '초대 링크'; }, 1600);
    };
    if (navigator.share) {
      navigator.share({ title: '말랑 계단 레이스', text: '같이 계단 레이스 하자! 코드 ' + mp.code, url: url })
        .catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { window.prompt('초대 링크를 복사해 주세요', url); });
    } else {
      window.prompt('초대 링크를 복사해 주세요', url);
    }
  }

  function onKey(e) {
    if (e.repeat) return;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') { e.preventDefault(); doInput(-1); }
    else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { e.preventDefault(); doInput(1); }
  }
  function bind() {
    stage.addEventListener('pointerdown', function (e) {
      if (!playing || lifeRestarting) return;
      var dir = (e.clientX < stage.getBoundingClientRect().left + stage.clientWidth / 2) ? -1 : 1;
      doInput(dir);
    });
    window.addEventListener('keydown', onKey);
    startSoloBtn.addEventListener('click', startSolo);
    startMultiBtn.addEventListener('click', startMulti);
    copyInvite.addEventListener('click', copyInviteLink);
    Array.prototype.forEach.call(document.querySelectorAll('.time-option'), function (btn) {
      btn.addEventListener('click', function () {
        if (connected && !isHost()) return;
        selectedDuration = clampDuration(Number(btn.dataset.sec));
        renderTimeButtons();
        if (mp && connected) mp.broadcastTime(selectedDuration);
      });
    });
    $('retryBtn').addEventListener('click', function () {
      resultOverlay.classList.add('is-hidden');
      if (isMulti) {
        if (!isHost()) return;
        var runId = makeRunId();
        mp.broadcastStart(selectedDuration, runId);
        beginRound(mp.seedString(), selectedDuration, runId);
      } else {
        startSolo();
      }
    });
    $('exitBtn').addEventListener('click', function () { if (mp) mp.leave(); Boot.exit(); });
    if (mp) {
      mp.on('players', function (list) {
        latestRoster = list || [];
        if (connected) {
          mp.broadcastChar(currentCharIdForRoom(), playerName());
          if (isHost()) mp.broadcastTime(selectedDuration);
        }
        renderRoomPanel();
      });
      mp.on('time', function (p) {
        selectedDuration = clampDuration(p && p.sec);
        renderRoomPanel();
      });
      mp.on('char', function (r) {
        remoteChars[r.id] = r.characterId;
        renderRoomPanel();
      });
      mp.on('snapshot', function () {
        if (!playing) renderRoomPanel();
      });
      mp.on('change', function () {
        if (!playing) renderRoomPanel();
      });
      mp.on('start', function (p) {
        selectedDuration = clampDuration(p && p.dur);
        resultOverlay.classList.add('is-hidden');
        beginRound(mp.seedString(), selectedDuration, p && p.runId);
      });
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function init() {
    buildCharPick();
    bind();
    renderTimeButtons();
    if (Boot.isMultiplayer) {
      multiNote.textContent = '방 코드로 들어왔어요. 친구들과 같이 준비해요!';
      connectRoom();
    }
  }
  init();
})();
