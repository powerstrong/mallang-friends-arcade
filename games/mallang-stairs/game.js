/* Mallang Stairs controller (plain window globals, no modules). */
(function () {
  'use strict';

  var Chars = window.MallangCharacters;
  var Engine = window.MallangStairsEngine;
  var Boot = window.GameBoot || { submitResult: function () {}, exit: function () {} };

  var STEP_DX = 72;
  var STEP_DY = 56;
  var POOL = 18;
  var DURATIONS = [30];
  var DEFAULT_DURATION = 30;
  var FALL_RESTART_MS = 620;
  var CHECKPOINT_INTERVAL = 25;
  // 점수 보호막: 점수를 모아 게이지를 채우면, 다음 사망 시 25층 세이브 대신
  // 죽은 자리에서 가장 가까운 SHIELD_STEP_LINE 배수(더 위)에서 부활한다.
  var SHIELD_GAIN_PER_POINT = 1 / 1000; // 약 1000점마다 보호막 1칸(가득) — 30초 레이스에 한 판 한 번꼴
  var SHIELD_STEP_LINE = 10;           // 보호막 발동 시 부활 지점을 10층 단위로 끌어올림
  var PB_KEY = 'mallang-stairs:pb';
  var GHOST_KEY = 'mallang-stairs:pbghost';
  var HINT_KEY = 'mallang-stairs:seen-hint';
  var UNLOCK_KEY = 'mallang-stairs:unlocks';
  var GOLDEN_TIME_MS = 10000;   // 막판 골든 타임 구간(잔여 시간 기준)
  var GOLDEN_SCORE_MUL = 1.5;   // 골든 타임 점수 배율
  var GHOST_SAMPLE_MS = 500;    // PB 고스트 (시간→층) 곡선 샘플 간격
  // 30초 레이스 기준 테마 구간 — 평균 어린이(탭 ~400ms)가 한 판에 2~3개 테마를 보도록 압축.
  var THEME_STEPS = [
    { min: 0, bg: 'bg-sky-day.jpg', stair: 'stair-cloud.png' },
    { min: 35, bg: 'bg-sky-high.jpg', stair: 'stair-cloud.png' },
    { min: 70, bg: 'bg-sunset.jpg', stair: 'stair-candy.png' },
    { min: 110, bg: 'bg-sky-dawn.jpg', stair: 'stair-candy.png' },
    { min: 150, bg: 'bg-space.jpg', stair: 'stair-cookie.png' }
  ];
  var FX_ASSETS = {
    dust: 'fx-step-dust.png', perfect: 'fx-perfect-ring.png', fall: 'fx-fall-puff.png',
    feverBurst: 'fx-fever-burst.png', star: 'fx-star-yellow.png', shieldPop: 'fx-shield-pop.png'
  };
  var ART_ASSETS = [
    'bg-sky-day.jpg', 'bg-sky-high.jpg', 'bg-sunset.jpg', 'bg-sky-dawn.jpg', 'bg-space.jpg',
    'bg-cloud-parallax.png', 'stair-cloud.png', 'stair-candy.png', 'stair-cookie.png', 'stair-next-glow.png',
    'stair-gold.png', 'booster-speed.png', 'booster-stable.png', 'booster-combo.png', 'booster-fever.png',
    'fx-perfect-ring.png', 'fx-step-dust.png', 'fx-combo-flame.png', 'fx-fever-burst.png', 'fx-fall-puff.png', 'fx-star-yellow.png',
    'fx-shield-bubble.png', 'fx-shield-pop.png',
    'ui-title-plate.png', 'ui-trophy.png', 'ui-medal-gold.png', 'ui-medal-silver.png', 'ui-medal-bronze.png'
  ];

  var $ = function (id) { return document.getElementById(id); };
  var setupScreen = $('setupScreen'), playScreen = $('playScreen');
  var stage = $('stage'), stairLayer = $('stairLayer');
  var playerEl = $('player'), playerImg = $('playerImg');
  var stageBgA = $('stageBgA'), stageBgB = $('stageBgB'), cloudLayer = $('cloudLayer'), stageFx = $('stageFx');
  var comboFlame = $('comboFlame'), resultTrophy = $('resultTrophy');
  var hudTime = $('hudTime'), hudStep = $('hudStep'), hudBest = $('hudBest'),
      hudScore = $('hudScore'), hudCombo = $('hudCombo');
  var timeFill = $('timeFill'), feverFill = $('feverFill'), timeGauge = timeFill.parentElement;
  var shieldFill = $('shieldFill'), shieldGauge = $('shieldGauge'), hudBestStat = hudBest.parentElement;
  var rivalWrap = $('rivalWrap'), feverFx = $('feverFx'), floatLayer = $('floatLayer');
  var rivalAbove = $('rivalAbove'), rivalBelow = $('rivalBelow');
  var soundBtn = $('soundBtn'), gameAnnouncement = $('gameAnnouncement');
  var shieldBubble = $('shieldBubble'), tutorialHint = $('tutorialHint');
  var countdown = $('countdown'), countNum = $('countNum');
  var resultOverlay = $('resultOverlay');
  var rosterList = $('rosterList'), roomStatus = $('roomStatus');
  var startBtn = $('startBtn'), leaveBtn = $('leaveBtn'), multiNote = $('multiNote');

  var selectedId = 'peach-chick';
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
  var activeThemeIndex = -1;
  var visibleBg = stageBgA;
  var fxPools = {}, fxCursor = {};

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
  var checkpointStep = 0;
  var checkpointScore = 0;
  var lifeScoreOffset = 0;
  var shield = 0;               // 0~1 점수 보호막 게이지
  var personalBest = { step: 0, score: 0 };
  var roundMaxCombo = 0;
  var roundPerfect = 0;
  var lastResult = null;
  var latestRoster = [];
  var remoteChars = {};
  var waitingForNext = false;
  var playerPoseTimer = 0;
  var rankByPlayerId = {};
  var isRoomEntry = !!Boot.code;
  var goldenActive = false;     // 막판 골든 타임 진입 여부
  var ghostCurve = null;        // 솔로 재생용 PB 곡선 {charId, samples:[{t,s}]}
  var ghostNode = null;         // 고스트 DOM {el, step}
  var recSamples = null;        // 이번 라운드 (시간→층) 기록 샘플
  var recLastT = -Infinity;
  var hiddenAt = 0;             // 솔로 일시정지용 — 탭 숨김 시각
  var unlocks = {};             // 시크릿 직접선택 해금 상태 {charId: true}
  var roundFevers = 0;          // 이번 라운드 피버 발동 횟수(해금 판정용)
  var tapFeverOn = false;       // 탭 간 피버 on/off 에지 검출
  var previewTimer = 0;         // 잠금 캐릭터 미리보기 자동 복귀 타이머

  function audio() { return window.MallangStairsAudio; }
  function playSound(name, arg) {
    var sfx = audio();
    if (sfx && typeof sfx.play === 'function') sfx.play(name, arg);
  }
  function syncSoundButton() {
    var sfx = audio();
    var muted = !sfx || sfx.isMuted();
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundBtn.textContent = muted ? '소리 끔' : '소리 켬';
  }
  function announce(message) {
    if (gameAnnouncement) gameAnnouncement.textContent = message;
  }

  function loadPersonalBest() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(PB_KEY) || 'null');
      if (raw && typeof raw.step === 'number') {
        personalBest = { step: raw.step | 0, score: raw.score | 0 };
      }
    } catch (e) { /* storage unavailable */ }
  }
  function savePersonalBest(step, score) {
    var beat = step > personalBest.step || (step === personalBest.step && score > personalBest.score);
    if (!beat) return false;
    personalBest = { step: step | 0, score: score | 0 };
    try { window.localStorage.setItem(PB_KEY, JSON.stringify(personalBest)); } catch (e) { /* ignore */ }
    return true;
  }
  function renderPbNote() {
    var note = $('pbNote');
    if (!note) return;
    note.textContent = personalBest.step > 0
      ? ('내 최고 기록: ' + personalBest.step + '층 · ' + personalBest.score.toLocaleString() + '점')
      : '아직 기록이 없어요 — 첫 도전을 남겨봐요!';
  }

  // ---- 시크릿 캐릭터 직접선택 해금 (랜덤 추첨 풀은 해금과 무관하게 5종 유지) ----
  function loadUnlocks() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(UNLOCK_KEY) || 'null');
      if (raw && typeof raw === 'object') unlocks = raw;
    } catch (e) { /* storage unavailable */ }
  }
  function saveUnlocks() {
    try { window.localStorage.setItem(UNLOCK_KEY, JSON.stringify(unlocks)); } catch (e) { /* ignore */ }
  }
  function isUnlocked(id) {
    var c = Chars.get(id);
    return !!c && (!c.secret || !!unlocks[id]);
  }
  function checkUnlocks() {
    var newly = [];
    Chars.LIST.forEach(function (c) {
      if (!c.secret || !c.unlock || unlocks[c.id]) return;
      var ok = c.unlock.type === 'combo' ? roundMaxCombo >= c.unlock.value :
        c.unlock.type === 'fever' ? roundFevers >= c.unlock.value : false;
      if (ok) {
        unlocks[c.id] = true;
        newly.push(c);
      }
    });
    if (newly.length) {
      saveUnlocks();
      buildCharPick();
    }
    return newly;
  }

  // ---- 캐릭터 능력 육각형 레이더 ----
  var STAT_AXES = [
    { key: 'score', label: '점수' },
    { key: 'speed', label: '속도' },
    { key: 'fever', label: '피버' },
    { key: 'combo', label: '콤보' },
    { key: 'timing', label: '판정' },
    { key: 'survive', label: '생존' },
  ];
  var STAT_MAX = 5;
  function radarPoint(cx, cy, r, idx, total) {
    var ang = (-90 + idx * (360 / total)) * Math.PI / 180;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  }
  function radarRing(cx, cy, r, total) {
    var pts = [];
    for (var i = 0; i < total; i++) {
      var p = radarPoint(cx, cy, r, i, total);
      pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
    }
    return pts.join(' ');
  }
  function radarSvg(stats, accent) {
    var size = 168, cx = size / 2, cy = size / 2, R = 56, n = STAT_AXES.length;
    var svg = '';
    [0.25, 0.5, 0.75, 1].forEach(function (t) {
      svg += '<polygon class="radar__ring" points="' + radarRing(cx, cy, R * t, n) + '"/>';
    });
    for (var i = 0; i < n; i++) {
      var e = radarPoint(cx, cy, R, i, n);
      svg += '<line class="radar__axis" x1="' + cx + '" y1="' + cy + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '"/>';
    }
    var data = STAT_AXES.map(function (ax, idx) {
      var v = (stats && stats[ax.key]) || 0;
      var p = radarPoint(cx, cy, R * (v / STAT_MAX), idx, n);
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' ');
    svg += '<polygon class="radar__data" points="' + data + '" style="fill:' + accent + '40;stroke:' + accent + ';"/>';
    STAT_AXES.forEach(function (ax, idx) {
      var lp = radarPoint(cx, cy, R + 14, idx, n);
      svg += '<text class="radar__label" x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '">' + ax.label + '</text>';
    });
    return '<svg class="radar" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + svg + '</svg>';
  }
  function renderCharRadar(id) {
    var box = $('setupCharRadar');
    if (!box) return;
    if (id === 'random') {
      box.innerHTML = radarSvg(null, '#b9a7b0') + '<span class="radar__mark">?</span>';
      box.classList.add('is-random');
      return;
    }
    box.classList.remove('is-random');
    var c = safeChar(id);
    box.innerHTML = radarSvg(c.stats, c.accent);
  }

  // 주간 리더보드에 이번 판 최고 계단(층)을 제출한다. 계단 레이스의 순위 기준은
  // 층수이므로 리더보드도 층으로 겨룬다. 실패해도 게임 흐름엔 영향 없음(파이어&포겟).
  function submitToLeaderboard(floor, points, character) {
    if (!(floor > 0)) return;
    var base = (window.WORKER_URL || '').replace(/\/+$/, '');
    try {
      fetch(base + '/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          game: 'mallang-stairs',
          name: playerName(),
          score: floor,           // 리더보드 순위 기준: 층수
          tiebreak: points,       // 같은 층이면 점수로 가른다
          characterId: character ? character.id : selectedId,
          roomCode: Boot.code || null,
        }),
      }).catch(function () {});
    } catch (e) { /* 네트워크 불가 — 무시 */ }
  }

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
    Chars.LIST.forEach(function (c) {
      if (!c.secret) return;
      pick.appendChild(unlocks[c.id]
        ? makeChip(c.id, c.assets.main, c.name, false)
        : makeLockedChip(c));
    });
    pick.appendChild(makeChip('random', null, '랜덤', true));
    // 해금 후 재구성 등에서 기존 선택을 유지한다(랜덤이 잠금 시크릿을 배정한 경우 포함).
    selectChar(selectedId);
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
  function makeLockedChip(c) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'char-chip char-chip--locked';
    el.dataset.id = c.id;
    el.innerHTML = '<img src="' + c.assets.main + '" alt="" draggable="false" />' +
      '<span class="char-chip__label">???</span><b class="char-chip__lock">🔒</b>';
    el.addEventListener('click', function () { previewLockedChar(c.id); });
    return el;
  }
  function setCondNote(text) {
    var cond = $('setupCharCond');
    if (!cond) return;
    cond.textContent = text || '';
    cond.classList.toggle('is-hidden', !text);
  }
  // 잠금 캐릭터 탭 → 실루엣 + 해금 조건만 보여주고(선택은 유지), 잠시 뒤 원래 선택으로 복귀.
  function previewLockedChar(id) {
    var c = safeChar(id);
    clearTimeout(previewTimer);
    var setupImg = $('setupCharImg'), name = $('setupCharName');
    setupImg.src = c.assets.main;
    setupImg.style.visibility = 'visible';
    setupImg.classList.add('is-locked');
    name.textContent = '???';
    setCondNote(c.unlock ? c.unlock.label + '을 해내면 만날 수 있어요!' : '');
    renderCharRadar('random');
    previewTimer = setTimeout(function () { selectChar(selectedId); }, 2600);
  }
  // 주의: 잠금 시크릿 id 도 허용한다 — 랜덤 추첨(멀티 방 확정 포함)은 해금과 무관하게
  // 5종 전체에서 뽑히는 것이 설계다. 사용자 직접선택 차단은 잠금 칩이 selectChar 대신
  // previewLockedChar 를 호출하는 것으로 이미 보장된다.
  function selectChar(id) {
    if (id !== 'random' && !Chars.get(id)) id = 'peach-chick';
    clearTimeout(previewTimer);
    selectedId = id;
    var setupImg = $('setupCharImg'), name = $('setupCharName');
    setupImg.classList.remove('is-locked');
    setCondNote('');
    Array.prototype.forEach.call(document.querySelectorAll('.char-chip'), function (el) {
      el.classList.toggle('is-selected', el.dataset.id === id);
    });
    if (id === 'random') {
      setupImg.src = '';
      setupImg.style.visibility = 'hidden';
      name.textContent = '랜덤 친구';
    } else {
      var c = safeChar(id);
      setupImg.src = c.assets.main;
      setupImg.style.visibility = 'visible';
      name.textContent = c.name;
      preloadPoses(c); // 선택 시점에 포즈 프리로드 — 첫 홉 이미지 팝 방지
    }
    renderCharRadar(id);
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
  function preloadArt() {
    ART_ASSETS.forEach(function (file) { var im = new Image(); im.src = './assets/' + file; });
  }
  function themeForStep(step) {
    var index = 0;
    for (var i = 1; i < THEME_STEPS.length; i++) {
      if (step >= THEME_STEPS[i].min) index = i;
    }
    return index;
  }
  function applyTheme(step) {
    var index = themeForStep(step || 0);
    if (index === activeThemeIndex) return;
    activeThemeIndex = index;
    var theme = THEME_STEPS[index];
    var nextBg = visibleBg === stageBgA ? stageBgB : stageBgA;
    nextBg.style.backgroundImage = 'url("./assets/' + theme.bg + '")';
    nextBg.classList.add('is-visible');
    if (visibleBg !== nextBg) visibleBg.classList.remove('is-visible');
    visibleBg = nextBg;
    stairLayer.style.setProperty('--stair-image', 'url("./assets/' + theme.stair + '")');
  }
  function updateCloudParallax() {
    // 배경 타일 높이(153px)로 감아 무한 반복 — camY는 층수에 비례해 수천 px까지 커진다.
    var offset = ((camY * 0.25) % 153 + 153) % 153;
    cloudLayer.style.transform = 'translate3d(0,' + offset.toFixed(2) + 'px,0)';
  }
  function buildFxPool(kind, count) {
    fxPools[kind] = [];
    fxCursor[kind] = 0;
    for (var i = 0; i < count; i++) {
      var node = document.createElement('img');
      node.className = 'fx-pop fx-pop--' + kind;
      node.src = './assets/' + FX_ASSETS[kind];
      node.alt = '';
      node.draggable = false;
      stageFx.appendChild(node);
      fxPools[kind].push(node);
    }
  }
  function buildFxPools() {
    stageFx.innerHTML = '';
    buildFxPool('dust', 4);
    buildFxPool('perfect', 2);
    buildFxPool('fall', 1);
    buildFxPool('feverBurst', 1);
    buildFxPool('star', 5);
    buildFxPool('shieldPop', 1);
  }
  function playFx(kind, x, y, flip) {
    var pool = fxPools[kind];
    if (!pool || !pool.length) return;
    var node = pool[fxCursor[kind]++ % pool.length];
    if (node._fxTimer) clearTimeout(node._fxTimer);
    node.classList.remove('is-active');
    node.style.setProperty('--fx-x', x + 'px');
    node.style.setProperty('--fx-y', y + 'px');
    node.style.setProperty('--fx-flip', flip ? '-1' : '1');
    void node.offsetWidth;
    node.classList.add('is-active');
    node._fxTimer = setTimeout(function () { node.classList.remove('is-active'); },
      kind === 'dust' ? 300 : kind === 'perfect' ? 370 : kind === 'fall' ? 420 :
      kind === 'shieldPop' ? 450 : kind === 'feverBurst' ? 520 : 1120);
  }
  function updateCharacterFx(s) {
    comboFlame.classList.toggle('is-active', !!s && s.combo >= 15 && !s.feverActive);
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
    applyTheme(pos);
    var lo = Math.max(0, pos - 3);
    for (var n = 0; n < POOL; n++) {
      var idx = lo + n;
      var el = poolNodes[n];
      // 같은 라운드에선 시드가 고정이라 계단 index 가 같으면 위치도 같다 — 변경 시에만 DOM 쓰기.
      if (el._idx !== idx) {
        el._idx = idx;
        el.style.transform = 'translate3d(' + stepX(idx) + 'px,' + stepY(idx) + 'px,0)';
      }
      el.classList.toggle('is-next', idx === pos + 1);
      var key = idx > pos ? (engine.boosterAt(idx) || '') : '';
      if (el._booster !== key) {
        el._booster = key;
        el.firstChild.innerHTML = key ? boosterIcon(key) : '';
      }
    }
  }
  function boosterIcon(t) {
    var file = t === 'speed' ? 'booster-speed.png' : t === 'stable' ? 'booster-stable.png' :
      t === 'combo' ? 'booster-combo.png' : 'booster-fever.png';
    return '<img src="./assets/' + file + '" alt="" draggable="false" />';
  }
  function show(screen) {
    setupScreen.classList.toggle('is-active', screen === 'setup');
    playScreen.classList.toggle('is-active', screen === 'play');
  }

  function beginRound(seedStr, durationSec, runId, multi) {
    if (playing || lifeRestarting) return;
    isMulti = !!multi;
    currentRunId = isMulti ? runId : null;
    roundSeed = isMulti ? seedStr + ':' + runId : seedStr;
    roundDurationMs = Math.max(1, durationSec || selectedDuration) * 1000;
    bestStep = 0;
    bestScore = 0;
    checkpointStep = 0;
    checkpointScore = 0;
    lifeScoreOffset = 0;
    shield = 0;
    rankByPlayerId = {};
    roundMaxCombo = 0;
    roundPerfect = 0;
    lastResult = null;
    goldenActive = false;
    stairLayer.classList.remove('is-golden');
    if (shieldBubble) shieldBubble.classList.remove('is-on');
    roundFevers = 0;
    startGhostRound();
    activeChar = resolveCharacter();
    preloadPoses(activeChar);
    createLifeEngine(false);
    resultOverlay.classList.add('is-hidden');
    feverFx.classList.remove('is-on');
    rivalAbove.classList.remove('is-on');
    rivalBelow.classList.remove('is-on');
    show('play');
    placePlayer();
    camX = camTX = homeX() - stepX(0);
    camY = camTY = homeY() - stepY(0);
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';
    updateCloudParallax();
    layoutStairs();
    updateHud(engine.getState());
    runCountdown();
  }
  function startTimedSolo() {
    selectedDuration = clampDuration(selectedDuration);
    beginRound(makeSoloSeed(), selectedDuration, null, false);
  }
  function makeSoloSeed() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function createLifeEngine(startNow, startAtStep) {
    engine = Engine.create({
      seed: roundSeed,
      character: activeChar,
      startAtStep: Math.max(0, startAtStep || 0)
    });
    if (goldenActive) engine.setScoreBoost(GOLDEN_SCORE_MUL); // 골든 타임 중 부활해도 배율 유지
    tapFeverOn = false;
    xCache = [0];
    buildPool();
    ensureGhostNode();
    setIdlePose();
    playerEl.classList.remove('is-dead');
    comboFlame.classList.remove('is-active');
    if (startNow) engine.start();
  }
  function shouldShowHint() {
    try { return !window.localStorage.getItem(HINT_KEY); } catch (e) { return false; }
  }
  function markHintSeen() {
    try { window.localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* ignore */ }
  }
  function runCountdown() {
    var n = 3;
    countNum.textContent = n;
    playSound('countdown', n);
    countdown.classList.remove('is-hidden');
    if (tutorialHint && shouldShowHint()) tutorialHint.classList.remove('is-hidden');
    var iv = setInterval(function () {
      n--;
      if (n <= 0) {
        clearInterval(iv);
        countdown.classList.add('is-hidden');
        playSound('countdown', 0);
        startPlay();
      } else {
        countNum.textContent = n;
        playSound('countdown', n);
        countNum.style.animation = 'none';
        void countNum.offsetWidth;
        countNum.style.animation = '';
      }
    }, 700);
  }
  function startPlay() {
    if (tutorialHint && !tutorialHint.classList.contains('is-hidden')) {
      tutorialHint.classList.add('is-hidden');
      markHintSeen();
    }
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
    playSound('tap');
    if (ev.dead) { onDeath(); return; }
    hop(dir);
    playFx('dust', homeX(), homeY() - 8, Math.random() < 0.5);
    if (ev.grade === 'perfect') {
      playFx('perfect', homeX(), homeY() - 42);
      playSound('perfect');
    }
    if (ev.grade) popFloat(ev.grade, ev.gain);
    if (ev.gain) {
      var wasArmed = shield >= 1;
      shield = Math.min(1, shield + ev.gain * SHIELD_GAIN_PER_POINT);
      if (!wasArmed && shield >= 1) {
        spawnFloat('보호막 완성!', 'checkpoint', 150, 1400);
        announce('보호막 완성');
        playSound('booster', 'stable');
      }
    }
    if (ev.booster) {
      popBooster(ev.booster);
      playSound('booster', ev.booster);
    }
    if (ev.fever && !tapFeverOn) roundFevers++; // 탭 간 에지 검출 — 해금(민트) 판정용
    tapFeverOn = !!ev.fever;
    if (ev.fever && !feverFx.classList.contains('is-on')) enterFever();
    var state = engine.getState();
    updateRoundBest(state);
    updateCheckpoint(state);
    updateCharacterFx(state);
    layoutStairs();
  }
  function clearPlayerPoseTimer() {
    if (playerPoseTimer) clearTimeout(playerPoseTimer);
    playerPoseTimer = 0;
  }
  function setIdlePose() {
    clearPlayerPoseTimer();
    if (!activeChar) return;
    playerImg.src = activeChar.assets.main;
    playerImg.style.animation = '';
    playerImg.classList.add('is-idle');
  }
  function hop(dir) {
    clearPlayerPoseTimer();
    playerImg.classList.remove('is-idle');
    playerImg.src = dir < 0 ? activeChar.assets.left : activeChar.assets.right;
    playerImg.style.animation = 'none';
    void playerImg.offsetWidth;
    playerImg.style.animation = 'introHop .22s';
    playerPoseTimer = setTimeout(function () {
      if (!playerEl.classList.contains('is-dead')) setIdlePose();
    }, 240);
  }
  function flashTouch(dir) {
    var sel = dir < 0 ? '.touch-zones__side--left' : '.touch-zones__side--right';
    var z = document.querySelector(sel);
    if (!z) return;
    z.classList.add('is-hit');
    setTimeout(function () { z.classList.remove('is-hit'); }, 90);
  }
  function spawnFloat(text, cls, yOff, holdMs) {
    var el = document.createElement('div');
    el.className = 'float-pop float-pop--' + cls;
    el.textContent = text;
    el.style.setProperty('--px', homeX() + 'px');
    el.style.setProperty('--py', (homeY() - yOff) + 'px');
    var life = holdMs || 700;
    el.style.animationDuration = (life / 1000) + 's';
    floatLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, life);
  }
  function popFloat(grade, gain) {
    var label = grade === 'perfect' ? 'PERFECT' : grade === 'good' ? 'GOOD' : '+';
    spawnFloat(label + ' ' + gain, grade, 70);
  }
  function popBooster(type) {
    var el = document.createElement('div');
    el.className = 'float-pop float-pop--booster';
    el.innerHTML = boosterIcon(type) + '<span>GET</span>';
    el.style.setProperty('--px', homeX() + 'px');
    el.style.setProperty('--py', (homeY() - 110) + 'px');
    floatLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 700);
  }
  function enterFever() {
    feverFx.classList.add('is-on');
    playSound('fever', 'start');
    playFx('feverBurst', stage.clientWidth / 2, stage.clientHeight / 2);
    for (var i = 0; i < 6; i++) spawnStar();
  }
  function spawnStar() {
    var sx = 20 + Math.random() * (stage.clientWidth - 40);
    var sy = stage.clientHeight * 0.5 + Math.random() * 60;
    playFx('star', sx, sy);
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
    if (!goldenActive && Number.isFinite(roundEndAt) && remainingMs() <= GOLDEN_TIME_MS) {
      enterGoldenTime();
    }

    engine.tick(dt);
    var s = engine.getState();
    if (s.dead) { onDeath(); return; }

    camTX = homeX() - stepX(s.pos);
    camTY = homeY() - stepY(s.pos);
    camX += (camTX - camX) * 0.18;
    camY += (camTY - camY) * 0.18;
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';
    updateCloudParallax();

    if (!s.feverActive && feverFx.classList.contains('is-on')) {
      feverFx.classList.remove('is-on');
      playSound('fever', 'stop');
    }
    if (s.feverActive && Math.random() < 0.3) spawnStar();
    updateCharacterFx(s);

    updateRoundBest(s);
    updateHud(s);
    recordGhostSample(false);
    if (isMulti && mp) {
      sendSnapshot(s, false);
      renderRanking();
      renderShadows();
      renderRivalMarkers(s.pos);
    } else {
      renderGhost();
    }
    rafId = requestAnimationFrame(frame);
  }
  function updateRoundBest(s) {
    if (!s) return;
    var totalScore = lifeScoreOffset + s.score;
    if (s.pos > bestStep) {
      bestStep = s.pos;
      bestScore = totalScore;
    } else if (s.pos === bestStep && totalScore > bestScore) {
      bestScore = totalScore;
    }
    if (s.maxCombo > roundMaxCombo) roundMaxCombo = s.maxCombo;
    if (s.perfectCount > roundPerfect) roundPerfect = s.perfectCount;
  }
  function updateCheckpoint(s) {
    var reached = Math.floor(s.pos / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL;
    if (reached <= checkpointStep) return;
    checkpointStep = reached;
    checkpointScore = lifeScoreOffset + s.score;
    spawnFloat('SAFE STEP ' + checkpointStep, 'checkpoint', 132);
    announce('안전 계단 도달: ' + checkpointStep + '층');
    playSound('checkpoint');
  }
  function remainingMs() {
    if (!Number.isFinite(roundEndAt)) return Infinity;
    return Math.max(0, roundEndAt - performance.now());
  }
  function updateHud(s) {
    hudStep.textContent = s.pos;
    // "내 기록"은 이전 판까지의 개인 최고층을 목표로 보여주고,
    // 이번 판이 그 기록을 넘어서면 함께 올라가며 신기록 표시를 켠다.
    var beatingRecord = bestStep > personalBest.step;
    hudBest.textContent = Math.max(personalBest.step, bestStep);
    hudBestStat.classList.toggle('is-record', beatingRecord);
    hudScore.textContent = lifeScoreOffset + s.score;
    hudCombo.textContent = s.combo;
    timeFill.style.transform = 'scaleX(' + Math.max(0, s.gaugeRatio) + ')';
    feverFill.style.transform = 'scaleX(' + Math.min(1, s.feverRatio) + ')';
    shieldFill.style.transform = 'scaleX(' + Math.min(1, shield) + ')';
    shieldGauge.classList.toggle('is-armed', shield >= 1);
    if (shieldBubble) shieldBubble.classList.toggle('is-on', shield >= 1);
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

  function rankRowsByBest(rows) {
    // 순위는 층수 우선, 같은 층이면 점수로 가른다.
    rows.sort(function (a, b) { return b.best - a.best || b.score - a.score; });
    var lastBest = null, lastScore = null;
    var place = 0;
    rows.forEach(function (row, index) {
      if (row.best !== lastBest || row.score !== lastScore) place = index + 1;
      row.place = place;
      lastBest = row.best;
      lastScore = row.score;
    });
    return rows;
  }
  function announceRankImprovement(rows) {
    var mine = rows.find(function (row) { return row.me; });
    if (!mine) return;
    var previousPlace = rankByPlayerId[mine.id];
    if (previousPlace && mine.place < previousPlace && mine.best > 0) {
      spawnFloat(mine.place === 1 ? 'TAKE THE LEAD!' : 'OVERTAKE!', 'overtake', 166);
      announce(mine.place === 1 ? '선두로 나섰어요!' : '친구를 추월했어요!');
      playSound('overtake');
    }
    rows.forEach(function (row) { rankByPlayerId[row.id] = row.place; });
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
    rankRowsByBest(rows);
    announceRankImprovement(rows);
    var keep = {};
    rows.slice(0, 6).forEach(function (r) {
      keep[r.id] = true;
      var row = rankRows[r.id];
      if (!row) {
        row = document.createElement('div');
        row.className = 'live-rank__row';
        row.innerHTML = '<span class="live-rank__place"></span><span class="live-rank__name"></span>';
        rankRows[r.id] = row;
        rivalWrap.appendChild(row);
      }
      row.classList.toggle('is-me', !!r.me);
      row.classList.toggle('is-leader', r.place === 1);
      row.classList.toggle('is-dead', r.alive === false);
      row.children[0].textContent = r.place === 1 ? '★' : String(r.place);
      row.children[1].textContent = r.name;
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
        node = { el: el, img: img, label: label, visualStep: r.step || 0, lastStep: r.step || 0, hopUntil: 0, ch: null };
        shadowNodes[r.id] = node;
      }
      var target = Math.max(0, r.step || 0);
      node.visualStep += (target - node.visualStep) * 0.35;
      var c = safeChar(r.characterId || remoteChars[r.id] || 'mochi-rabbit');
      if (r.alive !== false && target > node.lastStep) node.hopUntil = Date.now() + 250;
      node.lastStep = Math.max(node.lastStep, target);
      var pose = r.alive === false ? c.assets.fall : (Date.now() < node.hopUntil ? c.assets.right : c.assets.main);
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

  // 카메라가 내 캐릭터를 화면 가운데 고정하므로, 화면 밖으로 벗어난 위/아래 라이벌은
  // 안 보인다. 나보다 바로 위(더 높은 층)·바로 아래(더 낮은 층)의 가장 가까운 친구를
  // 찾아 화면 위/아래 가장자리에 화살표 마커로 알려준다.
  function nearestRival(myStep, dir) {
    var best = null;
    mp.remoteList().forEach(function (r) {
      if (currentRunId && r.runId && r.runId !== currentRunId) return;
      if (r.alive === false) return;
      var d = Math.max(0, r.step || 0) - myStep;
      if (dir > 0 ? d > 0 : d < 0) {
        if (!best || Math.abs(d) < Math.abs(best.d)) best = { r: r, d: d };
      }
    });
    return best;
  }
  function updateRivalMarker(el, info) {
    if (!el) return;
    if (!info) { el.classList.remove('is-on'); return; }
    var c = safeChar(info.r.characterId || remoteChars[info.r.id] || 'mochi-rabbit');
    var img = el.querySelector('.rival-marker__face');
    if (img.getAttribute('src') !== c.assets.main) img.src = c.assets.main;
    el.querySelector('.rival-marker__name').textContent = info.r.name || '친구';
    el.querySelector('.rival-marker__gap').textContent = Math.abs(info.d) + '층';
    el.classList.add('is-on');
  }
  function renderRivalMarkers(myStep) {
    if (!isMulti || !mp) { rivalAbove.classList.remove('is-on'); rivalBelow.classList.remove('is-on'); return; }
    updateRivalMarker(rivalAbove, nearestRival(myStep, 1));
    updateRivalMarker(rivalBelow, nearestRival(myStep, -1));
  }

  // ---- 골든 타임: 잔여 10초 동안 점수 배율 + 황금 발판 ----
  function enterGoldenTime() {
    goldenActive = true;
    engine.setScoreBoost(GOLDEN_SCORE_MUL);
    stairLayer.classList.add('is-golden');
    spawnFloat('골든 타임! 점수 ' + GOLDEN_SCORE_MUL + '배', 'overtake', 150, 1300);
    announce('골든 타임 — 점수 ' + GOLDEN_SCORE_MUL + '배');
    playSound('overtake');
  }

  // ---- 솔로 PB 고스트: 개인 최고 기록 런의 (시간→최고층) 곡선을 유령으로 재생 ----
  // 기록은 솔로/멀티 모두 하고(신기록이면 곡선 저장), 표시는 솔로에서만 한다.
  function loadGhostCurve() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(GHOST_KEY) || 'null');
      if (raw && raw.v === 1 && Array.isArray(raw.samples) && raw.samples.length > 1) return raw;
    } catch (e) { /* storage unavailable */ }
    return null;
  }
  function saveGhostCurve() {
    if (!recSamples || recSamples.length < 2) return;
    try {
      window.localStorage.setItem(GHOST_KEY, JSON.stringify({
        v: 1, charId: activeChar ? activeChar.id : selectedId, samples: recSamples,
      }));
    } catch (e) { /* ignore */ }
  }
  function startGhostRound() {
    recSamples = [];
    recLastT = -Infinity;
    ghostCurve = isMulti ? null : loadGhostCurve();
    ghostNode = null;
  }
  function recordGhostSample(force) {
    if (!recSamples || !Number.isFinite(roundDurationMs)) return;
    var elapsed = roundDurationMs - remainingMs();
    if (!force && elapsed - recLastT < GHOST_SAMPLE_MS) return;
    recLastT = elapsed;
    recSamples.push({ t: Math.round(elapsed), s: bestStep });
  }
  function ensureGhostNode() {
    var prevStep = ghostNode ? ghostNode.step : 0;
    ghostNode = null;
    if (!ghostCurve || isMulti || !shadowLayer) return;
    var el = document.createElement('div');
    el.className = 'remote-player remote-player--ghost';
    var img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = safeChar(ghostCurve.charId).assets.main;
    var label = document.createElement('span');
    label.className = 'remote-player__name';
    label.textContent = '👻 지난 최고';
    el.appendChild(img);
    el.appendChild(label);
    shadowLayer.appendChild(el);
    ghostNode = { el: el, step: prevStep };
  }
  function ghostStepAt(elapsed) {
    var ss = ghostCurve.samples;
    if (elapsed <= ss[0].t) return ss[0].s;
    for (var i = 1; i < ss.length; i++) {
      if (elapsed <= ss[i].t) {
        var a = ss[i - 1], b = ss[i];
        var f = b.t === a.t ? 1 : (elapsed - a.t) / (b.t - a.t);
        return a.s + (b.s - a.s) * f;
      }
    }
    return ss[ss.length - 1].s;
  }
  function renderGhost() {
    if (!ghostNode || !ghostCurve || !Number.isFinite(roundDurationMs)) return;
    var target = ghostStepAt(roundDurationMs - remainingMs());
    ghostNode.step += (target - ghostNode.step) * 0.25;
    ghostNode.el.style.transform =
      'translate3d(' + interpStepX(ghostNode.step) + 'px,' + interpStepY(ghostNode.step) + 'px,0)';
  }

  function onDeath() {
    if (!playing) return;
    updateRoundBest(engine.getState());
    playing = false;
    lifeRestarting = true;
    cancelAnimationFrame(rafId);
    var s = engine.getState();
    // 점수 보호막이 가득 찼다면 소모하고, 25층 세이브 대신 죽은 자리 바로 아래
    // 10층 라인에서 부활 — 점수로 쌓은 만큼 손실을 줄여주는 혜택.
    if (shield >= 1) {
      var line = Math.floor(s.pos / SHIELD_STEP_LINE) * SHIELD_STEP_LINE;
      if (line > checkpointStep) checkpointStep = line;
      checkpointScore = lifeScoreOffset + s.score;
      shield = 0;
      if (shieldBubble) shieldBubble.classList.remove('is-on');
      playFx('shieldPop', homeX(), homeY() - 40);
      spawnFloat('보호막 발동! ' + checkpointStep + '층에서 부활', 'overtake', 150, 1400);
      announce('보호막 발동 — ' + checkpointStep + '층에서 부활');
    }
    clearPlayerPoseTimer();
    playerImg.classList.remove('is-idle');
    playerImg.src = activeChar.assets.fall;
    playerEl.classList.add('is-dead');
    comboFlame.classList.remove('is-active');
    playFx('fall', homeX(), homeY() - 34);
    playSound('death');
    stage.classList.add('is-shake');
    setTimeout(function () { stage.classList.remove('is-shake'); }, 320);
    if (isMulti && mp) sendSnapshot(s, true);
    setTimeout(function () {
      if (remainingMs() <= 0) { finishRound('time'); return; }
      restartLife();
    }, FALL_RESTART_MS);
  }
  function restartLife() {
    lifeScoreOffset = checkpointScore;
    createLifeEngine(true, checkpointStep);
    playerEl.classList.remove('is-dead');
    placePlayer();
    camX = camTX = homeX() - stepX(checkpointStep);
    camY = camTY = homeY() - stepY(checkpointStep);
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';
    updateCloudParallax();
    layoutStairs();
    if (checkpointStep > 0) {
      spawnFloat('BACK TO ' + checkpointStep, 'checkpoint', 122);
      announce('Back to safe step ' + checkpointStep);
    }
    playing = true;
    lifeRestarting = false;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }
  function finishRound(reason) {
    if (!engine || lastResult) return;
    var s = engine.getState();
    updateRoundBest(s);
    recordGhostSample(true);
    playing = false;
    lifeRestarting = false;
    cancelAnimationFrame(rafId);
    if (isMulti && mp) sendSnapshot(s, true);
    lastResult = {
      reason: reason,
      best: bestStep,
      score: bestScore,
      maxCombo: roundMaxCombo,
      perfect: roundPerfect,
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
    submitToLeaderboard(result.best, result.score, activeChar);
    var prevBestStep = personalBest.step; // savePersonalBest 가 덮어쓰기 전에 스냅샷
    var newRecord = savePersonalBest(result.best, result.score);
    if (newRecord) saveGhostCurve();
    renderPbNote();
    renderResultDelta(result, prevBestStep, newRecord);
    renderResultUnlock(checkUnlocks());
    $('resStep').textContent = result.best;
    $('resScore').textContent = result.score;
    $('resCombo').textContent = result.maxCombo;
    $('resPerfect').textContent = result.perfect;
    if (newRecord) spawnFloat('🎉 자기 최고 기록!', 'overtake', 180);
    setResultCharacter(activeChar);
    $('resCharName').textContent = activeChar.name;
    $('resultTitle').textContent = reason === 'time' ? '시간 종료!' :
      (s.deadReason === 'wrong' ? '발을 헛디뎠어요!' : (s.deadReason === 'gauge' ? '게이지가 비었어요!' : '결과'));
    resultTrophy.classList.toggle('is-hidden', !renderResultRank(result));
    renderRetryState();
    resultOverlay.classList.remove('is-hidden');
  }
  function renderResultUnlock(newly) {
    var el = $('resUnlock');
    if (!el) return;
    if (!newly || !newly.length) {
      el.classList.add('is-hidden');
      return;
    }
    var names = newly.map(function (c) { return c.name; }).join(', ');
    el.textContent = '🎉 새 친구 해금: ' + names + '!';
    el.classList.remove('is-hidden');
    announce('새 친구 해금: ' + names);
  }
  // 결과 카드에 "지난 나"와의 비교 한 줄 — 성장 체감용.
  function renderResultDelta(result, prevBestStep, newRecord) {
    var el = $('resDelta');
    if (!el) return;
    el.classList.remove('is-up');
    if (prevBestStep > 0) {
      var diff = result.best - prevBestStep;
      if (diff > 0) {
        el.textContent = '지난 최고보다 +' + diff + '층!';
        el.classList.add('is-up');
      } else if (diff === 0) {
        el.textContent = newRecord ? '같은 층, 점수 신기록!' : '최고 기록과 동률!';
        if (newRecord) el.classList.add('is-up');
      } else {
        el.textContent = '최고 기록까지 ' + (-diff) + '층 남았어요';
      }
    } else {
      el.textContent = newRecord ? '첫 기록 등록!' : '';
      if (newRecord) el.classList.add('is-up');
    }
  }
  function setResultCharacter(c) {
    var image = $('resultCharImg');
    image.onerror = function () {
      image.onerror = null;
      image.src = c.assets.main;
    };
    image.src = c.assets.win;
  }
  function renderResultRank(result) {
    var rankEl = $('resultRank');
    if (!isMulti || !mp) { rankEl.classList.add('is-hidden'); return false; }
    var rows = [{ name: playerName(), best: result.best, score: result.score, me: true }];
    mp.remoteList().forEach(function (r) {
      if (currentRunId && r.runId && r.runId !== currentRunId) return;
      rows.push({ name: r.name || '친구', best: r.best || 0, score: r.score || 0, me: false });
    });
    rankRowsByBest(rows);
    rankEl.innerHTML = rows.map(function (r) {
      var medal = r.place <= 3
        ? '<img class="result-rank__medal" src="./assets/ui-medal-' +
          (r.place === 1 ? 'gold' : r.place === 2 ? 'silver' : 'bronze') + '.png" alt="" />'
        : '<span class="result-rank__medal"></span>';
      return '<div class="result-rank__row' + (r.me ? ' is-me' : '') + '">' +
        '<span class="result-rank__left">' + medal + r.place + '위 ' + escapeHtml(r.name) + '</span>' +
        '<span>' + r.best + '층 · ' + r.score + '점</span></div>';
    }).join('');
    rankEl.classList.remove('is-hidden');
    return !!rows[0].me;
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
      hint.textContent = '방장(👑)이 시작하면 함께 달려요.';
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
    rosterList.classList.remove('is-hidden');
    roomStatus.classList.remove('is-hidden');
    roomStatus.textContent = '방에 들어가는 중...';
    var roomChar = currentCharIdForRoom();
    mp.connect(roomChar, playerName()).then(function () {
      connected = true;
      connecting = false;
      isMulti = true;
      mp.broadcastChar(roomChar, playerName());
      renderRoomPanel();
    }).catch(function () {
      connecting = false;
      roomStatus.textContent = '방 연결에 실패했어요. 잠시 뒤 다시 눌러 주세요.';
    });
  }
  function startRace() {
    if (!isRoomEntry) { startTimedSolo(); return; }
    if (!connected) { connectRoom(); return; }
    if (!isHost() || waitingForNext) return;
    var runId = makeRunId();
    selectedDuration = clampDuration(selectedDuration);
    mp.broadcastStart(selectedDuration, runId);
    beginRound(mp.seedString(), selectedDuration, runId, true);
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
    rosterList.classList.remove('is-hidden');
    roomStatus.classList.remove('is-hidden');
    latestRoster = mp ? mp.roster() : latestRoster;
    renderRoster();
    waitingForNext = !playing && !lifeRestarting && remoteRoundRunning();
    if (connecting) roomStatus.textContent = '방에 들어가는 중...';
    else if (waitingForNext) roomStatus.textContent = '라운드 진행 중 - 다음 판부터 함께해요.';
    else if (isHost()) roomStatus.textContent = '방장(👑)이 시작을 눌러요.';
    else roomStatus.textContent = '방장(👑)이 시작해요.';
    startBtn.disabled = !connected || !isHost() || waitingForNext;
    startBtn.textContent = connected
      ? (isHost() ? (waitingForNext ? '다음 판 대기' : '시작') : '방장(👑)이 시작해요')
      : '방에 들어가는 중...';
  }
  function renderRoster() {
    rosterList.innerHTML = '';
    latestRoster.forEach(function (p, idx) {
      var id = normalizeId(p);
      var ch = (id === myId()) ? safeChar(selectedId) :
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
  function remoteRoundRunning() {
    return mp && mp.remoteList().some(function (r) { return r.running && (!currentRunId || r.runId !== currentRunId); });
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
    // 솔로 한정: 탭이 숨겨진 동안 판이 흘러가 버리지 않게 종료 시각을 뒤로 민다.
    // (엔진 게이지는 rAF tick 기반이라 자동으로 멈춘다. 멀티는 벽시계 공유가 규칙이므로 불개입.)
    document.addEventListener('visibilitychange', function () {
      if (isMulti) return;
      if (document.hidden) {
        if (playing && Number.isFinite(roundEndAt)) hiddenAt = performance.now();
      } else if (hiddenAt) {
        if (playing && Number.isFinite(roundEndAt)) {
          roundEndAt += performance.now() - hiddenAt;
          lastTs = 0;
        }
        hiddenAt = 0;
      }
    });
    soundBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var sfx = audio();
      if (!sfx) return;
      sfx.unlockAudio();
      sfx.toggleMuted();
      syncSoundButton();
    });
    startBtn.addEventListener('click', startRace);
    leaveBtn.addEventListener('click', function () { if (mp) mp.leave(); Boot.exit(); });
    $('retryBtn').addEventListener('click', function () {
      resultOverlay.classList.add('is-hidden');
      if (isMulti) {
        if (!isHost()) return;
        var runId = makeRunId();
        mp.broadcastStart(selectedDuration, runId);
        beginRound(mp.seedString(), selectedDuration, runId, true);
      } else {
        startTimedSolo();
      }
    });
    $('exitBtn').addEventListener('click', function () { if (mp) mp.leave(); Boot.exit(); });
    if (mp) {
      mp.on('players', function (list) {
        latestRoster = list || [];
        if (connected) mp.broadcastChar(currentCharIdForRoom(), playerName());
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
        beginRound(mp.seedString(), selectedDuration, p && p.runId, true);
      });
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 셋업 화면에 이번 주 TOP3 표시 — 실패해도 조용히 생략(파이어&포겟).
  function renderWeeklyTop() {
    var el = $('weeklyTop');
    if (!el || typeof window.fetch !== 'function') return;
    var base = (window.WORKER_URL || '').replace(/\/+$/, '');
    fetch(base + '/api/leaderboard?game=mallang-stairs')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var entries = (data && data.entries) || [];
        if (!entries.length) return;
        var parts = entries.slice(0, 3).map(function (e, i) {
          // 저장 점수는 (층×100000+점수) 복합값 — 층만 디코드해 보여준다.
          var floor = Math.floor((Number(e.best_score) || 0) / 100000);
          return (i + 1) + '위 ' + String(e.player_name || '말랑이').slice(0, 10) + ' ' + floor + '층';
        });
        el.textContent = '🏆 이번 주 최고 · ' + parts.join(' · ');
        el.classList.remove('is-hidden');
      })
      .catch(function () { /* 네트워크 불가 — 무시 */ });
  }
  function init() {
    loadPersonalBest();
    loadUnlocks();
    renderPbNote();
    hudBest.textContent = personalBest.step;
    preloadArt();
    buildFxPools();
    applyTheme(0);
    buildCharPick();
    bind();
    syncSoundButton();
    renderWeeklyTop();
    if (isRoomEntry) {
      connectRoom();
    }
  }
  init();
})();
