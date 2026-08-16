/*
 * 말랑프렌즈 키우기 — 멀티탭 가드 **실브라우저** 테스트
 *
 * 배경(codex P1): 다른 탭이 저장을 이어받으면 이 탭은 멈춰야 하는데,
 * 1회성 토스트는 사라지면 이유를 알 수 없고 복구 동선도 없었다.
 * 지속형 모달 + "이 탭에서 이어하기" 소유권 회수를 검증한다.
 *
 * 실행:  node games/mallang-idle/tests/multi-tab.browser.test.js
 * 시나리오: 다른 탭의 더 새로운 저장을 localStorage 에 심고 storage 이벤트를 쏘면
 *  1. 게임이 멈추고(시간 정지) 지속형 모달이 뜬다
 *  2. "이 탭에서 이어하기"를 실좌표로 누르면 모달이 닫히고 시간이 다시 흐른다
 *  3. 이 탭이 소유권을 되찾아 저장을 다시 쓴다 (lastSaveAt 갱신)
 */
'use strict';

var H = require('./browser-harness.js');

var passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

H.withPage('/games/mallang-idle/index.html?dev=1', async function (pg) {
  // 부팅 → 인트로 시작 → 오프닝 스킵 (first-visit 테스트가 고정한 경로)
  var booted = false;
  for (var i = 0; i < 100; i++) {
    booted = await pg.eval('!!(window.__mallangIdle && document.getElementById("introStart"))');
    if (booted) break;
    await pg.sleep(100);
  }
  if (!booted) throw new Error('boot timeout');
  await pg.clickEl('introStart');
  await pg.sleep(300);
  await pg.clickEl('storySkip');
  await pg.sleep(300);

  // 첫 자동 저장(5초 주기)이 이뤄질 때까지 대기 — 가드 기준점(lastWroteAt)이 생긴다
  var saveKey = await pg.eval('window.__mallangIdle.Save.STORAGE_KEY');
  var saved = false;
  for (i = 0; i < 80; i++) {
    saved = await pg.eval('!!localStorage.getItem(' + JSON.stringify(saveKey) + ')');
    if (saved) break;
    await pg.sleep(150);
  }
  ok(saved, '자동 저장이 생성된다');

  // "다른 탭"이 더 새로운 저장을 쓴 상황을 재현: lastSaveAt 을 +500ms 로 조작해
  // 다시 쓰고, 같은 문서에는 storage 이벤트가 자동 발화하지 않으므로 합성해 쏜다.
  var fakeAt = await pg.eval(
    '(function(){var k=' + JSON.stringify(saveKey) + ';var raw=localStorage.getItem(k);' +
    'var at=Number(/"lastSaveAt"\\s*:\\s*(\\d+)/.exec(raw)[1])+500;' +
    'localStorage.setItem(k, raw.replace(/"lastSaveAt"\\s*:\\s*\\d+/, \'"lastSaveAt":\'+at));' +
    'window.dispatchEvent(new StorageEvent("storage", {key:k}));return at;})()');
  await pg.sleep(200);

  // 1. 지속형 모달 + 게임 정지
  var modal = await pg.eval('getComputedStyle(document.getElementById("tabModal")).display');
  ok(modal === 'flex', '다른 탭 감지 즉시 지속형 모달이 뜬다', modal);
  var tA = await pg.eval('window.__mallangIdle.state.t');
  await pg.sleep(800);
  var tB = await pg.eval('window.__mallangIdle.state.t');
  ok(tA === tB, '모달이 떠 있는 동안 게임 시간이 멈춘다', { before: tA, after: tB });

  // 2. "이 탭에서 이어하기" — 실좌표 클릭
  await pg.sleep(600);   // fakeAt(+500ms)이 과거가 되도록
  await pg.clickEl('tabResume');
  await pg.sleep(300);
  var modal2 = await pg.eval('getComputedStyle(document.getElementById("tabModal")).display');
  ok(modal2 === 'none', '이어하기를 누르면 모달이 닫힌다', modal2);
  var tC = await pg.eval('window.__mallangIdle.state.t');
  await pg.sleep(900);
  var tD = await pg.eval('window.__mallangIdle.state.t');
  ok(tD > tC, '이어하기 후 게임 시간이 다시 흐른다', { before: tC, after: tD });

  // 3. 소유권 회수 — 이 탭이 저장을 다시 썼다
  var nowAt = await pg.eval(
    'Number(/"lastSaveAt"\\s*:\\s*(\\d+)/.exec(localStorage.getItem(' + JSON.stringify(saveKey) + '))[1])');
  ok(nowAt > fakeAt, '이 탭이 소유권을 되찾아 최신 저장을 쓴다', { fake: fakeAt, now: nowAt });
}).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) {
  console.log('  FAIL (harness) ' + e.message);
  console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
