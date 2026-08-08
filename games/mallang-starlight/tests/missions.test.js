'use strict';
var assert = require('assert');
var Missions = require('../data/missions.js');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function everyCoordinateInBounds(mission) {
  mission.units.forEach(function (unit) {
    assert(unit.x >= 0 && unit.x < mission.width, unit.id + ' x out of bounds');
    assert(unit.y >= 0 && unit.y < mission.height, unit.id + ' y out of bounds');
  });
  (mission.props || []).forEach(function (prop) {
    assert(prop.x >= 0 && prop.x < mission.width, prop.id + ' x out of bounds');
    assert(prop.y >= 0 && prop.y < mission.height, prop.id + ' y out of bounds');
  });
}

test('mission ids are ordered and stable', function () {
  assert.deepStrictEqual(Missions.listMissionIds(), [
    'alley-tutorial',
    'battery-run',
    'clocktower-core'
  ]);
});

test('createMission returns deep clones', function () {
  var first = Missions.createMission('battery-run');
  first.units[0].x = 99;
  first.objective.turnLimit = 3;
  first.props[0].label = 'mutated';

  var second = Missions.createMission('battery-run');
  assert.strictEqual(second.units[0].x, 1);
  assert.strictEqual(second.objective.turnLimit, 6);
  assert.strictEqual(second.props[0].label, '별빛 배터리');
});

test('all mission payloads remain JSON serializable and round-trip cleanly', function () {
  Missions.listMissions().forEach(function (mission) {
    var restored = JSON.parse(JSON.stringify(mission));
    assert.deepStrictEqual(restored, mission);
  });
});

test('objective schemas carry explicit step data for non-eliminate missions', function () {
  var battery = Missions.createMission('battery-run');
  assert.strictEqual(battery.objective.type, 'deliver-and-escape');
  assert.strictEqual(battery.objective.turnLimit, 6);
  assert.deepStrictEqual(battery.objective.actions.map(function (step) { return step.type; }), [
    'pickup-item',
    'escape-with-item'
  ]);

  var boss = Missions.createMission('clocktower-core');
  assert.strictEqual(boss.objective.type, 'activate-then-defeat-boss');
  assert.strictEqual(boss.objective.requiredActiveCount, 2);
  assert.deepStrictEqual(boss.objective.actions.map(function (step) { return step.type; }), [
    'activate-device',
    'activate-device',
    'defeat-boss'
  ]);
});

test('all unit and prop coordinates fit inside 8x8 maps', function () {
  Missions.listMissions().forEach(everyCoordinateInBounds);
});

test('units and objectives start on walkable, non-overlapping cells', function () {
  Missions.listMissions().forEach(function (mission) {
    var occupied = {};
    mission.units.forEach(function (unit) {
      assert.strictEqual(mission.terrain[unit.y][unit.x], 0, unit.id + ' starts on blocked terrain');
      var key = unit.x + ',' + unit.y;
      assert(!occupied[key], 'units overlap at ' + key);
      occupied[key] = unit.id;
    });
    (mission.props || []).forEach(function (prop) {
      assert.strictEqual(mission.terrain[prop.y][prop.x], 0, prop.id + ' sits on blocked terrain');
    });
  });
});

test('battery route has enough turn budget before combat detours', function () {
  var mission = Missions.createMission('battery-run');
  function distance(from, to) {
    var queue = [{ x: from.x, y: from.y, cost: 0 }];
    var seen = {}; seen[from.x + ',' + from.y] = true;
    for (var i = 0; i < queue.length; i += 1) {
      var current = queue[i];
      if (current.x === to.x && current.y === to.y) return current.cost;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (dir) {
        var x = current.x + dir[0], y = current.y + dir[1], key = x + ',' + y;
        if (x < 0 || y < 0 || x >= mission.width || y >= mission.height || mission.terrain[y][x] !== 0 || seen[key]) return;
        seen[key] = true; queue.push({ x: x, y: y, cost: current.cost + 1 });
      });
    }
    return Infinity;
  }
  var carrier = mission.units.find(function (unit) { return unit.id === 'latte'; });
  var route = distance(carrier, mission.objective.pickupAt) + distance(mission.objective.pickupAt, mission.objective.escapeAt);
  assert(route <= carrier.mov * mission.objective.turnLimit, 'turn limit is below the shortest carrying route');
});

test('clocktower release balance keeps the split route readable', function () {
  var mission = Missions.createMission('clocktower-core');
  var boss = mission.units.find(function (unit) { return unit.id === 'boss-bear'; });
  assert.strictEqual(mission.parTurns, 8);
  assert.strictEqual(mission.objective.requiredActiveCount, 2);
  assert.deepStrictEqual(mission.objective.controlStars.map(function (star) { return [star.x, star.y]; }), [[1, 1], [5, 1]]);
  assert.strictEqual(mission.units.filter(function (unit) { return unit.team === 'foe'; }).length, 3);
  assert.deepStrictEqual({ hp: boss.hp, atk: boss.atk, def: boss.def, mov: boss.mov }, { hp: 11, atk: 5, def: 2, mov: 1 });
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
