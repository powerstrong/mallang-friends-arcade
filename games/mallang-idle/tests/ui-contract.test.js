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
/* 전투 화면은 render/stage.js 가 소유한다(단계 0 이관). 계약은 그대로이고
 * 검사 대상 파일만 코드를 따라 옮겨왔다. */
var stageJs = read('render/stage.js');
var queueJs = read('render/queue.js');

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
  assert.ok(/FX_CAP\s*=\s*\d+/.test(stageJs), '이펙트 동시 노드 상한(FX_CAP)이 있어야 한다');
  assert.ok(/fxCount\s*>=\s*FX_CAP/.test(stageJs), '상한 초과 시 스폰을 건너뛰어야 한다');
  assert.ok(/PARTICLE_CAP\s*=\s*\d+/.test(stageJs), '캔버스 파티클에도 상한이 있어야 한다');
  assert.ok(/pcount\s*>=\s*PARTICLE_CAP/.test(stageJs), '파티클 상한 초과 시 스폰을 건너뛰어야 한다');
  /* 단계 1 확장 — 상한은 완화가 아니라 이관·강화됐다 (COMBAT_STAGE_OVERHAUL 결정 7) */
  assert.ok(/INFO_RESERVE\s*=\s*\d+/.test(stageJs), '정보 예산 예약(INFO_RESERVE)이 있어야 한다');
  assert.ok(/pcount\s*>=\s*PARTICLE_CAP\s*-\s*INFO_RESERVE/.test(stageJs),
    '포화 시 장식부터 거절해야 한다 (정보 예산 침범 금지)');
});

/* 단계 1 계약 — 전투 FX 는 캔버스가 소유한다. 장식 DOM 스폰이 되살아나면
 * 좌표계·히트스톱·상한 정책이 다시 두 갈래가 된다 (동작 검증은 stage.browser 가 한다). */
