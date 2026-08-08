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
