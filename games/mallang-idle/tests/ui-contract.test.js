/*
 * 말랑프렌즈 키우기 — UI 정적 계약 테스트
 *
 *   node games/mallang-idle/tests/ui-contract.test.js
 *
 * 브라우저 없이 잡을 수 있는 UI 회귀를 고정한다. 배경: hidden 속성이 클래스의
 * display 에 눌려 "인트로가 시작하기를 눌러도 안 사라지는" 사고가 배포에서 났다.
 * 속성값 단언과 프로그램적 click() 만 쓰는 자동화는 이를 놓친다 — 여기서는 소스
 * 계약을, 배포 전 점검은 computed style + elementFromPoint 좌표 클릭으로 한다
 * (AGENT_PROTOCOL 7절).
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

var css = read('style.css');
var html = read('index.html');
var gameJs = read('game.js');
var audioJs = read('audio.js');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('[hidden] 전역 가드가 존재한다', function () {
  assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css),
    'style.css 에 [hidden]{display:none !important} 가드가 있어야 한다. ' +
    '지우면 인트로/모달이 hidden 인데도 화면에 남는다.');
});

test('가드가 다른 규칙보다 먼저 온다', function () {
  var guardAt = css.indexOf('[hidden]');
  var firstClass = css.search(/^\.[a-z]/m);
  assert.ok(guardAt >= 0 && (firstClass === -1 || guardAt < firstClass),
    '[hidden] 가드는 클래스 규칙들보다 앞(파일 최상단)에 있어야 한다');
});

test('오버레이·모달 요소는 hidden 속성으로 시작한다', function () {
  ['id="intro"', 'id="offlineModal"', 'id="dungeonModal"', 'id="devPanel"'].forEach(function (id) {
    var m = html.match(new RegExp('<[^>]*' + id + '[^>]*>'));
    assert.ok(m, id + ' 요소가 존재해야 한다');
    assert.ok(/\shidden[\s>]/.test(m[0]), id + ' 는 hidden 으로 시작해야 한다: ' + m[0]);
  });
  // 인트로는 JS 가 첫 방문에만 연다
  assert.ok(gameJs.indexOf('el.intro.hidden = false') !== -1, '인트로는 JS 가 연다');
});

test('시작 전에는 게임 시간이 멈춰 있다 (시작 게이트)', function () {
  assert.ok(/gameStarted\s*=\s*false/.test(gameJs), '인트로 표시 시 gameStarted=false');
  assert.ok(/simDt > 0 && gameStarted/.test(gameJs), '프레임 루프가 gameStarted 를 확인해야 한다');
});

test('viewport 는 확대를 막지 않는다 (접근성)', function () {
  assert.ok(html.indexOf('user-scalable=no') === -1, 'user-scalable=no 금지');
});

test('Math.random 금지는 엔진·데이터·시뮬 계층에만 적용된다', function () {
  // 표현 계층(game.js 연출 지터, audio.js 노이즈)은 허용 — 결정론과 무관하다.
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }
  ['engine/combat.js', 'engine/save.js', 'engine/balance.js', 'engine/dungeon.js',
   'data/chapters.js', 'data/characters.js', 'data/quests.js', 'tools/sim.js'].forEach(function (p) {
    assert.ok(stripComments(read(p)).indexOf('Math.random') === -1,
      p + ' 의 실행 코드에 Math.random 이 있으면 안 된다');
  });
  // rng.js 는 seeded 구현 자체이므로 대상이 아니고, audio/game 은 표현 계층이라 허용
  assert.ok(audioJs.indexOf('Math.random') !== -1, 'audio.js 의 노이즈는 표현 계층 — 허용 확인');
});

test('전투 이펙트에는 노드 상한이 있다', function () {
  assert.ok(/FX_CAP\s*=\s*\d+/.test(gameJs), '이펙트 동시 노드 상한(FX_CAP)이 있어야 한다');
  assert.ok(/fxCount\s*>=\s*FX_CAP/.test(gameJs), '상한 초과 시 스폰을 건너뛰어야 한다');
});

test('참조하는 에셋 파일이 전부 존재한다', function () {
  var src = html + gameJs + css + read('data/chapters.js') + read('data/characters.js') + read('engine/balance.js');
  var refs = src.match(/assets\/[A-Za-z0-9_.-]+\.(?:png|jpg)/g) || [];
  var uniq = {};
  refs.forEach(function (r) { uniq[r] = 1; });
  Object.keys(uniq).forEach(function (r) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', r)), '에셋 누락: ' + r);
  });
  assert.ok(Object.keys(uniq).length >= 30, '에셋 참조가 비정상적으로 적다: ' + Object.keys(uniq).length);
});

var pass = 0, fail = 0;
tests.forEach(function (t) {
  try { t.fn(); console.log('  ok   ' + t.name); pass++; }
  catch (e) { console.log('  FAIL ' + t.name + '\n       ' + e.message); fail++; }
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
