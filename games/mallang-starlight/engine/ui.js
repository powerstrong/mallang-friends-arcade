(function () {
  'use strict';
  var P = window.MallangPuzzle, Z = window.MallangPuzzles;
  if (!P || !Z) throw new Error('엔진과 퍼즐 데이터가 먼저 로드되어야 합니다.');

  var SAVE_KEY = 'mallang-starlight-save-v3', SAVE_VERSION = 3;
  var state = null, initial = null, puzzle = null, puzzleId = null;
  var history = [];                        // 이전 상태(되돌리기)
  var reserved = { latte: null, mint: null };
  var sel = null;                          // { friendId, to } 명령 조립 중
  var busy = false;
  var cells = [], unitEls = Object.create(null), starEls = Object.create(null), fxNodes = [];

  var ids = ['homeScreen','battleScreen','resultScreen','homeSound','puzzleList','progress','continueButton','howButton',
    'battleMenu','battleTitle','battleLocation','beatText','parText','goalText','board','previewLine','hint',
    'slotLatte','slotMint','btnUndo','btnRestart','btnGo','resultEyebrow','resultTitle','resultStars','resultCopy',
    'resultBeats','resultDamage','resultNext','resultRetry','resultHome','menuDialog','menuContinue','menuHow','menuQuit',
    'howDialog','howText','howClose','announcer'];
  var el = {}; ids.forEach(function (id) { el[id] = document.getElementById(id); });

  // ── 저장 ──────────────────────────────────────────────────────────────────────
  function newSave() { return { version: SAVE_VERSION, unlocked: 1, puzzles: {}, sound: true, seenGuide: false }; }
  function readSave() {
    try {
      var p = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!p || p.version !== SAVE_VERSION) return newSave();
      p.puzzles = p.puzzles || {}; p.unlocked = Math.max(1, Number(p.unlocked) || 1);
      if (typeof p.sound !== 'boolean') p.sound = true;
      if (typeof p.seenGuide !== 'boolean') p.seenGuide = false;
      return p;
    } catch (e) { return newSave(); }
  }
  var save = readSave();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

  // ── 오디오(WebAudio 합성, 파일 없음) ───────────────────────────────────────────
  var ac = null, master = null, bgm = { timer: null, next: 0, step: 0, gain: null, on: false };
  function audio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      master = ac.createGain(); master.gain.value = .9; master.connect(ac.destination); }
    if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
    return ac;
  }
  function tone(f, at, dur, type, peak, dest) {
    var o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), at + .012);
    g.gain.exponentialRampToValueAtTime(.0001, at + dur); o.connect(g); g.connect(dest || master); o.start(at); o.stop(at + dur + .03);
  }
  var SFX = { tap:[[520,0,.05,'sine',.05]], pick:[[600,0,.05,'sine',.06],[820,.05,.07,'sine',.05]],
    push:[[300,0,.06,'triangle',.06],[440,.05,.08,'triangle',.05]], repair:[[660,0,.06,'sine',.06],[880,.06,.08,'sine',.06],[1175,.15,.14,'sine',.05]],
    hurt:[[220,0,.09,'square',.06],[150,.03,.1,'square',.05]], win:[[523,0,.13,'triangle',.06],[659,.11,.13,'triangle',.06],[784,.22,.15,'triangle',.06],[1047,.34,.3,'triangle',.06]],
    fail:[[330,0,.16,'sine',.06],[247,.15,.2,'sine',.06],[185,.33,.32,'sine',.05]] };
  function beep(k) { if (!save.sound) return; var c = audio(); if (!c) return; try { (SFX[k] || SFX.tap).forEach(function (n) { tone(n[0], c.currentTime + .001 + n[1], n[2], n[3], n[4], master); }); } catch (e) {} }
  var PROG = [{ b:130.81, a:[261.63,329.63,392,523.25] },{ b:110, a:[329.63,440,523.25,440] },{ b:87.31, a:[349.23,440,523.25,659.25] },{ b:98, a:[392,493.88,587.33,493.88] }];
  function bgmTick() { if (!ac || !bgm.on) return; var step = .34;
    while (bgm.next < ac.currentTime + .25) { var ch = PROG[Math.floor(bgm.step/4)%PROG.length], beat = bgm.step%4;
      if (beat === 0) { tone(ch.b, bgm.next, step*3.6, 'sine', .05, bgm.gain); ch.a.forEach(function (f) { tone(f/2, bgm.next, step*3.6,'sine',.014,bgm.gain); }); }
      tone(ch.a[beat], bgm.next, step*1.3, 'triangle', .03, bgm.gain);
      bgm.next += step; bgm.step = (bgm.step+1)%(PROG.length*4); } }
  function bgmStart() { if (!save.sound) return; var c = audio(); if (!c || c.state !== 'running') return; if (bgm.on && bgm.timer) return;
    if (!bgm.gain) { bgm.gain = c.createGain(); bgm.gain.connect(master); } bgm.gain.gain.value = 1; bgm.on = true; bgm.step = 0; bgm.next = c.currentTime + .1; bgmTick(); bgm.timer = window.setInterval(bgmTick, 60); }
  function bgmStop() { bgm.on = false; if (bgm.timer) { clearInterval(bgm.timer); bgm.timer = null; } }
  document.addEventListener('pointerdown', function () { if (save.sound && document.getElementById('battleScreen').classList.contains('active')) bgmStart(); });

  function say(t) { el.announcer.textContent = ''; window.setTimeout(function () { el.announcer.textContent = t; }, 10); }
  function screens(target) { [el.homeScreen, el.battleScreen, el.resultScreen].forEach(function (s) { s.classList.toggle('active', s === target); }); window.scrollTo(0, 0); }
  function starStr(n) { var s = ''; for (var i = 0; i < 3; i += 1) s += i < n ? '★' : '☆'; return s; }
  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
  function arrowChar(d) { return d.x > 0 ? '▶' : d.x < 0 ? '◀' : d.y > 0 ? '▼' : '▲'; }

  // ── 눌렀을 때 나오는 이펙트(일회성, render와 무관하게 스스로 사라짐) ───────────────
  function spawnAt(cls, x, y, ms) {
    var n = document.createElement('div'); n.className = cls; el.board.appendChild(n); place(n, x, y);
    window.setTimeout(function () { n.remove(); }, ms); return n;
  }
  function ripple(x, y, go) { spawnAt('ripple' + (go ? ' go' : ''), x, y, 480); }
  function floatLabel(x, y, text) { var n = spawnAt('float', x, y, 820); n.textContent = text; }
  function sparkle(x, y) {
    var chars = ['⭐', '✨', '💫', '⭐', '✨', '⭐'];
    for (var i = 0; i < 6; i += 1) {
      var ang = Math.PI * 2 * i / 6, r = 24 + Math.random() * 12;
      var s = spawnAt('spark', x, y, 760); s.textContent = chars[i];
      s.style.setProperty('--dx', Math.round(Math.cos(ang) * r) + 'px');
      s.style.setProperty('--dy', Math.round(Math.sin(ang) * r) + 'px');
    }
  }
  function flashUnit(id, cls, ms) {
    var n = unitEls[id]; if (!n) return;
    n.classList.remove(cls); void n.offsetWidth; n.classList.add(cls);
    window.setTimeout(function () { n.classList.remove(cls); }, ms);
  }
  function popUnit(id) { flashUnit(id, 'pop-fx', 320); }

  // 노는 방법 — 글 대신 미니 보드 그림으로 보여준다.
  function mc(content, cls) { return '<span class="mc' + (cls ? ' ' + cls : '') + '">' + (content || '') + '</span>'; }
  function mini(cols, cells) { return '<span class="mini" style="grid-template-columns:repeat(' + cols + ',27px)">' + cells + '</span>'; }
  function howHtml() {
    var step1 = mini(3, mc('📡') + mc('<span class="ar foe">▶</span>', 'hot') + mc('', 'alt'));
    var step2 = mini(3, mc('🐶') + mc('📡<span class="ar push" style="position:absolute;right:-4px">▶</span>') + mc('', 'wall'));
    var step3 = mini(3, mc('🐱') + mc('<span class="ar pull">◀</span>', 'alt') + mc('📡<span style="position:absolute;font-size:11px;bottom:-2px">⭐</span>'));
    return '<div class="how-visual">' +
      '<div class="how-step">' + step1 + '<div class="how-cap"><b>장난감은 예고대로 움직여요.</b><br>빨간 화살표·표시 칸을 피하세요.</div></div>' +
      '<div class="how-step">' + step2 + '<div class="how-cap"><b>라떼가 밀어</b> 벽에 쿵! → 수리 ✓</div></div>' +
      '<div class="how-step">' + step3 + '<div class="how-cap"><b>민트가 당겨</b> ⭐ 위로 → 수리 ✓</div></div>' +
      '<div class="how-legend">' +
        '<span><span class="sw" style="background:var(--push)"></span>이동·밀기</span>' +
        '<span><span class="sw" style="background:var(--pull)"></span>당기기</span>' +
        '<span><span class="sw" style="background:#e04b61"></span>위험</span>' +
        '<span><span class="sw" style="background:var(--amber)">⭐</span>수리칸</span>' +
      '</div>' +
      '<div class="how-cap" style="text-align:center">친구 탭 → <b>파란 칸</b> → <b>빛나는 장난감</b> → 출동!</div>' +
      '</div>';
  }

  // ── 홈 ────────────────────────────────────────────────────────────────────────
  function renderHome() {
    bgmStop();
    var all = Z.list();
    var done = all.filter(function (p) { return save.puzzles[p.id] && save.puzzles[p.id].stars; }).length;
    el.progress.textContent = done + ' / ' + all.length + ' 완료';
    el.puzzleList.innerHTML = '';
    all.forEach(function (p) {
      var locked = p.order > save.unlocked;
      var rec = save.puzzles[p.id] || { stars: 0 };
      var b = document.createElement('button'); b.type = 'button'; b.disabled = locked; b.className = 'puzzle-card' + (locked ? ' locked' : '');
      b.innerHTML = '<span class="puzzle-no">' + (locked ? '🔒' : p.order) + '</span>' +
        '<span class="puzzle-copy"><b>' + p.title + '</b><span>' + p.location + '</span></span>' +
        '<span class="puzzle-stars">' + starStr(rec.stars) + '</span>';
      b.addEventListener('click', function () { startPuzzle(p.id); });
      el.puzzleList.appendChild(b);
    });
    var next = all.find(function (p) { return p.order <= save.unlocked && !(save.puzzles[p.id] && save.puzzles[p.id].stars); }) || all[Math.min(save.unlocked, all.length) - 1];
    el.continueButton.textContent = done ? '이어서 도전' : '첫 퍼즐 시작';
    el.continueButton.onclick = function () { startPuzzle(next.id); };
    el.homeSound.textContent = save.sound ? '🔊' : '🔇';
    screens(el.homeScreen);
  }

  // ── 퍼즐 시작 ──────────────────────────────────────────────────────────────────
  function startPuzzle(id) {
    puzzle = Z.create(id); puzzleId = id;
    initial = P.createState(puzzle); state = P.clone(initial);
    history = []; reserved = { latte: null, mint: null }; sel = null; busy = false;
    el.battleTitle.textContent = puzzle.title; el.battleLocation.textContent = puzzle.location; el.goalText.textContent = puzzle.brief;
    el.parText.textContent = '최적 ' + puzzle.par;
    buildBoard(); screens(el.battleScreen); bgmStart();
    hint('친구를 탭!'); say(puzzle.title + '. ' + (puzzle.hint || '친구를 탭해 움직이세요.'));
    render(); beep('pick');
    if (!save.seenGuide) { save.seenGuide = true; persist(); window.setTimeout(function () { openHow(); }, 250); }
  }

  function cellSize() { return cells[0][0].getBoundingClientRect().width || 48; }
  function place(node, x, y) { var s = cellSize(); node.style.left = (3 + x * (s + 2)) + 'px'; node.style.top = (3 + y * (s + 2)) + 'px'; }

  function buildBoard() {
    el.board.innerHTML = ''; cells = []; unitEls = Object.create(null); starEls = Object.create(null); fxNodes = [];
    el.board.style.gridTemplateColumns = 'repeat(' + state.width + ', var(--cell))';
    el.board.style.gridTemplateRows = 'repeat(' + state.height + ', var(--cell))';
    for (var y = 0; y < state.height; y += 1) { cells[y] = [];
      for (var x = 0; x < state.width; x += 1) {
        var c = document.createElement('button'); c.type = 'button'; c.className = 'cell' + ((x + y) % 2 ? ' alt' : '');
        if (state.terrain[y][x] === 1) c.classList.add('wall');
        c.setAttribute('aria-label', (x + 1) + '열 ' + (y + 1) + '행');
        (function (cx, cy) { c.addEventListener('click', function () { tapCell(cx, cy); }); })(x, y);
        el.board.appendChild(c); cells[y][x] = c;
      } }
    (state.props || []).forEach(function (p) { if (p.kind !== 'repair-star') return;
      var n = document.createElement('div'); n.className = 'star-tile'; n.textContent = '⭐'; el.board.appendChild(n); starEls[p.id] = n; });
    state.friends.forEach(function (f) { addUnit(f, 'friend'); });
    state.toys.forEach(function (t) { addUnit(t, 'toy'); });
  }
  function addUnit(u, cls) {
    var n = document.createElement('button'); n.type = 'button'; n.className = 'unit ' + cls;
    n.setAttribute('aria-label', u.name || u.id);
    n.innerHTML = '<span class="unit-body"><span class="token-fallback"></span><img alt=""><span class="fixed-badge">✓</span></span>';
    n.querySelector('.token-fallback').textContent = u.emoji || (cls === 'friend' ? '🙂' : '🤖');
    var img = n.querySelector('img'); img.src = u.asset || '';
    img.addEventListener('load', function () { n.querySelector('.token-fallback').hidden = true; });
    img.addEventListener('error', function () { img.hidden = true; });
    (function (id, kind) { n.addEventListener('click', function (e) { e.stopPropagation();
      if (kind === 'friend') { var f = P.getFriend(state, id); if (f && f.hearts > 0) tapFriend(f); }
      else { var t = P.getToy(state, id); if (t && !t.fixed) tapToy(t); } }); })(u.id, cls);
    el.board.appendChild(n); unitEls[u.id] = n;
  }

  // ── 텔레그래프(예고) 계산 ──────────────────────────────────────────────────────
  function telegraph() {
    var danger = {}, beam = {}, arrows = [];
    P.activeToys(state).forEach(function (t) {
      if (!t.intent) return;
      if (t.intent.type === 'dash') {
        arrows.push({ x: t.x, y: t.y, dir: t.intent.dir });
        var x = t.x, y = t.y;
        for (var i = 0; i < (t.intent.dist || 2); i += 1) { x += t.intent.dir.x; y += t.intent.dir.y;
          if (P.isWall(state, x, y) || P.toyAt(state, x, y)) break; danger[x + ',' + y] = { x: x, y: y };
          if (P.friendAt(state, x, y)) break; }
      } else if (t.intent.type === 'beam') {
        P.beamTiles(state, t).forEach(function (tile) { beam[tile.x + ',' + tile.y] = tile; });
      }
    });
    return { danger: danger, beam: beam, arrows: arrows };
  }

  function reservedList() { return [reserved.latte, reserved.mint].filter(Boolean); }
  function clearFx() { fxNodes.forEach(function (n) { n.remove(); }); fxNodes = []; }
  function addFx(node) { el.board.appendChild(node); fxNodes.push(node); }

  function render() {
    if (!state) return;
    el.beatText.textContent = state.beat + '비트';
    // 셀 마크
    for (var y = 0; y < state.height; y += 1) for (var x = 0; x < state.width; x += 1)
      cells[y][x].classList.remove('reach', 'pick', 'danger', 'beam');
    var tg = telegraph();
    Object.keys(tg.beam).forEach(function (k) { var t = tg.beam[k]; cells[t.y][t.x].classList.add('beam'); });
    Object.keys(tg.danger).forEach(function (k) { var t = tg.danger[k]; cells[t.y][t.x].classList.add('danger'); });
    // 선택 중: 도달 칸
    if (sel && !sel.to) P.reachable(state, sel.friendId).forEach(function (nd) { cells[nd.y][nd.x].classList.add('reach'); });
    if (sel && sel.to) cells[sel.to.y][sel.to.x].classList.add('reach', 'pick');
    // 별
    (state.props || []).forEach(function (p) { var n = starEls[p.id]; if (n) place(n, p.x, p.y); });
    // 유닛
    state.friends.forEach(function (f) { var n = unitEls[f.id]; if (!n) return;
      n.style.display = f.hearts > 0 ? 'grid' : 'none'; if (f.hearts <= 0) return; place(n, f.x, f.y);
      n.classList.toggle('selected', sel && sel.friendId === f.id);
      n.classList.toggle('reserved', Boolean(reserved[f.id]));
      hearts(n, f);
    });
    state.toys.forEach(function (t) { var n = unitEls[t.id]; if (!n) return; place(n, t.x, t.y);
      n.classList.toggle('fixed', Boolean(t.fixed)); gauge(n, t); });
    // 텔레그래프 화살표
    clearFx();
    tg.arrows.forEach(function (a) { var n = document.createElement('div'); n.className = 'arrow';
      n.textContent = a.dir.x > 0 ? '▶' : a.dir.x < 0 ? '◀' : a.dir.y > 0 ? '▼' : '▲';
      addFx(n); place(n, a.x, a.y); n.style.display = 'grid'; n.style.placeItems = 'center'; n.style.width = 'var(--cell)'; n.style.height = 'var(--cell)'; });
    renderAffordances();
    renderPreview();
    renderGoal();
    renderSlots();
    renderButtons();
  }

  // 조작 가능한 장난감을 스스로 빛나게 하고, 밀/당김 방향을 화살표로 보여준다(글 대신 그림).
  function abilityArrow(cls, type, toy, dir) {
    var tx = toy.x + dir.x, ty = toy.y + dir.y;
    if (!P.inBounds(state, tx, ty)) { tx = toy.x; ty = toy.y; }
    var n = document.createElement('div');
    n.className = cls + ' ' + (type === 'push' ? 'push' : 'pull');
    n.textContent = arrowChar(dir);
    addFx(n); place(n, tx, ty);
  }
  function renderAffordances() {
    state.toys.forEach(function (t) { var n = unitEls[t.id]; if (n) n.classList.remove('act-push', 'act-pull'); });
    if (sel && sel.to) {
      var f = P.getFriend(state, sel.friendId);
      P.abilitiesFrom(state, f, sel.to).forEach(function (ab) {
        var t = P.getToy(state, ab.toyId); if (!t) return;
        var dir = ab.type === 'push' ? ab.dir : { x: sign(sel.to.x - t.x), y: sign(sel.to.y - t.y) };
        var n = unitEls[t.id]; if (n) n.classList.add(ab.type === 'push' ? 'act-push' : 'act-pull');
        abilityArrow('aff-arrow', ab.type, t, dir);
      });
    }
    reservedList().forEach(function (cmd) {
      // 친구가 이동할 목적지를 발자국으로 표시(어디로 갈지 한눈에).
      var f = P.getFriend(state, cmd.friendId);
      if (f && (cmd.to.x !== f.x || cmd.to.y !== f.y)) {
        var d = document.createElement('div'); d.className = 'dest-mark ' + cmd.friendId;
        d.innerHTML = '<span class="ring"></span><span>👣</span>';
        addFx(d); place(d, cmd.to.x, cmd.to.y);
      }
      if (!cmd.ability) return;
      var t = P.getToy(state, cmd.ability.toyId); if (!t) return;
      var dir = cmd.ability.type === 'push' ? cmd.ability.dir : { x: sign(cmd.to.x - t.x), y: sign(cmd.to.y - t.y) };
      abilityArrow('cmd-arrow', cmd.ability.type, t, dir);
    });
  }
  function renderGoal() {
    if (!el.goalText) return;
    var pips = state.toys.map(function (t) {
      return '<span class="toy-pip' + (t.fixed ? ' done' : '') + '">' + (t.fixed ? '✓' : (t.emoji || '🤖')) + '</span>';
    }).join('');
    var remain = P.activeToys(state).length;
    el.goalText.innerHTML = pips + '<span class="lbl">' + (remain ? '남은 수리 ' + remain : '모두 수리! 🎉') + '</span>';
  }
  function hearts(n, f) { var h = n.querySelector('.hearts'); if (!h) { h = document.createElement('span'); h.className = 'hearts'; n.querySelector('.unit-body').appendChild(h); }
    h.innerHTML = ''; for (var i = 0; i < f.maxHearts; i += 1) { var d = document.createElement('i'); if (i >= f.hearts) d.className = 'lost'; h.appendChild(d); } }
  function gauge(n, t) { var g = n.querySelector('.gauge'); if (t.fixed) { if (g) g.style.display = 'none'; return; }
    if (!g) { g = document.createElement('span'); g.className = 'gauge'; g.innerHTML = '<i></i>'; n.querySelector('.unit-body').appendChild(g); }
    g.style.display = t.repair > 1 ? 'block' : 'none';
    g.querySelector('i').style.width = Math.round(Math.max(0, t.gauge) / t.repair * 100) + '%'; }

  // 예상 결과(예약된 명령 기준)
  function renderPreview() {
    var cmds = reservedList();
    if (!cmds.length) { el.previewLine.textContent = ''; return; }
    var res = P.previewBeat(state, cmds);
    if (!res) { el.previewLine.textContent = '⚠ 두 친구가 같은 칸으로 갈 수 없어요.'; return; }
    var after = res.state;
    var fixedNow = after.toys.filter(function (t) { return t.fixed; }).length - state.toys.filter(function (t) { return t.fixed; }).length;
    var dmg = friendDamage(after) - friendDamage(state);
    // 고스트: 장난감 예상 위치 / 수리, 친구 피해
    after.toys.forEach(function (t) { var cur = P.getToy(state, t.id);
      if (t.fixed && !cur.fixed) ghost(t.x, t.y, false, '✓');
      else if (!t.fixed && (t.x !== cur.x || t.y !== cur.y)) ghost(t.x, t.y, false, ''); });
    after.friends.forEach(function (f) { var cur = state.friends.find(function (o) { return o.id === f.id; });
      if (f.hearts < cur.hearts) ghost(f.x, f.y, true, '💔'); });
    var parts = [];
    if (fixedNow > 0) parts.push('✓ 수리 ' + fixedNow);
    if (dmg > 0) parts.push('💔 피해 ' + dmg); else parts.push('💚 무피해');
    el.previewLine.textContent = '미리보기 · ' + parts.join(' · ');
  }
  function friendDamage(s) { return s.friends.reduce(function (a, f) { return a + (f.maxHearts - f.hearts); }, 0); }
  function ghost(x, y, hit, label) { var n = document.createElement('div'); n.className = 'ghost' + (hit ? ' hit' : '');
    n.innerHTML = '<span class="ring"></span>'; if (label) { var s = document.createElement('span'); s.textContent = label; s.style.position = 'absolute'; s.style.fontSize = 'calc(var(--cell)*.4)'; n.appendChild(s); }
    addFx(n); place(n, x, y); }

  // 슬롯 상태를 문장 대신 짧은 라벨 + 아이콘으로 보여준다.
  function renderSlots() {
    [['latte', el.slotLatte], ['mint', el.slotMint]].forEach(function (pair) {
      var fid = pair[0], slot = pair[1];
      var f = P.getFriend(state, fid), cmd = reserved[fid];
      var selecting = sel && sel.friendId === fid;
      slot.classList.toggle('set', Boolean(cmd));
      slot.classList.toggle('sel', Boolean(selecting));
      var stEl = slot.querySelector('.slot-state'), mk = slot.querySelector('.slot-mark');
      if (!f || f.hearts <= 0) { stEl.textContent = '지침'; mk.textContent = '💤'; return; }
      if (cmd) {
        if (cmd.ability) { stEl.textContent = cmd.ability.type === 'push' ? '밀기!' : '당기기!'; mk.textContent = '✓'; }
        else { stEl.textContent = '이동만'; mk.textContent = '👣'; }
      } else if (selecting) {
        stEl.textContent = sel.to ? '대상 고르기' : '갈 곳 정하기'; mk.textContent = '✦';
      } else { stEl.textContent = '대기'; mk.textContent = ''; }
    });
  }
  function renderButtons() {
    el.btnUndo.disabled = busy || history.length === 0;
    el.btnRestart.disabled = busy;
    var cmds = reservedList();
    var ok = cmds.length > 0 && !busy && !!P.previewBeat(state, cmds) && state.status === 'active';
    el.btnGo.disabled = !ok;
  }
  function hint(t) { el.hint.textContent = t; }

  // ── 조작 ──────────────────────────────────────────────────────────────────────
  function tapFriend(f) {
    if (busy || state.status !== 'active') return;
    sel = { friendId: f.id, to: null };
    hint('파란 칸으로');
    say((f.name || f.id) + ' 선택, 파란 칸으로 이동을 정하세요');
    popUnit(f.id); ripple(f.x, f.y); beep('pick'); render();
  }
  function tapCell(x, y) {
    if (busy || state.status !== 'active' || !sel) return;
    if (sel && !sel.to) {
      var reach = P.reachable(state, sel.friendId).some(function (nd) { return nd.x === x && nd.y === y; });
      if (!reach) return;
      sel.to = { x: x, y: y };
      // 이동만 명령을 즉시 예약(능력은 빛나는 장난감 탭으로 추가)
      reserved[sel.friendId] = { friendId: sel.friendId, to: { x: x, y: y }, ability: null };
      var abils = P.abilitiesFrom(state, P.getFriend(state, sel.friendId), sel.to);
      hint(abils.length ? '빛나는 장난감을 탭!' : '이동만 · 출동 준비');
      say(abils.length ? '빛나는 장난감을 밀거나 당길 수 있어요' : '이동만 예약했어요');
      ripple(x, y); beep('tap'); render();
    }
  }
  function tapToy(t) {
    if (busy || state.status !== 'active') return;
    if (!sel || !sel.to) { hint('먼저 친구와 갈 곳을'); return; }
    var f = P.getFriend(state, sel.friendId);
    var abils = P.abilitiesFrom(state, f, sel.to).filter(function (a) { return a.toyId === t.id; });
    if (!abils.length) { hint('여기선 닿지 않아요'); return; }
    reserved[sel.friendId] = { friendId: sel.friendId, to: sel.to, ability: abils[0] };
    sel = null;
    hint('출동 준비 완료!'); say('명령 예약됨');
    popUnit(t.id); beep('push'); render();
  }
  function clearSlot(fid) { reserved[fid] = null; if (sel && sel.friendId === fid) sel = null; render(); }

  function go() {
    var cmds = reservedList(); if (busy || !cmds.length) return;
    var res = P.applyBeat(state, cmds); if (!res.ok) return;
    busy = true; history.push(P.clone(state));
    var goSpots = cmds.map(function (c) { return c.to; });
    state = res.state; sel = null; reserved = { latte: null, mint: null };
    render();
    goSpots.forEach(function (s) { ripple(s.x, s.y, true); });
    beep('push');
    playEvents(res.events || []);
    window.setTimeout(function () { busy = false;
      if (state.status !== 'active') return outcome();
      hint(''); render();
    }, 380);
  }
  // 결과 이펙트: 유닛 이동(0.28s) 뒤에 수리 반짝임·피해 흔들림을 재생한다.
  function playEvents(events) {
    window.setTimeout(function () {
      events.forEach(function (ev) {
        if (ev.type === 'toy-fixed') {
          var t = P.getToy(state, ev.toyId);
          if (t) { flashUnit(t.id, 'repaired-fx', 640); sparkle(t.x, t.y); floatLabel(t.x, t.y, '수리! ✓'); }
          beep('repair');
        } else if (ev.type === 'toy-repaired-star') {
          var ts = P.getToy(state, ev.toyId); if (ts) sparkle(ts.x, ts.y);
        } else if (ev.type === 'friend-hit') {
          var f = P.getFriend(state, ev.friendId);
          if (f) { flashUnit(f.id, 'hurt-fx', 440); floatLabel(f.x, f.y, '💔'); }
          beep('hurt');
        }
      });
    }, 200);
  }
  function undo() { if (busy || !history.length) return; state = history.pop(); sel = null; reserved = { latte: null, mint: null }; hint('되돌림'); say('한 비트 되돌렸어요'); beep('tap'); render(); }
  function restart() { if (busy) return; state = P.clone(initial); history = []; sel = null; reserved = { latte: null, mint: null }; hint('다시!'); say('처음부터 다시'); beep('tap'); render(); }

  function stars() { if (state.status !== 'victory') return 0;
    var beatsUsed = state.beat - 1; var s = 1;
    if (friendDamage(state) === 0) s += 1;
    if (beatsUsed <= puzzle.par) s += 1; return s; }
  function outcome() {
    bgmStop(); var won = state.status === 'victory', earned = stars();
    var beatsUsed = state.beat - 1, dmg = friendDamage(state);
    if (won) { var old = save.puzzles[puzzleId] || { stars: 0, bestBeats: 999 };
      save.puzzles[puzzleId] = { stars: Math.max(old.stars, earned), bestBeats: Math.min(old.bestBeats, beatsUsed) };
      var order = puzzle.order; save.unlocked = Math.max(save.unlocked, order + 1); persist(); }
    el.resultEyebrow.textContent = won ? puzzle.title + ' 완료' : '다시 도전';
    el.resultTitle.textContent = won ? '수리 완료!' : '아직이에요';
    el.resultStars.textContent = starStr(earned);
    el.resultCopy.textContent = won ? (earned === 3 ? '완벽해요! 피해 없이 최적 비트로 풀었어요.' : '모든 장난감을 수리했어요. 더 적은 비트·무피해로 ⭐⭐⭐에 도전!') : (P.evaluate(state).reason || '다시 준비해요.');
    el.resultBeats.textContent = beatsUsed; el.resultDamage.textContent = dmg;
    var all = Z.list(); el.resultNext.classList.toggle('hidden', !(won && puzzle.order < all.length));
    el.resultNext.onclick = function () { startPuzzle(all[puzzle.order].id); };
    screens(el.resultScreen); beep(won ? 'win' : 'fail');
    if (window.GameBoot && window.GameBoot.submitResult) window.GameBoot.submitResult({ score: earned * 100, won: won });
  }

  function openHow() { el.howText.innerHTML = howHtml(); el.howDialog.showModal(); }

  // ── 이벤트 배선 ────────────────────────────────────────────────────────────────
  el.homeSound.addEventListener('click', function () { save.sound = !save.sound; persist(); if (!save.sound) bgmStop(); el.homeSound.textContent = save.sound ? '🔊' : '🔇'; beep('tap'); });
  el.howButton.addEventListener('click', openHow);
  el.howClose.addEventListener('click', function () { el.howDialog.close(); });
  el.battleMenu.addEventListener('click', function () { if (!busy) el.menuDialog.showModal(); });
  el.menuContinue.addEventListener('click', function () { el.menuDialog.close(); });
  el.menuHow.addEventListener('click', function () { el.menuDialog.close(); openHow(); });
  el.menuQuit.addEventListener('click', function () { el.menuDialog.close(); renderHome(); });
  el.slotLatte.addEventListener('click', function () { if (reserved.latte) clearSlot('latte'); else { var f = P.getFriend(state, 'latte'); if (f && f.hearts > 0) tapFriend(f); } });
  el.slotMint.addEventListener('click', function () { if (reserved.mint) clearSlot('mint'); else { var f = P.getFriend(state, 'mint'); if (f && f.hearts > 0) tapFriend(f); } });
  el.btnGo.addEventListener('click', go);
  el.btnUndo.addEventListener('click', undo);
  el.btnRestart.addEventListener('click', restart);
  el.resultRetry.addEventListener('click', function () { startPuzzle(puzzleId); });
  el.resultHome.addEventListener('click', renderHome);
  window.addEventListener('resize', function () { if (state) render(); });

  window.__mallangStarlight = {
    getState: function () { return state ? P.clone(state) : null; },
    getSave: function () { return P.clone(save); },
    getReserved: function () { return P.clone(reserved); },
    startPuzzle: startPuzzle,
    reserve: function (fid, cmd) { reserved[fid] = cmd; render(); },
    go: go, undo: undo, restart: restart,
    clearSave: function () { save = newSave(); persist(); renderHome(); }
  };
  renderHome();
})();
