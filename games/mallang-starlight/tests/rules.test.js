'use strict';
var assert = require('assert');
var R = require('../engine/rules.js');
var Missions = require('../data/missions.js');

function fixture(overrides) {
  var base = {
    width: 5,
    height: 5,
    phase: 'you',
    turn: 1,
    rng: { seed: 1234 },
    terrain: [
      [0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0]
    ],
    objective: { type: 'eliminate', targetTeam: 'foe', text: '장난감을 멈추세요' },
    props: [],
    units: [
      { id: 'latte', team: 'you', x: 0, y: 2, hp: 10, maxHp: 10, atk: 6, def: 3, mov: 2, range: 1, acted: false },
      { id: 'mint', team: 'you', x: 0, y: 3, hp: 8, maxHp: 8, atk: 5, def: 1, mov: 2, range: 2, acted: false },
      { id: 'bot', team: 'foe', x: 2, y: 2, hp: 5, maxHp: 5, atk: 4, def: 2, mov: 2, range: 1, acted: false }
    ]
  };
  if (overrides) Object.keys(overrides).forEach(function (key) { base[key] = overrides[key]; });
  return R.createState(base);
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('state is JSON serializable and legal actions survive round trip', function () {
  var state = fixture();
  var before = R.listLegalActions(state, 'latte').map(R.actionKey);
  var restored = JSON.parse(JSON.stringify(state));
  assert.deepStrictEqual(R.listLegalActions(restored, 'latte').map(R.actionKey), before);
});

test('movement blocks terrain and enemies but permits ally pass-through', function () {
  var state = fixture();
  var cells = R.computeReachable(state, 'latte').map(function (p) { return R.key(p.x, p.y); });
  assert(!cells.includes('2,2'));
  assert(!cells.includes('2,1'));
  assert(cells.includes('0,4'));
  assert(!cells.includes('0,3'));
});

test('line of sight is blocked by an intermediate wall', function () {
  var state = fixture({
    terrain: [[0, 0, 0], [0, 1, 0], [0, 0, 0]],
    width: 3,
    height: 3,
    units: [
      { id: 'mint', team: 'you', x: 0, y: 1, hp: 8, maxHp: 8, atk: 5, def: 1, mov: 0, range: 2, acted: false },
      { id: 'bot', team: 'foe', x: 2, y: 1, hp: 5, maxHp: 5, atk: 4, def: 2, mov: 0, range: 1, acted: false }
    ]
  });
  assert.strictEqual(R.hasLineOfSight(state, { x: 0, y: 1 }, { x: 2, y: 1 }), false);
  assert(!R.listLegalActions(state, 'mint').some(function (action) { return action.type === 'attack'; }));
});

test('forecast is non-mutating and matches fixed resolution with counter', function () {
  var state = fixture();
  var action = R.listLegalActions(state, 'latte').find(function (entry) {
    return entry.type === 'attack' && entry.targetId === 'bot';
  });
  var snapshot = JSON.stringify(state);
  var forecast = R.forecastAction(state, action);
  assert.strictEqual(JSON.stringify(state), snapshot);
  assert.strictEqual(forecast.damage, 4);
  assert.strictEqual(forecast.counterDamage, 1);
  var result = R.applyAction(state, action);
  assert(result.ok);
  assert.strictEqual(R.getUnit(result.state, 'bot').hp, forecast.targetHpAfter);
});

test('move action commits position without consuming the unit action', function () {
  var state = fixture();
  var move = R.listLegalActions(state, 'latte').find(function (entry) {
    return entry.type === 'move' && entry.to.x === 1 && entry.to.y === 2;
  });
  var result = R.applyAction(state, move);
  assert(result.ok);
  assert.strictEqual(R.getUnit(result.state, 'latte').x, 1);
  assert.strictEqual(R.getUnit(result.state, 'latte').acted, false);
  assert.strictEqual(R.getUnit(result.state, 'latte').moved, true);
  assert(!R.listLegalActions(result.state, 'latte').some(function (entry) { return entry.type === 'move'; }));
  assert(R.listLegalActions(result.state, 'latte').some(function (entry) {
    return entry.type === 'attack' && entry.targetId === 'bot';
  }));
  assert.strictEqual(R.getUnit(state, 'latte').x, 0);
});

test('move action leaves a manual wait choice instead of auto-waiting', function () {
  var state = fixture();
  var move = R.listLegalActions(state, 'latte').find(function (entry) {
    return entry.type === 'move' && entry.to.x === 1 && entry.to.y === 2;
  });
  var moved = R.applyAction(state, move).state;
  var waits = R.listLegalActions(moved, 'latte').filter(function (entry) { return entry.type === 'wait'; });
  assert.strictEqual(R.getUnit(moved, 'latte').acted, false);
  assert(waits.some(function (entry) { return entry.from.x === 1 && entry.from.y === 2; }));
});

test('shared legal action generator includes attack options from reachable tiles', function () {
  var state = fixture({
    units: [
      { id: 'latte', team: 'you', x: 0, y: 2, hp: 10, maxHp: 10, atk: 6, def: 3, mov: 2, range: 1, acted: false },
      { id: 'mint', team: 'you', x: 0, y: 4, hp: 8, maxHp: 8, atk: 5, def: 1, mov: 2, range: 2, acted: false },
      { id: 'bot', team: 'foe', x: 3, y: 2, hp: 5, maxHp: 5, atk: 4, def: 2, mov: 2, range: 1, acted: false }
    ]
  });
  var attack = R.listLegalActions(state, 'latte').find(function (entry) {
    return entry.type === 'attack' && entry.targetId === 'bot' && entry.from.x === 2 && entry.from.y === 2;
  });
  assert(attack);
});

test('threat range is derived deterministically from shared rules', function () {
  var state = fixture();
  R.getUnit(state, 'bot').acted = true;
  R.getUnit(state, 'bot').moved = true;
  var first = R.listThreatenedTiles(state, 'foe').map(function (entry) { return R.key(entry.x, entry.y); });
  var second = R.listThreatenedTiles(JSON.parse(JSON.stringify(state)), 'foe').map(function (entry) { return R.key(entry.x, entry.y); });
  assert.deepStrictEqual(first, second);
  assert(first.includes('1,2'));
  assert(first.includes('4,2'));
  assert.strictEqual(R.getUnit(state, 'bot').acted, true);
  assert.strictEqual(R.getUnit(state, 'bot').moved, true);
});

test('threat range never paints impassable terrain as attackable', function () {
  var state = fixture();
  var threats = R.listThreatenedTiles(state, 'foe');
  threats.forEach(function (tile) {
    assert.strictEqual(state.terrain[tile.y][tile.x], 0);
  });
});

test('forecast does not consume rng state', function () {
  var state = fixture();
  var action = R.listLegalActions(state, 'latte').find(function (entry) {
    return entry.type === 'attack' && entry.targetId === 'bot';
  });
  var before = JSON.stringify(state.rng);
  R.forecastAction(state, action);
  assert.strictEqual(JSON.stringify(state.rng), before);
});

test('apply action advances injected rng deterministically', function () {
  var state = fixture();
  var action = R.listLegalActions(state, 'latte').find(function (entry) {
    return entry.type === 'attack' && entry.targetId === 'bot';
  });
  var first = R.applyAction(state, action).state;
  var second = R.applyAction(fixture(), action).state;
  assert.notStrictEqual(JSON.stringify(first.rng), JSON.stringify(state.rng));
  assert.deepStrictEqual(first, second);
  var injected = R.applyAction(state, action, function (rng) { return { value: 0.5, state: { seed: rng.seed + 11 } }; }).state;
  assert.strictEqual(injected.rng.seed, state.rng.seed + 11);
});

test('invalid action changes neither state nor rng', function () {
  var state = fixture();
  var snapshot = JSON.stringify(state);
  var result = R.applyAction(state, { type: 'move', actorId: 'latte', to: { x: 2, y: 1 } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(JSON.stringify(state), snapshot);
  assert.strictEqual(JSON.stringify(result.state), snapshot);
});

test('objective status comes from state', function () {
  var state = fixture();
  R.getUnit(state, 'bot').hp = 0;
  assert.strictEqual(R.evaluateObjective(state).status, 'victory');
  R.getUnit(state, 'latte').hp = 0;
  R.getUnit(state, 'mint').hp = 0;
  assert.strictEqual(R.evaluateObjective(state).status, 'defeat');
});

test('seeded RNG and AI choice are deterministic', function () {
  assert.deepStrictEqual(R.nextRandom({ seed: 99 }), R.nextRandom({ seed: 99 }));
  var state = fixture();
  var firstDraw = R.drawRandom(state);
  var repeatedDraw = R.drawRandom(JSON.parse(JSON.stringify(state)));
  assert.deepStrictEqual(firstDraw, repeatedDraw);
  assert.notDeepStrictEqual(firstDraw.state.rng, state.rng);
  assert.deepStrictEqual(R.drawRandom(firstDraw.state), R.drawRandom(repeatedDraw.state));
  var injected = R.drawRandom(state, function (rng) { return { value: 0.25, state: { seed: rng.seed + 7 } }; });
  assert.strictEqual(injected.value, 0.25);
  assert.strictEqual(injected.state.rng.seed, state.rng.seed + 7);
  var aiState = fixture();
  aiState.phase = 'foe';
  var choice = R.chooseAiAction(aiState, 'bot');
  assert.deepStrictEqual(choice, R.chooseAiAction(JSON.parse(JSON.stringify(aiState)), 'bot'));
  assert(R.listLegalActions(aiState, 'bot').map(R.actionKey).includes(R.actionKey(choice)));
});

test('ai choice is always one of the legal actions', function () {
  var state = fixture();
  state.phase = 'foe';
  var choice = R.chooseAiAction(state, 'bot');
  var legal = R.listLegalActions(state, 'bot').map(R.actionKey);
  assert(choice);
  assert(legal.includes(R.actionKey(choice)));
});

test('mint special shot reaches one tile beyond basic range without a counter', function () {
  var state = fixture({
    units: [
      { id: 'mint', team: 'you', role: 'marksman', x: 0, y: 0, hp: 8, maxHp: 8, atk: 5, def: 1, mov: 0, range: 2 },
      { id: 'bot', team: 'foe', x: 3, y: 0, hp: 7, maxHp: 7, atk: 5, def: 1, mov: 0, range: 3 }
    ]
  });
  var actions = R.listLegalActions(state, 'mint');
  assert(!actions.some(function (action) { return action.type === 'attack'; }));
  var special = actions.find(function (action) { return action.type === 'special-shot'; });
  assert(special);
  var forecast = R.forecastAction(state, special);
  assert.strictEqual(forecast.damage, 5);
  assert.strictEqual(forecast.counterDamage, 0);
  var result = R.applyAction(state, special);
  assert.strictEqual(R.getUnit(result.state, 'bot').hp, 2);
  assert.strictEqual(R.getUnit(result.state, 'mint').acted, true);
});

test('latte guard protects adjacent friends for one hit and expires next friend phase', function () {
  var state = fixture({
    units: [
      { id: 'latte', team: 'you', role: 'guardian', x: 1, y: 1, hp: 10, maxHp: 10, atk: 5, def: 1, mov: 0, range: 1 },
      { id: 'mint', team: 'you', role: 'marksman', x: 1, y: 2, hp: 8, maxHp: 8, atk: 5, def: 1, mov: 0, range: 2 },
      { id: 'bot', team: 'foe', x: 2, y: 1, hp: 8, maxHp: 8, atk: 6, def: 1, mov: 0, range: 1 }
    ]
  });
  var guard = R.listLegalActions(state, 'latte').find(function (action) { return action.type === 'guard-stance'; });
  var guarded = R.applyAction(state, guard).state;
  assert.strictEqual(R.getUnit(guarded, 'latte').guardBonus, 2);
  assert.strictEqual(R.getUnit(guarded, 'mint').guardBonus, 2);
  guarded = R.endPhase(guarded);
  var attack = R.listLegalActions(guarded, 'bot').find(function (action) {
    return action.type === 'attack' && action.targetId === 'latte' && action.from.x === 2 && action.from.y === 1;
  });
  assert.strictEqual(R.forecastAction(guarded, attack).damage, 3);
  var hit = R.applyAction(guarded, attack).state;
  assert.strictEqual(R.getUnit(hit, 'latte').guardBonus, 0);
  assert.strictEqual(R.getUnit(hit, 'latte').hp, 7);
  hit = R.endPhase(hit);
  assert.strictEqual(R.getUnit(hit, 'mint').guardBonus, 0);
});

test('pickup action is generated from the shared legal action list and remains serializable', function () {
  var state = fixture({
    objective: {
      type: 'deliver-and-escape',
      text: '배터리를 옮기세요',
      turnLimit: 6,
      itemId: 'battery-core',
      pickupAt: { x: 0, y: 2 },
      escapeAt: { x: 4, y: 4 },
      carrierTeam: 'you',
      failOnCarrierDown: true
    },
    props: [{ id: 'battery-core', kind: 'pickup', x: 0, y: 2, carriedBy: null, delivered: false }]
  });
  var actions = R.listLegalActions(state, 'latte');
  var pickup = actions.find(function (entry) { return entry.type === 'pickup-item'; });
  assert(pickup);
  assert.deepStrictEqual(
    R.listLegalActions(JSON.parse(JSON.stringify(state)), 'latte').map(R.actionKey),
    actions.map(R.actionKey)
  );
});

test('pickup action updates carrying state and consumes the action', function () {
  var state = fixture({
    objective: {
      type: 'deliver-and-escape',
      text: '배터리를 옮기세요',
      turnLimit: 6,
      itemId: 'battery-core',
      pickupAt: { x: 0, y: 2 },
      escapeAt: { x: 4, y: 4 },
      carrierTeam: 'you',
      failOnCarrierDown: true
    },
    props: [{ id: 'battery-core', kind: 'pickup', x: 0, y: 2, carriedBy: null, delivered: false }]
  });
  var pickup = R.listLegalActions(state, 'latte').find(function (entry) { return entry.type === 'pickup-item'; });
  var result = R.applyAction(state, pickup);
  assert(result.ok);
  assert.deepStrictEqual(R.getUnit(result.state, 'latte').carrying, ['battery-core']);
  assert.strictEqual(R.getProp(result.state, 'battery-core').carriedBy, 'latte');
  assert.strictEqual(R.getUnit(result.state, 'latte').acted, true);
});

test('escape with item resolves the delivery objective', function () {
  var state = fixture({
    objective: {
      type: 'deliver-and-escape',
      text: '배터리를 옮기세요',
      turnLimit: 6,
      itemId: 'battery-core',
      pickupAt: { x: 0, y: 2 },
      escapeAt: { x: 4, y: 4 },
      carrierTeam: 'you',
      failOnCarrierDown: true
    },
    props: [{ id: 'battery-core', kind: 'pickup', x: 4, y: 4, carriedBy: 'latte', delivered: false }],
    units: [
      { id: 'latte', team: 'you', x: 4, y: 4, hp: 10, maxHp: 10, atk: 6, def: 3, mov: 0, range: 1, acted: false, carrying: ['battery-core'] },
      { id: 'mint', team: 'you', x: 0, y: 3, hp: 8, maxHp: 8, atk: 5, def: 1, mov: 2, range: 2, acted: false },
      { id: 'bot', team: 'foe', x: 2, y: 2, hp: 5, maxHp: 5, atk: 4, def: 2, mov: 2, range: 1, acted: false }
    ]
  });
  var escape = R.listLegalActions(state, 'latte').find(function (entry) { return entry.type === 'escape-with-item'; });
  var result = R.applyAction(state, escape);
  assert.strictEqual(result.state.status, 'victory');
  assert.strictEqual(R.getProp(result.state, 'battery-core').delivered, true);
  assert.deepStrictEqual(R.getUnit(result.state, 'latte').carrying, []);
});

test('delivery mission fails when the active carrier is stopped', function () {
  var state = fixture({
    objective: {
      type: 'deliver-and-escape', text: '배터리를 옮기세요', turnLimit: 6,
      itemId: 'battery-core', pickupAt: { x: 0, y: 2 }, escapeAt: { x: 4, y: 4 },
      carrierTeam: 'you', failOnCarrierDown: true
    },
    props: [{ id: 'battery-core', kind: 'pickup', x: 0, y: 2, carriedBy: 'latte', delivered: false }],
    units: [
      { id: 'latte', team: 'you', x: 0, y: 2, hp: 0, maxHp: 10, atk: 6, def: 3, mov: 2, range: 1, carrying: ['battery-core'] },
      { id: 'mint', team: 'you', x: 0, y: 3, hp: 8, maxHp: 8, atk: 5, def: 1, mov: 2, range: 2 },
      { id: 'bot', team: 'foe', x: 2, y: 2, hp: 5, maxHp: 5, atk: 4, def: 2, mov: 2, range: 1 }
    ]
  });
  assert.strictEqual(R.evaluateObjective(state).status, 'defeat');
});

test('control point activation is generated legally and contributes to boss objective', function () {
  var state = fixture({
    objective: {
      type: 'activate-then-defeat-boss',
      text: '제어별을 켜고 보스를 멈추세요',
      requiredActiveCount: 2,
      controlStars: [{ id: 'star-a', x: 0, y: 2 }, { id: 'star-b', x: 4, y: 4 }],
      bossId: 'boss-bear'
    },
    props: [
      { id: 'star-a', kind: 'control-star', x: 0, y: 2, active: false },
      { id: 'star-b', kind: 'control-star', x: 4, y: 4, active: true }
    ],
    units: [
      { id: 'latte', team: 'you', x: 0, y: 2, hp: 10, maxHp: 10, atk: 6, def: 3, mov: 0, range: 1, acted: false },
      { id: 'boss-bear', team: 'foe', x: 2, y: 2, hp: 1, maxHp: 10, atk: 6, def: 3, mov: 0, range: 1, acted: false }
    ]
  });
  var activate = R.listLegalActions(state, 'latte').find(function (entry) { return entry.type === 'activate-device'; });
  assert(activate);
  var activated = R.applyAction(state, activate);
  assert.strictEqual(R.getProp(activated.state, 'star-a').active, true);
  R.getUnit(activated.state, 'boss-bear').hp = 0;
  assert.strictEqual(R.evaluateObjective(activated.state).status, 'victory');
});

test('turn limit defeat is enforced on phase advancement', function () {
  var state = fixture({
    phase: 'foe',
    turn: 1,
    objective: { type: 'deliver-and-escape', text: '배터리를 옮기세요', turnLimit: 1, itemId: 'battery-core', pickupAt: { x: 0, y: 2 }, escapeAt: { x: 4, y: 4 } }
  });
  var next = R.endPhase(state);
  assert.strictEqual(next.turn, 2);
  assert.strictEqual(next.status, 'defeat');
});

test('clocktower mission keeps a full-party victory route after balance changes', function () {
  var state = R.createState(Missions.createMission('clocktower-core'));
  var steps = [
    { actorId: 'latte', type: 'wait', from: { x: 1, y: 3 } },
    { actorId: 'mint', type: 'attack', targetId: 'spring-1', from: { x: 4, y: 6 } },
    { actorId: 'latte', type: 'activate-device', deviceId: 'star-a', from: { x: 1, y: 1 } },
    { actorId: 'mint', type: 'wait', from: { x: 5, y: 4 } },
    { actorId: 'latte', type: 'attack', targetId: 'boss-bear', from: { x: 1, y: 1 } },
    { actorId: 'mint', type: 'activate-device', deviceId: 'star-b', from: { x: 5, y: 1 } },
    { actorId: 'latte', type: 'attack', targetId: 'boss-bear', from: { x: 1, y: 1 } }
  ];

  function findAction(currentState, step) {
    return R.listLegalActions(currentState, step.actorId).find(function (action) {
      if (action.type !== step.type) return false;
      if (step.targetId && action.targetId !== step.targetId) return false;
      if (step.deviceId && action.deviceId !== step.deviceId) return false;
      if (step.from && (!action.from || action.from.x !== step.from.x || action.from.y !== step.from.y)) return false;
      return true;
    });
  }

  steps.forEach(function (step, index) {
    var action = findAction(state, step);
    assert(action, 'missing scripted action at step ' + index + ': ' + JSON.stringify(step));
    state = R.applyAction(state, action).state;
    if ((index === 1 || index === 3 || index === 5) && state.status === 'active') {
      state = R.endPhase(state);
      R.aliveUnits(state, 'foe').forEach(function (enemy) {
        var foeAction = R.chooseAiAction(state, enemy.id);
        if (foeAction) state = R.applyAction(state, foeAction).state;
      });
      if (state.status === 'active') state = R.endPhase(state);
    }
  });

  assert.strictEqual(state.status, 'victory');
  assert.deepStrictEqual(
    R.aliveUnits(state, 'you').map(function (unit) { return unit.id; }).sort(),
    ['latte', 'mint']
  );
});

test('enemy phase forecast is non-mutating and deterministic across a round trip', function () {
  var state = fixture();
  var snapshot = JSON.stringify(state);
  var first = R.forecastEnemyPhase(state);
  assert.strictEqual(JSON.stringify(state), snapshot, 'forecast mutated the source state');
  var second = R.forecastEnemyPhase(JSON.parse(JSON.stringify(state)));
  assert.deepStrictEqual(first, second);
});

test('enemy phase forecast predicts the same friend HP the real phase produces', function () {
  Missions.listMissionIds().forEach(function (id) {
    var state = R.createState(Missions.createMission(id));
    var forecast = R.forecastEnemyPhase(state);
    var sim = R.endPhase(state);
    R.aliveUnits(sim, 'foe').map(function (unit) { return unit.id; }).forEach(function (foeId) {
      if (sim.status !== 'active') return;
      var unit = R.getUnit(sim, foeId);
      if (!unit || unit.hp <= 0) return;
      var action = R.chooseAiAction(sim, foeId);
      if (action) { var applied = R.applyAction(sim, action); if (applied.ok) sim = applied.state; }
    });
    var real = {};
    R.aliveUnits(state, 'you').forEach(function (unit) { var after = R.getUnit(sim, unit.id); real[unit.id] = after ? Math.max(0, after.hp) : 0; });
    assert.deepStrictEqual(forecast.hpAfter, real, id + ' forecast HP mismatch');
  });
});

test('guard stance visibly lowers the forecast incoming damage', function () {
  var state = fixture({
    phase: 'you',
    units: [
      { id: 'latte', team: 'you', role: 'guardian', x: 1, y: 1, hp: 10, maxHp: 10, atk: 5, def: 1, mov: 0, range: 1 },
      { id: 'mint', team: 'you', role: 'marksman', x: 1, y: 2, hp: 8, maxHp: 8, atk: 5, def: 1, mov: 0, range: 2 },
      { id: 'bot', team: 'foe', x: 2, y: 2, hp: 8, maxHp: 8, atk: 6, def: 1, mov: 0, range: 1 }
    ]
  });
  var before = R.forecastEnemyPhase(state).damageTo.mint || 0;
  var guard = R.listLegalActions(state, 'latte').find(function (action) { return action.type === 'guard-stance'; });
  var guarded = R.applyAction(state, guard).state;
  var after = R.forecastEnemyPhase(guarded).damageTo.mint || 0;
  assert(before > 0, 'expected the bot to threaten mint');
  assert(after < before, 'guard should reduce forecast damage: ' + before + ' -> ' + after);
});

var failed = 0;
tests.forEach(function (item) {
  try {
    item.fn();
    console.log('ok - ' + item.name);
  } catch (error) {
    failed += 1;
    console.error('not ok - ' + item.name);
    console.error(error.stack);
  }
});
if (failed) process.exitCode = 1;
else console.log('passed ' + tests.length + ' tests');
