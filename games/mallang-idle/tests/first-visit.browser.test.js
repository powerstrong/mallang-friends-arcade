/*
 * 말랑프렌즈 키우기 — 첫 방문 시작 플로우 **실브라우저** 회귀 테스트
 *
 * 배경(codex P0): 부팅 렌더가 인트로(z-50) 위로 챕터 컷신(z-65)을 띄워 시작 버튼이
 * 눌리지 않는 회귀가 배포까지 나갔는데, 소스 문자열만 보는 정적 테스트 43개는 전부
 * 통과했다. 이 시나리오는 computed style 과 실좌표 클릭으로만 잡을 수 있다.
 *
 * 실행:  node games/mallang-idle/tests/first-visit.browser.test.js
 *  - 의존성 없음 (tests/browser-harness.js — 헤드리스 Chrome/Edge + CDP)
 *  - 임시 프로필 + 임시 포트 origin → 항상 "완전 첫 방문" 상태
 *  - 브라우저가 없는 환경에서는 SKIPPED 를 출력하고 0 으로 종료한다
 *
 * 고정하는 회귀 조건 (codex 요구 그대로):
 *  1. 새 origin 진입 직후 intro=flex, storyOverlay=none (computed)
 *  2. 시작 버튼 중앙의 elementFromPoint 대상이 introStart
 *  3. 시작 전 t=0, gold=0
 *  4. 실좌표 클릭 1회 후 인트로가 사라지고 오프닝 컷신이 열린다
 *  5. 컷신을 끝까지 진행하면 다시 열리지 않는다(정확히 한 번)
 *  6. 컷신 종료 후 게임 시간이 실제로 진행된다
 */
'use strict';

var H = require('./browser-harness.js');

var passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

H.withPage('/games/mallang-idle/index.html?dev=1', async function (pg) {
  // 게임 부팅 대기 (__mallangIdle 은 ?dev=1 에서만 노출)
  var booted = false;
  for (var i = 0; i < 100; i++) {
    booted = await pg.eval('!!(window.__mallangIdle && document.getElementById("introStart"))');
    if (booted) break;
    await pg.sleep(100);
  }
  ok(booted, '게임이 부팅된다 (?dev=1 훅 노출)');
  if (!booted) throw new Error('boot timeout');

  // 1. 새 origin: 인트로는 보이고 컷신 오버레이는 숨어 있어야 한다 (computed)
  var disp = JSON.parse(await pg.eval(
    'JSON.stringify({intro: getComputedStyle(document.getElementById("intro")).display,' +
    ' story: getComputedStyle(document.getElementById("storyOverlay")).display})'));
  ok(disp.intro === 'flex', '새 origin 진입 직후 intro=flex', disp);
  ok(disp.story === 'none', '새 origin 진입 직후 storyOverlay=none (컷신이 인트로를 덮지 않는다)', disp);

  // 2. 시작 버튼 중앙의 실제 클릭 대상
  var target = await pg.eval(
    '(function(){var b=document.getElementById("introStart");var r=b.getBoundingClientRect();' +
    'var el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);' +
    'return el ? el.id || el.className : "none";})()');
  ok(target === 'introStart', '시작 버튼 중앙 elementFromPoint=introStart', target);

  // 3. 시작 전에는 게임 시간이 흐르지 않는다
  await pg.sleep(600);
  var pre = JSON.parse(await pg.eval(
    'JSON.stringify({t: window.__mallangIdle.state.t, gold: window.__mallangIdle.state.gold})'));
  ok(pre.t === 0 && pre.gold === 0, '시작 전 t=0 · gold=0', pre);

  // 4. 실좌표 클릭 1회 → 인트로 소멸 + 오프닝 컷신 오픈
  await pg.clickEl('introStart');
  await pg.sleep(400);
  var after = JSON.parse(await pg.eval(
    'JSON.stringify({intro: getComputedStyle(document.getElementById("intro")).display,' +
    ' story: getComputedStyle(document.getElementById("storyOverlay")).display})'));
  ok(after.intro === 'none', '클릭 1회로 인트로가 사라진다', after);
  ok(after.story === 'flex', '오프닝 컷신이 열린다', after);

  // 5. 건너뛰기(실좌표 클릭) → 컷신이 닫히고 다시 열리지 않는다 (정확히 한 번)
  await pg.clickEl('storySkip');
  await pg.sleep(1200);   // 재큐 회귀가 있으면 이 사이 다시 열린다
  var closed = await pg.eval('getComputedStyle(document.getElementById("storyOverlay")).display');
  ok(closed === 'none', '컷신 종료 후 다시 열리지 않는다 (오프닝 1회 재생)', closed);
  var seenCount = await pg.eval(
    'window.__mallangIdle.state.storySeen.filter(function(s){return s.indexOf("ch-")===0;}).length');
  ok(seenCount === 1, '본 챕터 컷신 기록이 정확히 1개', seenCount);

  // 6. 컷신이 걷힌 뒤 게임 시간이 실제로 진행된다 (rAF 기반 — 헤드리스 전면 탭)
  var t1 = await pg.eval('window.__mallangIdle.state.t');
  await pg.sleep(1500);
  var t2 = await pg.eval('window.__mallangIdle.state.t');
  ok(t2 > t1, '컷신 종료 후 게임 시간이 진행된다', { before: t1, after: t2 });
}).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) {
  console.log('  FAIL (harness) ' + e.message);
  console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
