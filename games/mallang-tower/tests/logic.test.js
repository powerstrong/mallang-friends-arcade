'use strict';
// 순수 스택 로직 회귀 테스트. 실행: node games/mallang-tower/tests/logic.test.js
var assert = require('assert');
var L = require('../logic.js');
var tests = [];
function test(n, f) { tests.push({ n: n, f: f }); }

test('완전히 빗나가면 hit=false', function () {
  var r = L.computeDrop({ x: 0, w: 100 }, { x: 200, w: 100 }, 4);
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.newBlock, null);
});

test('오른쪽으로 어긋나면 겹친 부분만 남고 오른쪽 조각이 잘린다', function () {
  var r = L.computeDrop({ x: 0, w: 100 }, { x: 40, w: 100 }, 4);
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.perfect, false);
  assert.deepStrictEqual(r.newBlock, { x: 40, w: 60 }); // 겹침 [40,100]
  assert.strictEqual(r.slices.length, 1);
  assert.deepStrictEqual(r.slices[0], { x: 100, w: 40 }); // 잘린 오른쪽 [100,140]
});

test('왼쪽으로 어긋나면 왼쪽 조각이 잘린다', function () {
  var r = L.computeDrop({ x: 50, w: 100 }, { x: 0, w: 100 }, 4);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual(r.newBlock, { x: 50, w: 50 }); // 겹침 [50,100]
  assert.deepStrictEqual(r.slices[0], { x: 0, w: 50 });  // 잘린 왼쪽 [0,50]
});

test('허용오차 안이면 perfect: 잘림 없이 top에 정렬', function () {
  var r = L.computeDrop({ x: 100, w: 100 }, { x: 103, w: 100 }, 4);
  assert.strictEqual(r.perfect, true);
  assert.deepStrictEqual(r.newBlock, { x: 100, w: 100 });
  assert.strictEqual(r.slices.length, 0);
});

test('접점만 닿으면(overlap=0) hit=false', function () {
  var r = L.computeDrop({ x: 0, w: 100 }, { x: 100, w: 100 }, 4);
  assert.strictEqual(r.hit, false);
});

test('grow 는 최초 폭을 넘지 않는다', function () {
  assert.strictEqual(L.grow(60, 12, 120), 72);
  assert.strictEqual(L.grow(115, 12, 120), 120);
});

test('speedForFloor 는 상한을 지킨다', function () {
  assert.strictEqual(L.speedForFloor(0, 2, 0.15, 6), 2);
  assert.strictEqual(L.speedForFloor(100, 2, 0.15, 6), 6);
});

var failed = 0;
tests.forEach(function (t) { try { t.f(); console.log('ok - ' + t.n); } catch (e) { failed += 1; console.error('not ok - ' + t.n); console.error(e.message); } });
if (failed) { console.error('\n실패 ' + failed + '개'); process.exitCode = 1; } else console.log('\npassed ' + tests.length + ' tests');
