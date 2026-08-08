'use strict';
var assert = require('assert');
var R = require('../engine/rules.js');

function fixture(overrides) {
  var base = {
    width: 5, height: 5, phase: 'you', turn: 1, rng: { seed: 1234 },
    terrain: [[0,0,0,0,0],[0,0,1,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],
    objective: { type: 'eliminate', targetTeam: 'foe', text: '장난감을 멈추세요' },
    units: [
      { id:'latte', team:'you', x:0,y:2,hp:10,maxHp:10,atk:6,def:3,mov:2,range:1,acted:false },
      { id:'mint', team:'you', x:0,y:3,hp:8,maxHp:8,atk:5,def:1,mov:2,range:2,acted:false },
      { id:'bot', team:'foe', x:2,y:2,hp:5,maxHp:5,atk:4,def:2,mov:2,range:1,acted:false }
    ]
  };
  if (overrides) Object.keys(overrides).forEach(function (k) { base[k] = overrides[k]; });
  return R.createState(base);
}

var tests = [];
function test(name, fn) { tests.push({ name:name, fn:fn }); }

test('state is JSON serializable and legal actions survive round trip', function () {
  var state = fixture();
  var before = R.listLegalActions(state, 'latte').map(R.actionKey);
  var restored = JSON.parse(JSON.stringify(state));
  assert.deepStrictEqual(R.listLegalActions(restored, 'latte').map(R.actionKey), before);
});

test('movement blocks terrain and enemies but permits ally pass-through', function () {
  var state = fixture();
  var cells = R.computeReachable(state, 'latte').map(function (p) { return R.key(p.x,p.y); });
  assert(!cells.includes('2,2'));
  assert(!cells.includes('2,1'));
  assert(cells.includes('0,4'));
  assert(!cells.includes('0,3'));
});

test('line of sight is blocked by an intermediate wall', function () {
  var state = fixture({
    terrain:[[0,0,0],[0,1,0],[0,0,0]], width:3, height:3,
    units:[
      {id:'mint',team:'you',x:0,y:1,hp:8,maxHp:8,atk:5,def:1,mov:0,range:2,acted:false},
      {id:'bot',team:'foe',x:2,y:1,hp:5,maxHp:5,atk:4,def:2,mov:0,range:1,acted:false}
    ]
  });
  assert.strictEqual(R.hasLineOfSight(state,{x:0,y:1},{x:2,y:1}),false);
  assert(!R.listLegalActions(state,'mint').some(function(a){return a.type==='attack';}));
});

test('forecast is non-mutating and matches fixed resolution with counter', function () {
  var state = fixture();
  var action = R.listLegalActions(state,'latte').find(function(a){return a.type==='attack'&&a.targetId==='bot';});
  var snapshot = JSON.stringify(state);
  var forecast = R.forecastAction(state, action);
  assert.strictEqual(JSON.stringify(state), snapshot);
  assert.strictEqual(forecast.damage, 4);
  assert.strictEqual(forecast.counterDamage, 1);
  var result = R.applyAction(state, action);
  assert(result.ok);
  assert.strictEqual(R.getUnit(result.state,'bot').hp, forecast.targetHpAfter);
});

test('move action commits position without consuming the unit action', function () {
  var state = fixture();
  var move = R.listLegalActions(state,'latte').find(function(a){return a.type==='move'&&a.to.x===1&&a.to.y===2;});
  var result = R.applyAction(state, move);
  assert(result.ok);
  assert.strictEqual(R.getUnit(result.state,'latte').x,1);
  assert.strictEqual(R.getUnit(result.state,'latte').acted,false);
  assert.strictEqual(R.getUnit(result.state,'latte').moved,true);
  assert(!R.listLegalActions(result.state,'latte').some(function(a){return a.type==='move';}));
  assert(R.listLegalActions(result.state,'latte').some(function(a){return a.type==='attack'&&a.targetId==='bot';}));
  assert.strictEqual(R.getUnit(state,'latte').x,0);
});

test('move action leaves a manual wait choice instead of auto-waiting', function () {
  var state = fixture();
  var move = R.listLegalActions(state,'latte').find(function(a){return a.type==='move'&&a.to.x===1&&a.to.y===2;});
  var moved = R.applyAction(state, move).state;
  var waits = R.listLegalActions(moved,'latte').filter(function(a){return a.type==='wait';});
  assert.strictEqual(R.getUnit(moved,'latte').acted,false);
  assert(waits.some(function(a){return a.from.x===1&&a.from.y===2;}));
});

test('shared legal action generator includes attack options from reachable tiles', function () {
  var state = fixture({
    units:[
      { id:'latte', team:'you', x:0,y:2,hp:10,maxHp:10,atk:6,def:3,mov:2,range:1,acted:false },
      { id:'mint', team:'you', x:0,y:4,hp:8,maxHp:8,atk:5,def:1,mov:2,range:2,acted:false },
      { id:'bot', team:'foe', x:3,y:2,hp:5,maxHp:5,atk:4,def:2,mov:2,range:1,acted:false }
    ]
  });
  var attack = R.listLegalActions(state,'latte').find(function(a){
    return a.type==='attack' && a.targetId==='bot' && a.from.x===2 && a.from.y===2;
  });
  assert(attack);
});

test('threat range is derived deterministically from shared rules', function () {
  var state = fixture();
  R.getUnit(state,'bot').acted = true;
  R.getUnit(state,'bot').moved = true;
  var first = R.listThreatenedTiles(state,'foe').map(function(p){return R.key(p.x,p.y);});
  var second = R.listThreatenedTiles(JSON.parse(JSON.stringify(state)),'foe').map(function(p){return R.key(p.x,p.y);});
  assert.deepStrictEqual(first,second);
  assert(first.includes('1,2'));
  assert(first.includes('4,2'));
  assert.strictEqual(R.getUnit(state,'bot').acted,true);
  assert.strictEqual(R.getUnit(state,'bot').moved,true);
});

test('forecast does not consume rng state', function () {
  var state = fixture();
  var action = R.listLegalActions(state,'latte').find(function(a){return a.type==='attack'&&a.targetId==='bot';});
  var before = JSON.stringify(state.rng);
  R.forecastAction(state, action);
  assert.strictEqual(JSON.stringify(state.rng), before);
});

test('apply action advances injected rng deterministically', function () {
  var state = fixture();
  var action = R.listLegalActions(state,'latte').find(function(a){return a.type==='attack'&&a.targetId==='bot';});
  var first = R.applyAction(state, action).state;
  var second = R.applyAction(fixture(), action).state;
  assert.notStrictEqual(JSON.stringify(first.rng), JSON.stringify(state.rng));
  assert.deepStrictEqual(first, second);
  var injected = R.applyAction(state, action, function(rng){return {value:0.5,state:{seed:rng.seed+11}};}).state;
  assert.strictEqual(injected.rng.seed,state.rng.seed+11);
});

test('invalid action changes neither state nor rng', function () {
  var state = fixture();
  var snapshot = JSON.stringify(state);
  var result = R.applyAction(state,{type:'move',actorId:'latte',to:{x:2,y:1}});
  assert.strictEqual(result.ok,false);
  assert.strictEqual(JSON.stringify(state),snapshot);
  assert.strictEqual(JSON.stringify(result.state),snapshot);
});

test('objective status comes from state', function () {
  var state = fixture();
  R.getUnit(state,'bot').hp = 0;
  assert.strictEqual(R.evaluateObjective(state).status,'victory');
  R.getUnit(state,'latte').hp = 0; R.getUnit(state,'mint').hp = 0;
  assert.strictEqual(R.evaluateObjective(state).status,'defeat');
});

test('seeded RNG and AI choice are deterministic', function () {
  assert.deepStrictEqual(R.nextRandom({seed:99}),R.nextRandom({seed:99}));
  var state = fixture();
  var firstDraw = R.drawRandom(state);
  var repeatedDraw = R.drawRandom(JSON.parse(JSON.stringify(state)));
  assert.deepStrictEqual(firstDraw,repeatedDraw);
  assert.notDeepStrictEqual(firstDraw.state.rng,state.rng);
  assert.deepStrictEqual(R.drawRandom(firstDraw.state),R.drawRandom(repeatedDraw.state));
  var injected = R.drawRandom(state,function(rng){return {value:0.25,state:{seed:rng.seed+7}};});
  assert.strictEqual(injected.value,0.25);
  assert.strictEqual(injected.state.rng.seed,state.rng.seed+7);
  var aiState = fixture(); aiState.phase='foe';
  var choice = R.chooseAiAction(aiState,'bot');
  assert.deepStrictEqual(choice,R.chooseAiAction(JSON.parse(JSON.stringify(aiState)),'bot'));
  assert(R.listLegalActions(aiState,'bot').map(R.actionKey).includes(R.actionKey(choice)));
});

test('ai choice is always one of the legal actions', function () {
  var state = fixture(); state.phase='foe';
  var choice = R.chooseAiAction(state,'bot');
  var legal = R.listLegalActions(state,'bot').map(R.actionKey);
  assert(choice);
  assert(legal.includes(R.actionKey(choice)));
});

var failed = 0;
tests.forEach(function (item) {
  try { item.fn(); console.log('ok - ' + item.name); }
  catch (error) { failed += 1; console.error('not ok - ' + item.name); console.error(error.stack); }
});
if (failed) process.exitCode = 1;
else console.log('passed ' + tests.length + ' tests');
