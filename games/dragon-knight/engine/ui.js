(function () {
  'use strict';
  var R = window.MallangTacticsRules;
  if (!R) throw new Error('MallangTacticsRules가 먼저 로드되어야 합니다.');

  var N = 8;
  var TERRAIN = [
    [0,0,0,0,0,0,0,0],
    [0,0,1,1,0,0,0,0],
    [0,0,0,0,0,2,2,0],
    [0,0,0,0,0,2,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,1,1,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0]
  ];

  var state = R.createState({
    version: 1, width: N, height: N, terrain: TERRAIN, phase: 'you', turn: 1,
    rng: { seed: 20260808 },
    objective: { type: 'eliminate', targetTeam: 'foe', text: '오작동 장난감을 모두 멈추세요' },
    units: [
      {id:'latte',team:'you',name:'라떼 강아지',emoji:'🐶',sprite:'./assets/units/latte-guardian.png',x:1,y:3,hp:26,maxHp:26,atk:8,def:5,mov:3,range:1},
      {id:'mint',team:'you',name:'민트 고양이',emoji:'🐱',sprite:'./assets/units/mint-starlight.png',x:1,y:4,hp:18,maxHp:18,atk:8,def:2,mov:3,range:2},
      {id:'toy1',team:'foe',name:'삐걱봇',emoji:'🤖',sprite:'./assets/enemies/squeakbot.png',x:6,y:2,hp:15,maxHp:15,atk:7,def:2,mov:3,range:1},
      {id:'toy2',team:'foe',name:'삐걱봇',emoji:'🤖',sprite:'./assets/enemies/squeakbot.png',x:7,y:4,hp:15,maxHp:15,atk:7,def:2,mov:3,range:1},
      {id:'bear',team:'foe',name:'덩치곰 로봇',emoji:'🧸',sprite:'./assets/enemies/bearbot.png',x:6,y:5,hp:22,maxHp:22,atk:9,def:3,mov:2,range:1}
    ]
  });

  var ui = { selectedId: null, previewMove: null, pendingAttack: null, threats: false, busy: false };
  var boardEl = document.getElementById('board');
  var cells = [];
  var unitEls = Object.create(null);
  var infoEl = document.getElementById('info');
  var hintEl = document.getElementById('hint');
  var forecastEl = document.getElementById('forecast');
  var btnThreat = document.getElementById('btnThreat');
  var btnCancel = document.getElementById('btnCancel');
  var btnConfirm = document.getElementById('btnConfirm');
  var btnWait = document.getElementById('btnWait');
  var btnEnd = document.getElementById('btnEnd');

  function buildBoard() {
    for (var y = 0; y < N; y += 1) {
      cells[y] = [];
      for (var x = 0; x < N; x += 1) {
        var cell = document.createElement('div');
        cell.className = 'cell' + ((x + y) % 2 ? ' alt' : '');
        if (TERRAIN[y][x] === 1) cell.className += ' wall';
        if (TERRAIN[y][x] === 2) cell.className += ' water';
        cell.style.gridColumn = x + 1;
        cell.style.gridRow = y + 1;
        (function (cx, cy) { cell.addEventListener('click', function () { onTap(cx, cy); }); })(x, y);
        boardEl.appendChild(cell);
        cells[y][x] = cell;
      }
    }
    state.units.forEach(function (unit) {
      var unitId = unit.id;
      var el = document.createElement('div');
      el.className = 'unit ' + unit.team;
      el.innerHTML = '<div class="body"><span class="token-fallback">' + unit.emoji + '</span>' +
        '<img class="sprite" alt="" src="' + unit.sprite + '"><div class="hpbar"><i></i></div></div>';
      (function (image, fallback) {
        image.addEventListener('load', function () { fallback.hidden = true; });
        image.addEventListener('error', function () { image.remove(); fallback.hidden = false; });
      })(el.querySelector('.sprite'), el.querySelector('.token-fallback'));
      el.addEventListener('click', function (event) {
        var current = R.getUnit(state, unitId);
        event.stopPropagation();
        if (current && current.hp > 0) onTap(current.x, current.y);
      });
      boardEl.appendChild(el);
      unitEls[unitId] = { root: el, hp: el.querySelector('.hpbar>i'), bar: el.querySelector('.hpbar') };
    });
  }

  function cellPixels() { return cells[0][0].getBoundingClientRect().width || 44; }
  function placeElement(el, x, y) {
    var size = cellPixels();
    el.style.left = (2 + x * (size + 2)) + 'px';
    el.style.top = (2 + y * (size + 2)) + 'px';
  }
  function positionFor(unit) {
    if (ui.previewMove && ui.previewMove.actorId === unit.id) return ui.previewMove.to;
    return unit;
  }
  function renderUnits() {
    state.units.forEach(function (unit) {
      var refs = unitEls[unit.id];
      refs.root.style.display = unit.hp > 0 ? 'flex' : 'none';
      if (unit.hp <= 0) return;
      var pos = positionFor(unit);
      placeElement(refs.root, pos.x, pos.y);
      var ratio = Math.max(0, unit.hp) / unit.maxHp;
      refs.hp.style.width = (ratio * 100) + '%';
      refs.bar.classList.toggle('low', ratio <= 0.34);
      refs.root.classList.toggle('acted', unit.team === 'you' && unit.acted);
      refs.root.classList.toggle('sel', unit.id === ui.selectedId);
      refs.root.classList.toggle('preview', Boolean(ui.previewMove && unit.id === ui.selectedId));
    });
  }

  function clearHighlights() {
    cells.forEach(function (row) { row.forEach(function (cell) {
      cell.classList.remove('mv', 'atk', 'path', 'threat', 'goal');
    }); });
  }
  function mark(tile, className) {
    if (tile && cells[tile.y] && cells[tile.y][tile.x]) cells[tile.y][tile.x].classList.add(className);
  }
  function isCurrentFrom(action, actor) {
    return action.from && action.from.x === actor.x && action.from.y === actor.y;
  }
  function renderHighlights() {
    clearHighlights();
    if (ui.threats) R.listThreatenedTiles(state, 'foe').forEach(function (tile) { mark(tile, 'threat'); });
    if (!ui.selectedId || state.phase !== 'you') return;
    var actor = R.getUnit(state, ui.selectedId);
    if (!actor || actor.acted) return;
    var actions = R.listLegalActions(state, actor.id);
    if (ui.previewMove) {
      ui.previewMove.path.forEach(function (tile) { mark(tile, 'path'); });
      mark(ui.previewMove.to, 'mv');
    } else {
      actions.filter(function (a) { return a.type === 'move'; }).forEach(function (a) { mark(a.to, 'mv'); });
      actions.filter(function (a) { return a.type === 'attack' && isCurrentFrom(a, actor); }).forEach(function (a) {
        var target = R.getUnit(state, a.targetId); mark(target, 'atk');
      });
    }
    if (ui.pendingAttack) mark(R.getUnit(state, ui.pendingAttack.targetId), 'atk');
  }

  function renderInfo(unit) {
    if (!unit) {
      infoEl.innerHTML = '<div class="ava you">⭐</div><div class="meta"><div class="nm">친구를 선택하세요</div>' +
        '<div class="st">친구를 탭하면 이동 범위가 표시됩니다.</div></div>';
      return;
    }
    infoEl.innerHTML = '<div class="ava ' + unit.team + '">' + unit.emoji + '</div><div class="meta">' +
      '<div class="nm">' + unit.name + '</div><div class="st">기운 <b>' + Math.max(0,unit.hp) + '/' + unit.maxHp +
      '</b> · 해결 <b>' + unit.atk + '</b> · 버팀 <b>' + unit.def + '</b> · 이동 <b>' + unit.mov +
      '</b> · 거리 <b>' + unit.range + '</b></div></div>';
  }
  function renderForecast() {
    if (!ui.pendingAttack) { forecastEl.classList.remove('show'); forecastEl.textContent = ''; return; }
    var forecast = R.forecastAction(state, ui.pendingAttack);
    var attacker = R.getUnit(state, forecast.actorId), target = R.getUnit(state, forecast.targetId);
    var counter = forecast.counterDamage > 0
      ? ' · 맞대응 <b>' + forecast.counterDamage + '</b> (내 기운 ' + forecast.actorHpBefore + '→' + forecast.actorHpAfter + ')'
      : ' · 맞대응 없음';
    forecastEl.innerHTML = '<b>' + attacker.name + ' → ' + target.name + '</b><br>기운 피해 <b>' + forecast.damage +
      '</b> (' + forecast.targetHpBefore + '→' + forecast.targetHpAfter + ')' + counter +
      (forecast.targetStopped ? ' · <b>작동 정지</b>' : '');
    forecastEl.classList.add('show');
  }
  function renderControls() {
    var selected = ui.selectedId ? R.getUnit(state, ui.selectedId) : null;
    var hasPending = Boolean(ui.previewMove || ui.pendingAttack);
    btnThreat.textContent = ui.threats ? '위협 숨기기' : '위협 보기';
    btnCancel.disabled = !hasPending || ui.busy;
    btnConfirm.disabled = !hasPending || ui.busy;
    btnConfirm.textContent = ui.pendingAttack ? '멈추기 확정' : '이동 확정';
    btnWait.disabled = !selected || selected.acted || state.phase !== 'you' || hasPending || ui.busy;
    btnEnd.disabled = state.phase !== 'you' || ui.busy;
  }
  function renderPhase() {
    document.getElementById('phase').innerHTML = state.phase === 'you'
      ? '<span class="p-you">● 친구 차례</span>' : '<span class="p-foe">● 장난감 차례</span>';
    document.getElementById('turnNo').textContent = state.turn;
    document.getElementById('objectiveText').textContent = '목표: ' + state.objective.text;
  }
  function render() {
    renderPhase(); renderUnits(); renderHighlights(); renderForecast(); renderControls();
    renderInfo(ui.selectedId ? R.getUnit(state, ui.selectedId) : null);
  }
  function setHint(text) { hintEl.textContent = text; }

  function selectUnit(unit) {
    ui.selectedId = unit.id; ui.previewMove = null; ui.pendingAttack = null;
    setHint(unit.moved ? '멈출 장난감을 고르거나 대기하세요.' : '파란 칸을 눌러 이동을 미리 보세요.');
    render();
  }
  function clearPending() {
    ui.previewMove = null; ui.pendingAttack = null;
    setHint(ui.selectedId ? '이동할 칸이나 멈출 장난감을 고르세요.' : '움직일 친구를 고르세요.');
    render();
  }
  function onTap(x, y) {
    if (ui.busy || state.phase !== 'you' || state.status !== 'active') return;
    var tapped = R.getUnitAt(state, x, y);
    if (ui.previewMove || ui.pendingAttack) return;
    if (!ui.selectedId) {
      if (tapped && tapped.team === 'you' && !tapped.acted) selectUnit(tapped);
      else if (tapped) renderInfo(tapped);
      return;
    }
    var actor = R.getUnit(state, ui.selectedId);
    if (tapped && tapped.team === 'you') { if (!tapped.acted) selectUnit(tapped); return; }
    var actions = R.listLegalActions(state, actor.id);
    if (tapped && tapped.team === 'foe') {
      var attack = actions.find(function (a) { return a.type === 'attack' && a.targetId === tapped.id && isCurrentFrom(a, actor); });
      if (attack) { ui.pendingAttack = attack; setHint('예측을 확인하고 멈추기를 확정하세요.'); render(); }
      else { renderInfo(tapped); setHint('현재 위치에서는 닿지 않거나 시야가 막혀 있어요.'); }
      return;
    }
    var move = actions.find(function (a) { return a.type === 'move' && a.to.x === x && a.to.y === y; });
    if (move) { ui.previewMove = move; setHint('이동 미리보기입니다. 확정하거나 취소하세요.'); render(); }
  }

  function floatEvent(event) {
    if (event.type !== 'unit-hit') return;
    var unit = R.getUnit(state, event.targetId), refs = unitEls[event.targetId];
    if (!unit || !refs) return;
    var label = document.createElement('div');
    label.className = 'float'; label.textContent = '-' + event.amount; label.style.color = '#ff6077';
    label.style.left = refs.root.style.left; label.style.top = refs.root.style.top;
    boardEl.appendChild(label); setTimeout(function () { label.remove(); }, 820);
  }
  function finishAction(result) {
    state = result.state; ui.previewMove = null; ui.pendingAttack = null;
    result.events.forEach(floatEvent); render();
    if (state.status !== 'active') { showOutcome(); return; }
    var friendsDone = R.aliveUnits(state,'you').every(function (unit) { return unit.acted; });
    if (friendsDone) setTimeout(startEnemyPhase, 350);
    else { ui.selectedId = null; setHint('움직일 친구를 고르세요.'); render(); }
  }
  function showOutcome() {
    ui.busy = true;
    var win = state.status === 'victory';
    document.getElementById('ovTitle').textContent = win ? '작전 성공! 🎉' : '다시 준비해요';
    document.getElementById('ovDesc').textContent = R.evaluateObjective(state).reason;
    document.getElementById('overlay').classList.add('show');
  }

  function startEnemyPhase() {
    if (ui.busy || state.status !== 'active') return;
    ui.busy = true; ui.selectedId = null; ui.previewMove = null; ui.pendingAttack = null;
    state = R.endPhase(state); setHint('장난감이 움직입니다…'); render();
    var foes = R.aliveUnits(state,'foe').map(function (unit) { return unit.id; });
    function act(index) {
      if (index >= foes.length || state.status !== 'active') { finishEnemyPhase(); return; }
      var unit = R.getUnit(state, foes[index]);
      if (!unit || unit.hp <= 0) { act(index + 1); return; }
      var action = R.chooseAiAction(state, unit.id);
      if (action) {
        var result = R.applyAction(state, action); state = result.state;
        result.events.forEach(floatEvent); render();
      }
      if (state.status !== 'active') { showOutcome(); return; }
      setTimeout(function () { act(index + 1); }, 360);
    }
    setTimeout(function () { act(0); }, 320);
  }
  function finishEnemyPhase() {
    if (state.status !== 'active') { showOutcome(); return; }
    state = R.endPhase(state); ui.busy = false;
    setHint('친구 차례입니다. 움직일 친구를 고르세요.'); render();
  }

  btnThreat.addEventListener('click', function () { ui.threats = !ui.threats; render(); });
  btnCancel.addEventListener('click', clearPending);
  btnConfirm.addEventListener('click', function () {
    if (ui.busy) return;
    if (ui.previewMove) {
      var result = R.applyAction(state, ui.previewMove);
      if (!result.ok) return;
      state = result.state; ui.previewMove = null;
      setHint('이동을 확정했습니다. 장난감을 멈추거나 대기하세요.'); render();
    } else if (ui.pendingAttack) finishAction(R.applyAction(state, ui.pendingAttack));
  });
  btnWait.addEventListener('click', function () {
    var actor = ui.selectedId ? R.getUnit(state, ui.selectedId) : null;
    if (!actor || ui.busy) return;
    var wait = R.listLegalActions(state, actor.id).find(function (a) { return a.type === 'wait' && isCurrentFrom(a, actor); });
    if (wait) finishAction(R.applyAction(state, wait));
  });
  btnEnd.addEventListener('click', function () { if (!ui.busy && state.phase === 'you') startEnemyPhase(); });
  window.addEventListener('resize', renderUnits);

  buildBoard(); render();
  window.__mallangTactics = {
    getState: function () { return R.clone(state); },
    getUiState: function () { return R.clone(ui); },
    listActions: function (id) { return R.listLegalActions(state, id); }
  };
})();
