(function () {
  'use strict';

  var R = window.MallangTacticsRules;
  var M = window.MallangTacticsMissions;
  if (!R || !M) throw new Error('규칙과 작전 데이터가 먼저 로드되어야 합니다.');

  var SAVE_KEY = 'mallang-starlight-save-v2';
  var SAVE_VERSION = 2;
  var state = null;
  var mission = null;
  var selectedMissionId = null;
  var cells = [];
  var unitEls = Object.create(null);
  var propEls = Object.create(null);
  var ui = { selectedId: null, previewMove: null, pendingAction: null, threats: false, busy: false, hintText: '', skillArmed: false };
  var audioContext = null;
  var ids = [
    'homeScreen','briefScreen','battleScreen','resultScreen','missionList','campaignProgress','continueButton','resumeButton','homeSound',
    'briefBack','briefEyebrow','briefLocation','briefTitle','briefCopy','briefDialogue','briefObjective','briefPractice','briefStart',
    'battleMenu','battleTitle','battleLocation','turnText','turnLimitText','objectiveText','objectiveProgress','board','phase','autosave',
    'info','hint','forecast','btnThreat','btnCancel','btnConfirm','btnWait','btnSkill','btnObjective','btnEnd','resultEyebrow','resultTitle',
    'resultStars','resultCopy','resultTurns','resultFriends','resultStopped','resultNext','resultRetry','resultHome','pauseDialog',
    'pauseContinue','pauseRestart','pauseQuit','helpDialog','helpClose','announcer'
  ];
  var el = {};
  ids.forEach(function (id) { el[id] = document.getElementById(id); });

  function newSave() { return { version: SAVE_VERSION, unlocked: 1, missions: {}, activeBattle: null, sound: true }; }
  function readSave() {
    try {
      var parsed = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!parsed || parsed.version !== SAVE_VERSION) return newSave();
      parsed.missions = parsed.missions || {};
      parsed.unlocked = Math.max(1, Number(parsed.unlocked) || 1);
      if (typeof parsed.sound !== 'boolean') parsed.sound = true;
      return parsed;
    } catch (error) { return newSave(); }
  }
  var save = readSave();

  function persist(feedback) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      if (feedback && el.autosave) {
        el.autosave.textContent = '방금 자동 저장됨';
        window.setTimeout(function () { el.autosave.textContent = '자동 저장 켜짐'; }, 900);
      }
    } catch (error) {
      if (el.autosave) el.autosave.textContent = '저장 공간을 확인해 주세요';
    }
  }
  function saveBattle(feedback) {
    if (!state || !mission || state.status !== 'active') return;
    save.activeBattle = { missionId: mission.id, state: R.clone(state), savedAt: Date.now() };
    persist(feedback);
  }
  function screens(target) {
    [el.homeScreen, el.briefScreen, el.battleScreen, el.resultScreen].forEach(function (screen) {
      screen.classList.toggle('active', screen === target);
    });
    window.scrollTo(0, 0);
  }
  function say(text) {
    el.announcer.textContent = '';
    window.setTimeout(function () { el.announcer.textContent = text; }, 10);
  }
  function beep(kind) {
    if (!save.sound) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      var notes = { tap: [460,.035], move: [560,.06], hit: [180,.09], win: [760,.16], fail: [140,.18], star: [920,.09] };
      var note = notes[kind] || notes.tap;
      var osc = audioContext.createOscillator();
      var gain = audioContext.createGain();
      osc.frequency.value = note[0]; osc.type = kind === 'hit' ? 'square' : 'sine';
      gain.gain.setValueAtTime(.045, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + note[1]);
      osc.connect(gain); gain.connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + note[1]);
    } catch (error) { /* 소리는 선택 기능입니다. */ }
  }
  function stars(count) { var out = ''; for (var i = 0; i < 3; i += 1) out += i < count ? '★' : '☆'; return out; }

  function renderHome() {
    var missions = M.listMissions();
    var done = missions.filter(function (item) { return save.missions[item.id] && save.missions[item.id].stars; }).length;
    el.campaignProgress.textContent = done + ' / ' + missions.length + ' 완료';
    el.missionList.innerHTML = '';
    missions.forEach(function (item) {
      var locked = item.order > save.unlocked;
      var record = save.missions[item.id] || { stars: 0 };
      var button = document.createElement('button');
      button.type = 'button'; button.disabled = locked;
      button.className = 'mission-card' + (locked ? ' locked' : '');
      button.innerHTML = '<span class="mission-no">' + (locked ? '🔒' : item.order) + '</span>' +
        '<span class="mission-copy"><b>' + item.title + '</b><span>' + item.location + '</span></span>' +
        '<span class="mission-stars" aria-label="별 ' + record.stars + '개">' + stars(record.stars) + '</span>';
      button.addEventListener('click', function () { openBrief(item.id); });
      el.missionList.appendChild(button);
    });
    var next = missions.find(function (item) {
      return item.order <= save.unlocked && !(save.missions[item.id] && save.missions[item.id].stars);
    }) || missions[Math.min(save.unlocked, missions.length) - 1];
    el.continueButton.textContent = done ? '다음 작전 확인' : '첫 작전 시작';
    el.continueButton.onclick = function () { openBrief(next.id); };
    el.resumeButton.classList.toggle('hidden', !save.activeBattle);
    el.homeSound.textContent = save.sound ? '🔊' : '🔇';
    el.homeSound.setAttribute('aria-pressed', save.sound ? 'true' : 'false');
    screens(el.homeScreen);
  }

  function openBrief(id) {
    mission = M.createMission(id); selectedMissionId = id;
    el.briefEyebrow.textContent = mission.eyebrow;
    el.briefLocation.textContent = mission.location;
    el.briefTitle.textContent = mission.title;
    el.briefCopy.textContent = mission.brief;
    el.briefObjective.textContent = mission.objective.text;
    el.briefDialogue.innerHTML = (mission.story || []).map(function (line) {
      return '<div><b>' + line.speaker + '</b> · ' + line.text + '</div>';
    }).join('');
    screens(el.briefScreen); beep('tap');
  }
  function resetUi() { ui = { selectedId: null, previewMove: null, pendingAction: null, threats: false, busy: false, hintText: '' }; }
  function startMission(id) {
    mission = M.createMission(id); selectedMissionId = id;
    state = R.createState(mission); state.missionId = id; resetUi();
    ui.hintText = mission.hint || '친구를 탭하면 이동할 수 있는 칸이 나타납니다.';
    buildBoard(); saveBattle(false); screens(el.battleScreen);
    hint(ui.hintText);
    say(mission.title + '. ' + mission.objective.text); beep('move');
  }
  function resumeMission() {
    var active = save.activeBattle;
    if (!active) return renderHome();
    try {
      mission = M.createMission(active.missionId); selectedMissionId = active.missionId;
      state = R.createState(active.state); resetUi(); buildBoard(); screens(el.battleScreen);
      ui.hintText = '진행 중이던 작전을 이어갑니다.';
      hint(ui.hintText);
      say(mission.title + ' 작전을 이어갑니다.');
    } catch (error) { save.activeBattle = null; persist(false); renderHome(); }
  }

  function cellSize() { return cells[0][0].getBoundingClientRect().width || 44; }
  function place(node, x, y) {
    var size = cellSize(); node.style.left = (3 + x * (size + 2)) + 'px'; node.style.top = (3 + y * (size + 2)) + 'px';
  }
  function buildBoard() {
    el.board.innerHTML = ''; cells = []; unitEls = Object.create(null); propEls = Object.create(null);
    el.battleTitle.textContent = mission.title; el.battleLocation.textContent = mission.location; el.objectiveText.textContent = mission.objective.text;
    for (var y = 0; y < state.height; y += 1) {
      cells[y] = [];
      for (var x = 0; x < state.width; x += 1) {
        var cell = document.createElement('button'); cell.type = 'button';
        cell.className = 'cell' + ((x + y) % 2 ? ' alt' : '');
        if (state.terrain[y][x] === 1) cell.classList.add('wall');
        if (state.terrain[y][x] === 2) cell.classList.add('water');
        cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-label', (x + 1) + '열 ' + (y + 1) + '행');
        (function (cx, cy) { cell.addEventListener('click', function () { tapCell(cx, cy); }); })(x, y);
        el.board.appendChild(cell); cells[y][x] = cell;
      }
    }
    (state.props || []).forEach(function (prop) {
      var node = document.createElement('div'); node.className = 'prop';
      node.innerHTML = '<img alt=""><span class="prop-label"></span>'; node.querySelector('.prop-label').textContent = prop.label || '';
      el.board.appendChild(node); propEls[prop.id] = node;
    });
    state.units.forEach(function (unit) {
      var node = document.createElement('button'); node.type = 'button'; node.className = 'unit ' + unit.team;
      node.setAttribute('aria-label', unit.name || unit.id);
      node.innerHTML = '<span class="unit-body"><span class="token-fallback"></span><img alt=""><span class="carrier-badge">🔋</span><span class="shield-badge">🛡</span><span class="hpbar"><i></i></span></span>';
      node.querySelector('.token-fallback').textContent = unit.emoji || (unit.team === 'you' ? '🙂' : '🤖');
      var image = node.querySelector('img'); image.src = unit.asset || '';
      image.addEventListener('load', function () { node.querySelector('.token-fallback').hidden = true; });
      image.addEventListener('error', function () { image.hidden = true; });
      (function (id) { node.addEventListener('click', function (event) { var live = R.getUnit(state, id); event.stopPropagation(); if (live && live.hp > 0) tapCell(live.x, live.y); }); })(unit.id);
      el.board.appendChild(node); unitEls[unit.id] = { root: node, hp: node.querySelector('.hpbar i'), bar: node.querySelector('.hpbar') };
    });
    render();
  }

  function propAsset(prop) {
    if (prop.kind === 'control-star') return prop.active ? prop.activeAsset : prop.inactiveAsset;
    if (prop.kind === 'pickup') return './assets/runtime/props/cart.webp';
    if (prop.kind === 'escape') return './assets/runtime/props/escape.webp';
    return './assets/runtime/props/star-on.webp';
  }
  function carrierId() {
    var carrier = state.units.find(function (unit) { return unit.carrying && unit.carrying.indexOf(state.objective.itemId) >= 0; });
    return carrier ? carrier.id : null;
  }
  function renderProps() {
    (state.props || []).forEach(function (prop) {
      var node = propEls[prop.id]; if (!node) return;
      place(node, prop.x, prop.y); node.style.display = (prop.delivered || prop.carriedBy) ? 'none' : 'grid';
      node.querySelector('img').src = propAsset(prop);
    });
  }
  function unitPosition(unit) { return ui.previewMove && ui.previewMove.actorId === unit.id ? ui.previewMove.to : unit; }
  function renderUnits() {
    var carrier = carrierId();
    state.units.forEach(function (unit) {
      var refs = unitEls[unit.id]; if (!refs) return;
      refs.root.style.display = unit.hp > 0 ? 'grid' : 'none'; if (unit.hp <= 0) return;
      var pos = unitPosition(unit); place(refs.root, pos.x, pos.y);
      var ratio = Math.max(0, unit.hp) / unit.maxHp; refs.hp.style.width = Math.round(ratio * 100) + '%';
      refs.bar.classList.toggle('low', ratio <= .34); refs.root.classList.toggle('acted', unit.team === 'you' && unit.acted);
      refs.root.classList.toggle('selected', unit.id === ui.selectedId); refs.root.classList.toggle('preview', Boolean(ui.previewMove && unit.id === ui.selectedId));
      refs.root.classList.toggle('carrier', unit.id === carrier);
      refs.root.classList.toggle('guarded', Boolean(unit.guardBonus));
    });
  }
  function clearMarks() { cells.forEach(function (row) { row.forEach(function (cell) { cell.classList.remove('mv','atk','path','threat','interact'); }); }); }
  function mark(point, name) { if (point && cells[point.y] && cells[point.y][point.x]) cells[point.y][point.x].classList.add(name); }
  function same(a, b) { return a && b && a.x === b.x && a.y === b.y; }
  function fromHere(action, actor) { return action.from && same(action.from, actor); }
  function isObjectiveAction(action) { return action && ['pickup-item','escape-with-item','activate-device'].indexOf(action.type) >= 0; }
  function isSkillAction(action) { return action && ['guard-stance','special-shot'].indexOf(action.type) >= 0; }
  function actionPoint(action) { return action.at || action.to || action.from; }
  function currentActions(actor, predicate) {
    if (!actor) return [];
    return R.listLegalActions(state, actor.id).filter(function (action) { return fromHere(action, actor) && predicate(action); });
  }
  function skillLabel(actor) {
    if (!actor) return '특기';
    if (actor.role === 'guardian') return '든든막기';
    if (actor.role === 'marksman') return '별빛콩';
    return '특기';
  }
  function renderMarks() {
    clearMarks();
    if (ui.threats) R.listThreatenedTiles(state, 'foe').forEach(function (tile) { mark(tile, 'threat'); });
    if (!ui.selectedId || state.phase !== 'you') return;
    var actor = R.getUnit(state, ui.selectedId); if (!actor || actor.acted) return;
    var actions = R.listLegalActions(state, actor.id);
    if (ui.previewMove) { (ui.previewMove.path || []).forEach(function (tile) { mark(tile, 'path'); }); mark(ui.previewMove.to, 'mv'); }
    else {
      actions.filter(function (a) { return a.type === 'move'; }).forEach(function (a) { mark(a.to, 'mv'); });
      if (ui.skillArmed) {
        actions.filter(function (a) { return isSkillAction(a) && fromHere(a, actor); }).forEach(function (a) {
          mark(a.targetId ? R.getUnit(state, a.targetId) : actionPoint(a), a.type === 'special-shot' ? 'atk' : 'interact');
        });
      } else {
        actions.filter(function (a) { return a.type === 'attack' && fromHere(a, actor); }).forEach(function (a) { mark(R.getUnit(state, a.targetId), 'atk'); });
      }
      actions.filter(function (a) { return isObjectiveAction(a) && fromHere(a, actor); }).forEach(function (a) { mark(actionPoint(a), 'interact'); });
    }
    if (ui.pendingAction) mark(ui.pendingAction.targetId ? R.getUnit(state, ui.pendingAction.targetId) : actionPoint(ui.pendingAction), (ui.pendingAction.type === 'attack' || ui.pendingAction.type === 'special-shot') ? 'atk' : 'interact');
  }

  function renderInfo(unit) {
    if (!unit) { el.info.innerHTML = '<div class="unit-avatar">⭐</div><div><div class="unit-name">친구를 선택하세요</div><div class="unit-stats">친구를 탭하면 이동할 수 있는 칸이 나타납니다.</div></div>'; return; }
    var roleText = unit.role === 'guardian' ? ' · 특기 <b>든든막기</b>' : unit.role === 'marksman' ? ' · 특기 <b>별빛콩</b>' : '';
    var guardText = unit.guardBonus ? ' · 보호막 <b>+' + unit.guardBonus + '</b>' : '';
    el.info.innerHTML = '<div class="unit-avatar"><img src="' + unit.asset + '" alt=""></div><div><div class="unit-name">' + unit.name + '</div>' +
      '<div class="unit-stats">기운 <b>' + Math.max(0,unit.hp) + '/' + unit.maxHp + '</b> · 해결 <b>' + unit.atk + '</b> · 버팀 <b>' + unit.def +
      '</b> · 이동 <b>' + unit.mov + '</b> · 거리 <b>' + unit.range + '</b>' + guardText + roleText + '</div></div>';
  }
  function actionLabel(action, actor) {
    if (!action) return actor ? skillLabel(actor) : '목표 설명';
    if (action.type === 'pickup-item') return '배터리 줍기';
    if (action.type === 'escape-with-item') return '배터리 전달';
    if (action.type === 'activate-device') return '제어별 켜기';
    if (action.type === 'guard-stance') return '든든막기';
    if (action.type === 'special-shot') return '별빛콩';
    return '목표 행동';
  }
  function currentObjectiveAction(actor) {
    if (!actor) return null;
    return R.listLegalActions(state, actor.id).find(function (action) { return isObjectiveAction(action) && fromHere(action, actor); }) || null;
  }
  function currentSkillActions(actor) { return currentActions(actor, isSkillAction); }
  function renderForecast() {
    if (!ui.pendingAction) { el.forecast.classList.remove('show'); el.forecast.textContent = ''; return; }
    if (ui.pendingAction.type === 'guard-stance') {
      el.forecast.innerHTML = '<b>든든막기</b><br>라떼와 인접 친구에게 적 페이즈 동안 보호막 +2를 줍니다.'; el.forecast.classList.add('show'); return;
    }
    if (ui.pendingAction.type !== 'attack' && ui.pendingAction.type !== 'special-shot') {
      el.forecast.innerHTML = '<b>' + actionLabel(ui.pendingAction) + '</b><br>확정 전에는 작전 상태가 바뀌지 않습니다.'; el.forecast.classList.add('show'); return;
    }
    var f = R.forecastAction(state, ui.pendingAction); if (!f) return;
    var attacker = R.getUnit(state, f.actorId), target = R.getUnit(state, f.targetId);
    var counter = f.counterDamage ? ' · 맞대응 <b>' + f.counterDamage + '</b> (내 기운 ' + f.actorHpBefore + '→' + f.actorHpAfter + ')' : ' · 맞대응 없음';
    var title = f.type === 'special-shot' ? '별빛콩' : attacker.name + ' → ' + target.name;
    el.forecast.innerHTML = '<b>' + title + '</b><br>기운 피해 <b>' + f.damage + '</b> (' + f.targetHpBefore + '→' + f.targetHpAfter + ')' + counter + (f.targetStopped ? ' · <b>작동 정지</b>' : '');
    el.forecast.classList.add('show');
  }
  function progressText() {
    if (state.objective.type === 'eliminate') return R.aliveUnits(state, state.objective.targetTeam || 'foe').length + '대 남음';
    if (state.objective.type === 'deliver-and-escape') return carrierId() ? '운반 중' : ((state.props || []).some(function (p) { return p.id === state.objective.itemId && p.delivered; }) ? '운반 완료' : '배터리 찾기');
    if (state.objective.type === 'activate-then-defeat-boss') return (state.props || []).filter(function (p) { return p.kind === 'control-star' && p.active; }).length + ' / ' + state.objective.requiredActiveCount + ' 켜짐';
    return '';
  }
  function renderControls() {
    var actor = ui.selectedId ? R.getUnit(state, ui.selectedId) : null;
    var pending = Boolean(ui.previewMove || ui.pendingAction);
    var objectiveAction = actor && !pending ? currentObjectiveAction(actor) : null;
    var skillActions = actor && !pending ? currentSkillActions(actor) : [];
    el.btnThreat.textContent = ui.threats ? '위협 숨기기' : '위협 보기'; el.btnThreat.setAttribute('aria-pressed', ui.threats ? 'true' : 'false');
    el.btnCancel.disabled = !pending || ui.busy; el.btnConfirm.disabled = !pending || ui.busy;
    el.btnConfirm.textContent = ui.pendingAction ? ((ui.pendingAction.type === 'attack' || ui.pendingAction.type === 'special-shot') ? '멈추기 확정' : '행동 확정') : '이동 확정';
    el.btnWait.disabled = !actor || actor.acted || state.phase !== 'you' || pending || ui.busy;
    el.btnSkill.textContent = actor ? skillLabel(actor) : '특기';
    el.btnSkill.disabled = !actor || actor.acted || state.phase !== 'you' || pending || ui.busy || skillActions.length === 0;
    el.btnSkill.setAttribute('aria-pressed', ui.skillArmed ? 'true' : 'false');
    el.btnObjective.textContent = objectiveAction ? actionLabel(objectiveAction) : '목표 설명'; el.btnObjective.disabled = ui.busy;
    el.btnEnd.disabled = state.phase !== 'you' || ui.busy;
  }
  function renderHeader() {
    el.turnText.textContent = state.turn + '턴'; el.turnLimitText.textContent = state.objective.turnLimit ? '제한 ' + state.objective.turnLimit + '턴' : '천천히 생각해요';
    el.objectiveProgress.textContent = progressText(); el.phase.textContent = state.phase === 'you' ? '● 친구 차례' : '● 장난감 차례'; el.phase.className = 'phase ' + state.phase;
  }
  function render() { if (!state) return; renderHeader(); renderProps(); renderUnits(); renderMarks(); renderInfo(ui.selectedId ? R.getUnit(state, ui.selectedId) : null); el.hint.textContent = ui.hintText || ''; renderForecast(); renderControls(); }
  function hint(text) { ui.hintText = text; el.hint.textContent = text; }

  function select(unit) {
    ui.selectedId = unit.id; ui.previewMove = null; ui.pendingAction = null; ui.skillArmed = false;
    hint(unit.moved ? '장난감이나 목표 행동을 고른 뒤 확정하세요.' : '파란 칸을 눌러 이동을 미리 보세요.'); beep('tap'); render();
  }
  function clearPending() { ui.previewMove = null; ui.pendingAction = null; ui.skillArmed = false; hint(ui.selectedId ? '이동할 칸이나 행동을 다시 고르세요.' : '움직일 친구를 고르세요.'); render(); }
  function objectiveAt(actions, actor, x, y) {
    return actions.find(function (action) { var point = actionPoint(action); return isObjectiveAction(action) && fromHere(action, actor) && point && point.x === x && point.y === y; });
  }
  function tapCell(x, y) {
    if (ui.busy || state.phase !== 'you' || state.status !== 'active' || ui.previewMove || ui.pendingAction) return;
    var tapped = R.getUnitAt(state, x, y);
    if (!ui.selectedId) {
      if (tapped && tapped.team === 'you' && !tapped.acted) select(tapped);
      else if (tapped) { renderInfo(tapped); hint('장난감의 기운과 거리를 확인했습니다.'); }
      return;
    }
    var actor = R.getUnit(state, ui.selectedId);
    if (tapped && tapped.team === 'you') { if (!tapped.acted) select(tapped); return; }
    var actions = R.listLegalActions(state, actor.id);
    if (tapped && tapped.team === 'foe') {
      var attack = actions.find(function (a) { return a.type === 'attack' && a.targetId === tapped.id && fromHere(a, actor); });
      var special = actions.find(function (a) { return a.type === 'special-shot' && a.targetId === tapped.id && fromHere(a, actor); });
      if (ui.skillArmed && special) { ui.skillArmed = false; ui.pendingAction = special; hint('별빛콩 결과를 확인하고 확정하세요.'); beep('tap'); render(); }
      else if (attack) { ui.pendingAction = attack; hint('결과를 확인한 뒤 멈추기를 확정하세요.'); beep('tap'); render(); }
      else if (special) { ui.pendingAction = special; hint('별빛콩 결과를 확인하고 확정하세요.'); beep('tap'); render(); }
      else { renderInfo(tapped); hint('현재 위치에서는 닿지 않아요. 먼저 이동해 주세요.'); }
      return;
    }
    var interaction = objectiveAt(actions, actor, x, y);
    if (interaction) { ui.pendingAction = interaction; hint('목표 행동을 확인하고 확정하세요.'); render(); return; }
    var move = actions.find(function (a) { return a.type === 'move' && a.to.x === x && a.to.y === y; });
    if (move) { ui.skillArmed = false; ui.previewMove = move; hint('이동 미리보기입니다. 확정하거나 취소하세요.'); beep('tap'); render(); }
  }

  function floatEvent(event) {
    if (event.type !== 'unit-hit') return;
    var refs = unitEls[event.targetId]; if (!refs) return;
    var label = document.createElement('div'); label.className = 'float'; label.textContent = '-' + event.amount;
    label.style.left = refs.root.style.left; label.style.top = refs.root.style.top; el.board.appendChild(label);
    window.setTimeout(function () { label.remove(); }, 780); beep('hit');
  }
  function syncStatus() { var result = R.evaluateObjective(state); if (result.status !== 'active') state.status = result.status; return result; }
  function committed(result) {
    if (!result || !result.ok) return;
    state = result.state; ui.previewMove = null; ui.pendingAction = null; ui.skillArmed = false; (result.events || []).forEach(floatEvent); syncStatus(); saveBattle(true); render();
    if (state.status !== 'active') return window.setTimeout(outcome, 320);
    if (R.aliveUnits(state, 'you').every(function (unit) { return unit.acted; })) return window.setTimeout(enemyPhase, 260);
    ui.selectedId = null; hint('다음에 움직일 친구를 고르세요.'); render();
  }
  function enemyPhase() {
    if (ui.busy || state.status !== 'active') return;
    ui.busy = true; ui.selectedId = null; ui.previewMove = null; ui.pendingAction = null; ui.skillArmed = false;
    state = R.endPhase(state); syncStatus(); if (state.status !== 'active') return outcome();
    hint('장난감의 움직임을 확인하세요…'); saveBattle(true); render();
    var foes = R.aliveUnits(state, 'foe').map(function (unit) { return unit.id; });
    function act(index) {
      if (index >= foes.length || state.status !== 'active') return endEnemyPhase();
      var unit = R.getUnit(state, foes[index]); if (!unit || unit.hp <= 0) return act(index + 1);
      var action = R.chooseAiAction(state, unit.id);
      if (action) { var result = R.applyAction(state, action); if (result.ok) { state = result.state; (result.events || []).forEach(floatEvent); syncStatus(); render(); } }
      if (state.status !== 'active') return window.setTimeout(outcome, 280);
      window.setTimeout(function () { act(index + 1); }, 320);
    }
    window.setTimeout(function () { act(0); }, 280);
  }
  function endEnemyPhase() {
    state = R.endPhase(state); syncStatus(); ui.busy = false; saveBattle(true);
    if (state.status !== 'active') return outcome();
    hint('친구 차례입니다. 움직일 친구를 고르세요.'); say(state.turn + '턴 친구 차례'); render();
  }
  function scoreStars() {
    if (state.status !== 'victory') return 0;
    var score = 1; if (state.turn <= mission.parTurns) score += 1;
    if (R.aliveUnits(state, 'you').length === mission.units.filter(function (unit) { return unit.team === 'you'; }).length) score += 1;
    return score;
  }
  function outcome() {
    ui.busy = true;
    var result = R.evaluateObjective(state), won = state.status === 'victory', earned = scoreStars();
    var stopped = state.units.filter(function (unit) { return unit.team === 'foe' && unit.hp <= 0; }).length;
    save.activeBattle = null;
    if (won) {
      var old = save.missions[mission.id] || { stars: 0, bestTurns: 999 };
      save.missions[mission.id] = { stars: Math.max(old.stars, earned), bestTurns: Math.min(old.bestTurns, state.turn) };
      save.unlocked = Math.min(M.listMissions().length, Math.max(save.unlocked, mission.order + 1));
    }
    persist(false);
    el.resultEyebrow.textContent = won ? mission.eyebrow + ' 완료' : '작전 재정비'; el.resultTitle.textContent = won ? '작전 성공!' : '다시 준비해요';
    el.resultStars.textContent = stars(earned); el.resultStars.setAttribute('aria-label', '별 ' + earned + '개');
    el.resultCopy.textContent = won ? mission.victoryText : (result.reason || mission.defeatText);
    el.resultTurns.textContent = state.turn; el.resultFriends.textContent = R.aliveUnits(state, 'you').length; el.resultStopped.textContent = stopped;
    el.resultNext.classList.toggle('hidden', !(won && mission.order < M.listMissions().length)); screens(el.resultScreen); beep(won ? 'win' : 'fail');
    if (won) window.setTimeout(function () { beep('star'); }, 180);
    if (window.GameBoot && window.GameBoot.submitResult) window.GameBoot.submitResult({ score: earned * 100 + stopped * 10, won: won });
  }

  function showHelp(title, copy) { el.helpDialog.querySelector('h2').textContent = title; el.helpDialog.querySelector('p').innerHTML = copy; el.helpDialog.showModal(); }
  el.homeSound.addEventListener('click', function () { save.sound = !save.sound; persist(false); renderHome(); beep('tap'); });
  el.resumeButton.addEventListener('click', resumeMission); el.briefBack.addEventListener('click', renderHome);
  el.briefPractice.addEventListener('click', function () { showHelp('세 번 탭하면 준비 끝!', '<b>1.</b> 친구와 파란 칸을 고릅니다.<br><b>2.</b> 위치를 미리 본 뒤 확정합니다.<br><b>3.</b> 빨간 장난감이나 노란 목표 행동을 고르고 다시 확정합니다.<br><br>위협 보기는 다음 장난감 차례에 닿는 칸을 <b>!</b>로 표시합니다.'); });
  el.briefStart.addEventListener('click', function () { startMission(selectedMissionId); });
  el.battleMenu.addEventListener('click', function () { if (!ui.busy) el.pauseDialog.showModal(); });
  el.pauseContinue.addEventListener('click', function () { el.pauseDialog.close(); });
  el.pauseRestart.addEventListener('click', function () { el.pauseDialog.close(); startMission(mission.id); });
  el.pauseQuit.addEventListener('click', function () { saveBattle(false); el.pauseDialog.close(); renderHome(); });
  el.helpClose.addEventListener('click', function () { el.helpDialog.close(); });
  el.btnThreat.addEventListener('click', function () { ui.threats = !ui.threats; beep('tap'); render(); });
  el.btnCancel.addEventListener('click', clearPending);
  el.btnConfirm.addEventListener('click', function () {
    if (ui.busy) return;
    if (ui.previewMove) {
      var result = R.applyAction(state, ui.previewMove); if (!result.ok) return;
      state = result.state; ui.previewMove = null; saveBattle(true); beep('move'); hint('이동했습니다. 장난감, 목표 행동, 대기 중 하나를 고르세요.'); render();
    } else if (ui.pendingAction) committed(R.applyAction(state, ui.pendingAction));
  });
  el.btnWait.addEventListener('click', function () {
    var actor = ui.selectedId ? R.getUnit(state, ui.selectedId) : null; if (!actor || ui.busy) return;
    var wait = R.listLegalActions(state, actor.id).find(function (action) { return action.type === 'wait' && fromHere(action, actor); });
    if (wait) committed(R.applyAction(state, wait));
  });
  el.btnSkill.addEventListener('click', function () {
    var actor = ui.selectedId ? R.getUnit(state, ui.selectedId) : null;
    var actions = actor ? currentSkillActions(actor) : [];
    if (!actor || ui.busy || !actions.length) return;
    if (actions.length === 1 && actions[0].type === 'guard-stance') {
      ui.pendingAction = actions[0];
      hint('든든막기 결과를 확인하고 확정하세요.');
    } else {
      ui.skillArmed = !ui.skillArmed;
      hint(ui.skillArmed ? '별빛콩을 쓸 장난감을 탭하세요.' : '특기 선택을 취소했습니다.');
    }
    render();
  });
  el.btnObjective.addEventListener('click', function () {
    var actor = ui.selectedId ? R.getUnit(state, ui.selectedId) : null; var action = actor ? currentObjectiveAction(actor) : null;
    if (action) { ui.pendingAction = action; hint('목표 행동을 확인하고 확정하세요.'); render(); }
    else showHelp(mission.title, '<b>목표</b><br>' + mission.objective.text + '<br><br><b>작전 팁</b><br>' + mission.hint + '<br><br><b>특기</b><br>라떼의 <b>든든막기</b>는 자신과 인접 친구를 적 페이즈 동안 단단하게 지켜 줍니다. 민트의 <b>별빛콩</b>은 기본 사거리보다 1칸 더 멀리 정확하게 멈춥니다.');
  });
  el.btnEnd.addEventListener('click', function () { if (!ui.busy && state.phase === 'you') enemyPhase(); });
  el.resultNext.addEventListener('click', function () { openBrief(M.listMissionIds()[mission.order]); });
  el.resultRetry.addEventListener('click', function () { startMission(mission.id); }); el.resultHome.addEventListener('click', renderHome);
  window.addEventListener('resize', function () { if (state) { renderProps(); renderUnits(); } });

  window.__mallangTactics = {
    getState: function () { return state ? R.clone(state) : null; }, getUiState: function () { return R.clone(ui); }, getSave: function () { return R.clone(save); },
    listActions: function (id) { return state ? R.listLegalActions(state, id) : []; }, startMission: startMission,
    clearSave: function () { save = newSave(); persist(false); renderHome(); }
  };
  renderHome();
})();