test('단계 1 — 장식 FX 는 캔버스 소유, 정보 DOM 은 캔버스 위', function () {
  assert.ok(!/spawnFx\('fx-(impact|slash|poof|proj)/.test(stageJs),
    '임팩트·궤적·펑·투사체는 캔버스로 이관됐다 — DOM 스폰이 되살아나면 안 된다');
  assert.ok(/hitstopT/.test(stageJs) && /\.arena\.hitstop/.test(css),
    '히트스톱은 stage FX 시계가 캔버스·DOM 을 함께 세운다');
  var fxLayerZ = (css.match(/\.fx-layer\s*\{[^}]*z-index:\s*(\d+)/) || [])[1];
  var canvasZ = (css.match(/\.fx-canvas\s*\{[^}]*z-index:\s*(\d+)/) || [])[1];
  assert.ok(fxLayerZ && canvasZ && Number(fxLayerZ) > Number(canvasZ),
    '정보 DOM 레이어(z ' + fxLayerZ + ')는 장식 캔버스(z ' + canvasZ + ')보다 위여야 한다');
  assert.ok(/\.gold-float\s*\{[^}]*z-index/.test(css), '골드 플로트에도 명시적 z-index 가 있어야 한다');
  assert.ok(/onIdle/.test(queueJs) && /onIdle:\s*flushPending/.test(stageJs),
    'collapsed 합산 골드는 queue idle 플러시로 반드시 표시된다');
});

/* 단계 2 계약 — 이동감의 뼈대가 배선되어 있다 (동작 검증은 stage.browser 가 한다) */
test('단계 2 — 시차 겹·전진 beat·주행 상태가 배선되어 있다', function () {
  assert.ok(/id="cloudLayer"/.test(html) && /id="farLayer"/.test(html),
    '시차 보강 겹(구름·원경) 노드가 있어야 한다');
  assert.ok(/\.cloud-layer/.test(css) && /\.far-layer/.test(css), '겹 스타일이 있어야 한다');
  assert.ok(/key:\s*'cloud'/.test(stageJs) && /key:\s*'far'/.test(stageJs),
    '겹이 시차 스택(LAYERS)에 들어 있어야 한다');
  var killBeat = Number((stageJs.match(/mob_kill:\s*([\d.]+)/) || [])[1]);
  assert.ok(killBeat >= 0.9,
    '전진 구간(mob_kill beat)은 0.9s 이상이어야 한다 — 줄이면 다시 순간이동이 된다: ' + killBeat);
  assert.ok(/\.hero\.walking\.running/.test(css) && /setGait/.test(stageJs),
    '걷기/달리기 구분(주행 상태)이 있어야 한다');
});

/* 에셋 시트 계약 (단계 2·3 부채 해소) — 여섯 캐릭터 전원이 6프레임 걷기/달리기,
 * 6프레임 기본공격, 8프레임 스킬 시트를 갖고, CSS 에 프레임 수 변형 클래스가 있다.
 * (steps(var()) 는 Chrome 셔한드가 소비하지 못해 고정 클래스로 푼다 — 실측)
 * 동작(스왑·플립북·복원)은 stage.browser 의 에셋 시트 절이 검증한다. */
test('캐릭터 전원이 다중 프레임 시트 규격을 갖는다', function () {
  var chars = read('data/characters.js');
  ['walkN: 6', 'runN: 6', 'atkSheetN: 6', 'atkSpN: 8'].forEach(function (field) {
    var n = (chars.match(new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    assert.ok(n === 6, '캐릭터 6명 전원에 ' + field + ' 가 있어야 한다 (현재 ' + n + '명)');
  });
  assert.ok(/\.hero\.walking\.frames-6/.test(css) && /\.hero\.walking\.running\.frames-6/.test(css),
    '6프레임 걷기/달리기 CSS 변형이 있어야 한다');
  assert.ok(/@keyframes atkFlip/.test(css) && /\.atk-6\b/.test(css) && /\.atk-8\b/.test(css),
    '공격 플립북(atkFlip)과 atk-6/atk-8 변형이 있어야 한다');
  assert.ok(/classList\.toggle\('frames-6'/.test(stageJs) && /classList\.add\('atk-' \+ sp\.n\)/.test(stageJs),
    'stage.js 가 프레임 수 클래스를 실제로 스왑해야 한다');
});

/* 단계 0 의 핵심 계약 — 전투 화면이 엔진 사건을 **연출 큐를 통해** 소비하는가.
 * game.js 가 무대를 직접 그리기 시작하면 페이싱이 다시 엔진에 붙어 버린다
 * (COMBAT_STAGE_OVERHAUL.md 5절 — 이 개편의 심장). */
test('전투 화면은 연출 큐를 통해 그려진다', function () {
  assert.ok(/Stage\.push\(state\.events\)/.test(gameJs),
    'game.js 는 엔진 사건을 무대(연출 큐)에 넘겨야 한다');
  assert.ok(/Queue\.create/.test(stageJs), '무대는 연출 큐를 쓴다');
  assert.ok(/queue\.idle\(\)\s*\)\s*syncTo/.test(stageJs) || /if \(queue\.idle\(\)\) syncTo/.test(stageJs),
    '큐가 비면 무대가 엔진 진실로 스냅해야 한다(영구 어긋남 방지)');
  // 이관된 렌더 함수가 game.js 에 되살아나지 않았는지 — 두 벌이 생기면 페이싱이 갈라진다
  ['function renderArena', 'function heroStrikeFx', 'function spawnFx', 'function applySprite']
    .forEach(function (sig) {
      assert.ok(gameJs.indexOf(sig) === -1,
        'game.js 에 무대 렌더가 다시 생겼다: ' + sig + ' — render/stage.js 가 소유해야 한다');
    });
});

test('연출 큐는 사건을 유실하지 않는다 (불변조건이 코드에 남아 있다)', function () {
  assert.ok(/pushed/.test(queueJs) && /dispatched/.test(queueJs),
    '큐는 투입·전달 수를 세어 유실을 드러내야 한다 (tests/queue.test.js 가 이를 단언한다)');
});

test('참조하는 에셋 파일이 전부 존재한다', function () {
  var src = html + gameJs + stageJs + css + read('data/chapters.js') + read('data/characters.js') + read('engine/balance.js');
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
