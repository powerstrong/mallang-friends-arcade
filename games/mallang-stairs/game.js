/* game.js — 말랑 계단 레이스 컨트롤러 (window 전역, ES모듈 아님)
 *
 * 렌더링·입력·UI·게임루프·결과 처리만 담당한다.
 * 핵심 판정은 stairs-engine.js 가, 멀티 전송은 multiplayer.js 가 맡는다.
 * 싱글과 멀티는 같은 engine 을 쓴다 (멀티라고 규칙이 달라지지 않는다).
 */
(function () {
  'use strict';

  var Chars = window.MallangCharacters;
  var Engine = window.MallangStairsEngine;
  var Boot = window.GameBoot || { submitResult: function () {}, exit: function () {} };

  // ---- 레이아웃 상수 ----
  var STEP_DX = 72;   // 계단 간 가로 간격(px)
  var STEP_DY = 56;   // 계단 간 세로 간격(px)
  var POOL = 18;      // 계단 DOM 풀 크기
  var ROUND_MS = 45000; // 멀티 라운드 제한시간

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var setupScreen = $('setupScreen'), playScreen = $('playScreen');
  var stage = $('stage'), stairLayer = $('stairLayer');
  var playerEl = $('player'), playerImg = $('playerImg');
  var hudStep = $('hudStep'), hudScore = $('hudScore'), hudCombo = $('hudCombo');
  var timeFill = $('timeFill'), feverFill = $('feverFill'), timeGauge = timeFill.parentElement;
  var rivalWrap = $('rivalWrap'), feverFx = $('feverFx'), floatLayer = $('floatLayer');
  var countdown = $('countdown'), countNum = $('countNum');
  var charIntro = $('charIntro'), introImg = $('introImg'), introName = $('introName'),
      introAbility = $('introAbility'), introTag = $('introTag');
  var resultOverlay = $('resultOverlay');

  // ---- 상태 ----
  var selectedId = 'mochi-rabbit'; // 셋업에서 선택한 id ('random' 가능)
  var activeChar = null;           // 이번 판 실제 캐릭터 객체
  var engine = null;
  var mp = window.MallangStairsMP ? window.MallangStairsMP.create() : null;
  var playing = false;
  var rafId = 0;
  var lastTs = 0;
  var camX = 0, camY = 0, camTX = 0, camTY = 0;
  var xCache = [0];                // stepX 누적 캐시
  var poolNodes = [];
  var roundDeadline = 0;
  var isMulti = false;

  // ---- 좌표 ----
  function stepX(i) {
    while (xCache.length <= i) {
      var k = xCache.length;
      xCache.push(xCache[k - 1] + engine.dirAt(k) * STEP_DX);
    }
    return xCache[i];
  }
  function stepY(i) { return -i * STEP_DY; }
  function homeX() { return stage.clientWidth / 2; }
  function homeY() { return stage.clientHeight * 0.64; }
  function placePlayer() {
    playerEl.style.transform = 'translate3d(' + homeX() + 'px,' + homeY() + 'px,0)';
  }

  // ---- 셋업 화면 ----
  function buildCharPick() {
    var pick = $('charPick');
    pick.innerHTML = '';
    Chars.PUBLIC_LIST.forEach(function (c) {
      pick.appendChild(makeChip(c.id, c.assets.main, c.name, false));
    });
    pick.appendChild(makeChip('random', null, '랜덤', true));
    selectChar('mochi-rabbit');
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
                     '<span class="char-chip__label">' + label + '</span>';
    }
    el.addEventListener('click', function () { selectChar(id); });
    return el;
  }
  function selectChar(id) {
    selectedId = id;
    Array.prototype.forEach.call(document.querySelectorAll('.char-chip'), function (el) {
      el.classList.toggle('is-selected', el.dataset.id === id);
    });
    var setupImg = $('setupCharImg'), name = $('setupCharName'),
        role = $('setupCharRole'), ability = $('setupCharAbility');
    if (id === 'random') {
      setupImg.src = '';
      setupImg.style.visibility = 'hidden';
      name.textContent = '랜덤 추첨';
      role.textContent = '누가 나올까?';
      ability.textContent = '숨겨진 친구(라떼·민트)도 등장할 수 있어요!';
    } else {
      var c = Chars.get(id);
      setupImg.src = c.assets.main;
      setupImg.style.visibility = 'visible';
      name.textContent = c.name;
      role.textContent = c.role;
      ability.textContent = c.desc;
    }
  }

  // ---- 캐릭터 확정 (랜덤이면 추첨) ----
  function resolveCharacter() {
    var id = selectedId === 'random' ? Chars.pickRandomId() : selectedId;
    return Chars.get(id);
  }
  function preloadPoses(c) {
    Object.keys(c.assets).forEach(function (k) { var im = new Image(); im.src = c.assets[k]; });
  }

  // ---- 계단 풀 ----
  function buildPool() {
    stairLayer.innerHTML = '';
    poolNodes = [];
    for (var i = 0; i < POOL; i++) {
      var el = document.createElement('div');
      el.className = 'stair';
      el.innerHTML = '<span class="stair__booster"></span>';
      stairLayer.appendChild(el);
      poolNodes.push(el);
    }
  }
  function layoutStairs() {
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
    return t === 'speed' ? '⚡' : t === 'stable' ? '🛡️' : t === 'combo' ? '🔥' : '⭐';
  }

  // ---- 화면 전환 ----
  function show(screen) {
    setupScreen.classList.toggle('is-active', screen === 'setup');
    playScreen.classList.toggle('is-active', screen === 'play');
  }

  // ---- 라운드 시작 ----
  function beginRound(seedStr) {
    if (playing) return; // idempotent guard
    activeChar = resolveCharacter();
    preloadPoses(activeChar);
    engine = Engine.create({ seed: seedStr, character: activeChar });
    xCache = [0];
    buildPool();
    playerImg.src = activeChar.assets.main;
    playerEl.classList.remove('is-dead');
    resultOverlay.classList.add('is-hidden');
    feverFx.classList.remove('is-on');
    // 플레이 화면을 먼저 표시해야 stage 가 실제 폭/높이를 가진다.
    // (display:none 상태에서 homeX()를 재면 0 이 나와 카메라가 좌측에서 밀려 들어온다.)
    show('play');
    placePlayer();
    camX = camTX = homeX() - stepX(0);
    camY = camTY = homeY() - stepY(0);
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';
    layoutStairs();
    updateHud(engine.getState());

    var rolledSecret = (selectedId === 'random');
    var afterIntro = function () { runCountdown(); };
    if (rolledSecret) { showIntro(activeChar, afterIntro); }
    else { afterIntro(); }
  }

  function showIntro(c, done) {
    introImg.src = c.assets.main;
    introName.textContent = c.name;
    introAbility.textContent = c.desc;
    introTag.textContent = c.secret ? '✨ 히든 당첨! ✨' : '랜덤 등장!';
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
    roundDeadline = (isMulti ? ROUND_MS : Infinity);
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  // ---- 입력 ----
  function doInput(dir) {
    if (!playing) return;
    var ev = engine.input(dir);
    if (!ev) return;
    flashTouch(dir);
    if (ev.dead) { onDeath(); return; }
    // 성공 연출
    playerImg.src = dir < 0 ? activeChar.assets.left : activeChar.assets.right;
    hop();
    if (ev.grade) popFloat(ev.grade, ev.gain);
    if (ev.booster) popBooster(ev.booster);
    if (ev.fever && !feverFx.classList.contains('is-on')) enterFever();
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
  function popBooster(type) {
    spawnFloat(boosterIcon(type) + ' GET', 'good', 110);
  }
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

  // ---- 루프 ----
  function frame(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(64, ts - lastTs); // 탭 비활성 등 급증 방지
    lastTs = ts;

    engine.tick(dt);
    var s = engine.getState();

    if (s.dead) { onDeath(); return; }

    // 멀티 라운드 타이머
    if (isMulti && roundDeadline !== Infinity) {
      roundDeadline -= dt;
      if (roundDeadline <= 0) { finishRound(); return; }
    }

    // 카메라 추적 (부드러운 lerp)
    camTX = homeX() - stepX(s.pos);
    camTY = homeY() - stepY(s.pos);
    camX += (camTX - camX) * 0.18;
    camY += (camTY - camY) * 0.18;
    stairLayer.style.transform = 'translate3d(' + camX + 'px,' + camY + 'px,0)';

    // 피버 유지/종료
    if (!s.feverActive && feverFx.classList.contains('is-on')) feverFx.classList.remove('is-on');
    if (s.feverActive && Math.random() < 0.3) spawnStar();

    updateHud(s);

    // 멀티 스냅샷
    if (isMulti && mp) { mp.sendSnapshot(s); renderRivals(); }

    rafId = requestAnimationFrame(frame);
  }

  function updateHud(s) {
    hudStep.textContent = s.pos;
    hudScore.textContent = s.score;
    hudCombo.textContent = s.combo;
    timeFill.style.transform = 'scaleX(' + Math.max(0, s.gaugeRatio) + ')';
    feverFill.style.transform = 'scaleX(' + Math.min(1, s.feverRatio) + ')';
    timeGauge.classList.toggle('is-danger', s.gaugeRatio < 0.25);
  }

  // ---- 멀티 라이벌 표시 ----
  function renderRivals() {
    var rs = mp.remotes();
    var ids = Object.keys(rs);
    if (!ids.length) { rivalWrap.innerHTML = ''; return; }
    var html = '';
    ids.forEach(function (id) {
      var r = rs[id];
      var pct = Math.min(100, (r.step || 0) / 1.2);
      html += '<div class="rival__row' + (r.alive === false ? ' is-dead' : '') + '">' +
        '<span class="rival__name">' + escapeHtml(r.name || '친구') + '</span>' +
        '<span class="rival__bar"><i style="width:' + pct + '%"></i></span>' +
        '<span>' + (r.step || 0) + '</span></div>';
    });
    rivalWrap.innerHTML = html;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- 사망 / 결과 ----
  function onDeath() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    var s = engine.getState();
    playerImg.src = activeChar.assets.fall;
    playerEl.classList.add('is-dead');
    stage.classList.add('is-shake');
    setTimeout(function () { stage.classList.remove('is-shake'); }, 320);
    if (isMulti && mp) mp.sendSnapshot(s, true);
    setTimeout(function () { showResult(s); }, 650);
  }

  function finishRound() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    showResult(engine.getState());
  }

  function showResult(s) {
    Boot.submitResult({ score: s.score, step: s.pos, maxCombo: s.maxCombo });
    $('resStep').textContent = s.pos;
    $('resScore').textContent = s.score;
    $('resCombo').textContent = s.maxCombo;
    $('resPerfect').textContent = s.perfectCount;
    $('resultCharImg').src = activeChar.assets.main;
    $('resCharName').textContent = activeChar.name;
    $('resCharAbility').textContent = activeChar.desc;
    $('resultTitle').textContent = s.deadReason === 'gauge' ? '시간 초과!' :
      (s.deadReason === 'wrong' ? '발을 헛디뎠어요!' : '라운드 종료!');

    var rankEl = $('resultRank');
    if (isMulti && mp) {
      var rows = [{ name: '나', step: s.pos, score: s.score, me: true }];
      var rs = mp.remotes();
      Object.keys(rs).forEach(function (id) {
        rows.push({ name: rs[id].name || '친구', step: rs[id].step || 0, score: rs[id].score || 0 });
      });
      rows.sort(function (a, b) { return (b.step - a.step) || (b.score - a.score); });
      rankEl.innerHTML = rows.map(function (r, i) {
        return '<div class="result-rank__row' + (r.me ? ' is-me' : '') + '">' +
          '<span>' + (i + 1) + '위 ' + escapeHtml(r.name) + '</span>' +
          '<span>' + r.step + '층 · ' + r.score + '점</span></div>';
      }).join('');
      rankEl.classList.remove('is-hidden');
    } else {
      rankEl.classList.add('is-hidden');
    }
    resultOverlay.classList.remove('is-hidden');
  }

  // ---- 시작 동선 ----
  function startSolo() {
    isMulti = false;
    var seed = String(Math.floor(Math.random() * 1e9));
    beginRound(seed);
  }
  function startMulti() {
    if (!mp || !mp.available) {
      $('multiNote').textContent = '멀티는 광장에서 방 코드로 입장하면 자동 연결돼요. 지금은 혼자 도전!';
      return;
    }
    $('multiNote').textContent = '친구와 연결 중…';
    // 이전 리스너 정리 후 재등록 (리트라이 시 핸들러 누적 방지)
    mp.off('start');
    mp.on('start', function () {
      // 상대가 시작 → 동일 시드로 같이 시작 (이미 진행 중이면 idempotent)
      if (!playing) {
        isMulti = true;
        beginRound(mp.seedString());
      }
    });
    mp.connect(activeChar ? activeChar.id : selectedId).then(function (info) {
      isMulti = true;
      mp.broadcastStart();
      beginRound(mp.seedString());
    }).catch(function () {
      $('multiNote').textContent = '연결에 실패했어요. 혼자 도전으로 즐겨주세요!';
    });
  }

  // ---- 키보드 입력 ----
  function onKey(e) {
    if (e.repeat) return;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') { e.preventDefault(); doInput(-1); }
    else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { e.preventDefault(); doInput(1); }
  }

  // ---- 바인딩 ----
  function bind() {
    // 터치/클릭: 화면 좌우 절반. pointerdown 즉시 판정.
    stage.addEventListener('pointerdown', function (e) {
      if (!playing) return;
      var dir = (e.clientX < stage.getBoundingClientRect().left + stage.clientWidth / 2) ? -1 : 1;
      doInput(dir);
    });
    window.addEventListener('keydown', onKey);

    $('startSolo').addEventListener('click', startSolo);
    $('startMulti').addEventListener('click', startMulti);
    $('retryBtn').addEventListener('click', function () {
      resultOverlay.classList.add('is-hidden');
      if (isMulti) { startMulti(); } else { startSolo(); }
    });
    $('exitBtn').addEventListener('click', function () { if (mp) mp.leave(); Boot.exit(); });
  }

  // ---- 부트 ----
  function init() {
    buildCharPick();
    bind();
    // 방 코드로 진입(광장 멀티)했다면 안내
    if (Boot.isMultiplayer) {
      $('multiNote').textContent = '방 코드 감지! [친구와 경쟁]으로 함께 시작해요.';
    }
  }
  init();
})();