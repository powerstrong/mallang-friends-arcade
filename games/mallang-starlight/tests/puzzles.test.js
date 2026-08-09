'use strict';
var assert = require('assert');
var P = require('../engine/puzzle.js');
var Puzzles = require('../data/puzzles.js');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ── BFS 솔버: beatLimit 안에서 최소 비트 / 무피해 최소 비트를 찾는다. ──────────────
function posKey(s) {
  return JSON.stringify([
    s.friends.map(function (f) { return [f.id, f.x, f.y, f.hearts]; }),
    s.toys.map(function (t) { return [t.id, t.x, t.y, t.gauge, t.fixed ? 1 : 0]; })
  ]);
}
function damage(s) { return s.friends.reduce(function (a, f) { return a + (f.maxHearts - f.hearts); }, 0); }
function commandPairs(s, noAbility) {
  var fids = P.activeFriends(s).map(function (f) { return f.id; });
  var opts = fids.map(function (id) { var cs = P.listCommands(s, id); if (noAbility) cs = cs.filter(function (c) { return !c.ability; }); return [null].concat(cs); });
  var pairs = [];
  if (fids.length <= 1) (opts[0] || []).forEach(function (a) { if (a) pairs.push([a]); });
  else opts[0].forEach(function (a) { opts[1].forEach(function (b) { var cs = [a, b].filter(Boolean); if (cs.length) pairs.push(cs); }); });
  return pairs;
}
function analyze(start, maxBeats, noAbility) {
  var minBeats = null, minZero = null, visited = {};
  var frontier = [start]; visited[posKey(start)] = true;
  for (var depth = 1; depth <= maxBeats && frontier.length; depth += 1) {
    var next = [];
    for (var i = 0; i < frontier.length; i += 1) {
      var pairs = commandPairs(frontier[i], noAbility);
      for (var j = 0; j < pairs.length; j += 1) {
        var r = P.applyBeat(frontier[i], pairs[j]);
        if (!r.ok) continue;
        var ns = r.state;
        if (ns.status === 'victory') {
          if (minBeats === null) minBeats = depth;
          if (minZero === null && damage(ns) === 0) minZero = depth;
        } else if (ns.status === 'active') {
          var k = posKey(ns); if (!visited[k]) { visited[k] = true; next.push(ns); }
        }
      }
    }
    if (minBeats !== null && (noAbility || minZero !== null)) break;
    frontier = next;
  }
  return { minBeats: minBeats, minZero: minZero };
}

test('every puzzle is deterministic and JSON-serializable', function () {
  Puzzles.list().forEach(function (cfg) {
    var a = P.createState(cfg);
    var b = P.createState(JSON.parse(JSON.stringify(cfg)));
    assert.strictEqual(JSON.stringify(a), JSON.stringify(b), cfg.id + ' nondeterministic');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), a, cfg.id + ' not serializable');
  });
});

test('preview equals apply and does not mutate source', function () {
  var s = P.createState(Puzzles.create('p1-push'));
  var cmds = P.listCommands(s, 'mint');
  var cmd = cmds.find(function (c) { return c.ability; }) || cmds[cmds.length - 1];
  var snap = JSON.stringify(s);
  var preview = P.previewBeat(s, [cmd]);
  assert.strictEqual(JSON.stringify(s), snap, 'preview mutated state');
  var applied = P.applyBeat(s, [cmd]);
  assert.strictEqual(JSON.stringify(preview.state), JSON.stringify(applied.state), 'preview != apply');
  assert.strictEqual(JSON.stringify(s), snap, 'apply mutated source');
});

test('illegal commands are rejected without mutation', function () {
  var s = P.createState(Puzzles.create('p1-push'));
  var snap = JSON.stringify(s);
  var res = P.applyBeat(s, [{ friendId: 'latte', to: { x: 0, y: 2 }, ability: null }]); // wall tile
  assert.strictEqual(res.ok, false);
  assert.strictEqual(JSON.stringify(s), snap);
});

test('toy intents are deterministic and computed from positions', function () {
  var s = P.createState(Puzzles.create('p1-push'));
  var t = P.getToy(s, 't1');
  assert(t.intent && (t.intent.type === 'beam' || t.intent.type === 'dash'));
  var again = P.createState(Puzzles.create('p1-push'));
  assert.deepStrictEqual(P.getToy(again, 't1').intent, t.intent);
});

test('units and props start on distinct, walkable cells', function () {
  Puzzles.list().forEach(function (cfg) {
    var occ = {};
    cfg.friends.concat(cfg.toys).forEach(function (u) {
      assert.strictEqual(cfg.terrain[u.y][u.x], 0, cfg.id + ' ' + u.id + ' starts on a wall');
      var k = u.x + ',' + u.y;
      assert(!occ[k], cfg.id + ' units overlap at ' + k);
      occ[k] = u.id;
    });
    (cfg.props || []).forEach(function (p) { assert.strictEqual(cfg.terrain[p.y][p.x], 0, cfg.id + ' ' + p.id + ' on a wall'); });
  });
});

test('each puzzle: solvable within limit, zero-damage path, par==optimal, abilities required', function () {
  Puzzles.list().forEach(function (cfg) {
    var s = P.createState(cfg);
    var res = analyze(s, cfg.objective.beatLimit, false);
    assert(res.minBeats !== null, cfg.id + ' is NOT solvable within beatLimit ' + cfg.objective.beatLimit);
    assert(res.minBeats <= cfg.objective.beatLimit, cfg.id + ' minBeats ' + res.minBeats + ' exceeds limit');
    assert.strictEqual(res.minBeats, cfg.par, cfg.id + ' par(' + cfg.par + ') should equal optimal beats(' + res.minBeats + ')');
    assert(res.minZero !== null, cfg.id + ' has NO zero-damage (2-star) solution');
    // 비자명성: 밀기/당기기 없이(이동만으로)는 beatLimit 안에 절대 못 푼다.
    var noAb = analyze(s, cfg.objective.beatLimit, true);
    assert.strictEqual(noAb.minBeats, null, cfg.id + ' is trivially solvable WITHOUT abilities (auto-solves)');
  });
});

test('victory requires every toy repaired', function () {
  var s = P.createState(Puzzles.create('p1-push'));
  assert.strictEqual(P.evaluate(s).status, 'active');
  P.activeToys(s).forEach(function (t) { t.fixed = true; });
  assert.strictEqual(P.evaluate(s).status, 'victory');
});

var failed = 0;
tests.forEach(function (t) {
  try { t.fn(); console.log('ok - ' + t.name); }
  catch (e) { failed += 1; console.error('not ok - ' + t.name); console.error(e.stack || e.message); }
});
if (failed) process.exitCode = 1; else console.log('passed ' + tests.length + ' tests');
