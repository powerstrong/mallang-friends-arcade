/*
 * 말랑프렌즈 키우기 — 전투 무대(씬 렌더러) **실브라우저** 회귀 테스트
 *   전투 화면 개편 단계 0 의 완료 조건을 그대로 고정한다.
 *
 *   node games/mallang-idle/tests/stage.browser.test.js
 *
 * 단계 0 체크리스트 (../COMBAT_STAGE_OVERHAUL.md 6절) → 이 파일이 검사하는 것:
 *   ① 엔진 사건을 **큐가** 소비한다 (game.js 가 무대를 직접 그리지 않는다)
 *   ② 배속·복귀에서 화면이 밀리거나 사건이 유실되지 않는다
 *   ③ 감속 모드(prefers-reduced-motion)에서 화면이 깨지지 않는다 — 움직임만 줄고
 *      적·HP 같은 **정보는 남는다**
 *   ④ (기존 회귀는 first-visit / multi-tab 이 담당)
 *
 * 정적 테스트로는 ②③ 을 잡을 수 없다 — 실제 캔버스 크기·computed style·큐 통계가
 * 필요하다. AGENT_PROTOCOL 7절의 "숨은 창에서는 애니메이션이 얼어붙는다"에 따라
 * 위치·전이가 아니라 **상태와 수치**로 판정한다.
 */
'use strict';

var H = require('./browser-harness.js');

var passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

/* 인트로를 넘기고 게임 시간이 흐르는 상태로 만든다. */
async function boot(pg) {
  var booted = false;
  for (var i = 0; i < 100; i++) {
    booted = await pg.eval('!!(window.__mallangIdle && document.getElementById("introStart"))');
    if (booted) break;
    await pg.sleep(100);
  }
  if (!booted) throw new Error('boot timeout');
  await pg.clickEl('introStart');
  await pg.sleep(300);
  // 오프닝 컷신이 떠 있으면 건너뛴다 (컷신 중에는 게임 시간이 멈춘다)
  var story = await pg.eval('getComputedStyle(document.getElementById("storyOverlay")).display');
  if (story !== 'none') { await pg.clickEl('storySkip'); await pg.sleep(300); }
  return booted;
}

function J(expr) { return 'JSON.stringify(' + expr + ')'; }

async function main(pg) {
  await boot(pg);

  // ── ① 무대가 큐를 통해 그려진다 ─────────────────────────────
  var wired = JSON.parse(await pg.eval(J(
    '({ hasStage: !!window.__mallangIdle.Stage,' +
    '   hasQueue: !!(window.__mallangIdle.Stage && window.__mallangIdle.Stage.queue),' +
    '   cam: !!document.getElementById("stageCam"),' +
    '   canvas: !!document.getElementById("fxCanvas") })')));
  ok(wired.hasStage && wired.hasQueue, '무대와 연출 큐가 연결되어 있다', wired);
  ok(wired.cam, '카메라 래퍼(.stage-cam)가 존재한다', wired);
  ok(wired.canvas, '캔버스 파티클 레이어가 존재한다', wired);

  // 실제 플레이가 큐를 통과하는가 — 잠시 굴린 뒤 통계를 본다
  await pg.sleep(2500);
  var st = JSON.parse(await pg.eval(J('window.__mallangIdle.Stage.queue.stats()')));
  ok(st.pushed > 0, '실제 플레이에서 엔진 사건이 큐로 들어간다', st);
  ok(st.pushed === st.dispatched, '들어간 사건이 전부 전달된다 (유실 0)', st);

  // ── 캔버스가 실제 픽셀 크기를 갖는가 (DPR 반영) ──────────────
  var cv = JSON.parse(await pg.eval(J(
    '(function(){var c=document.getElementById("fxCanvas");var r=c.getBoundingClientRect();' +
    'return {w:c.width, h:c.height, cssW:Math.round(r.width), cssH:Math.round(r.height)};})()')));
  ok(cv.w > 0 && cv.h > 0, '캔버스가 실제 픽셀 크기를 갖는다 (0 이면 아무것도 안 그려진다)', cv);
  ok(cv.w >= cv.cssW, '캔버스 픽셀 폭이 CSS 폭 이상이다 (DPR 반영)', cv);

  // ── ② 배속·대량 진행에서 유실 0 + 밀리지 않음 ────────────────
  var burst = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle;' +
    ' H.advance(600);' +                       // 10분을 한 번에 — 사건이 통째로 쏟아진다
    ' var s=H.Stage.queue.stats();' +
    ' return { pushed:s.pushed, dispatched:s.dispatched, idle:H.Stage.queue.idle(),' +
    '          backlog:H.Stage.queue.backlog() };})()')));
  ok(burst.pushed === burst.dispatched, '대량 진행(10분 즉시)에서도 유실이 없다', burst);
  ok(burst.idle, '대량 진행 뒤 큐가 비어 있다 (밀리지 않는다)', burst);

  // ── 무대가 엔진 진실로 스냅한다 (영구 어긋남 없음) ───────────
  var sync = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle; var s=H.state, v=H.Stage.view;' +
    ' var expect = s.phase === "advance" ? "advance" : (s.phase === "boss" ? "boss" : "fight");' +
    ' return { phase:s.phase, mode:v.mode, expect:expect, alive:v.alive,' +
    '          enemyHidden: document.getElementById("enemy").hidden };})()')));
  ok(sync.mode === sync.expect, '연출이 끝나면 무대가 엔진 상태로 스냅한다', sync);
  ok(sync.phase === 'advance' ? sync.enemyHidden : !sync.enemyHidden,
    '전진 중엔 적이 숨고, 교전 중엔 적이 보인다', sync);

  // ── 여러 번 반복해도 누적 어긋남이 없다 ──────────────────────
  var repeat = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle; var bad=0;' +
    ' for (var i=0;i<12;i++){ H.advance(37);' +
    '   var s=H.state, v=H.Stage.view;' +
    '   var expect = s.phase === "advance" ? "advance" : (s.phase === "boss" ? "boss" : "fight");' +
    '   if (v.mode !== expect) bad++; }' +
    ' var st=H.Stage.queue.stats();' +
    ' return { bad:bad, pushed:st.pushed, dispatched:st.dispatched };})()')));
  ok(repeat.bad === 0, '반복 진행에서도 무대와 엔진이 어긋나지 않는다', repeat);
  ok(repeat.pushed === repeat.dispatched, '반복 진행 누적에서도 유실 0', repeat);

  // ── 실시간 재생이 살아 있다 (몰아보기가 상시화되지 않았는가) ──
  var live = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle; var a=H.Stage.queue.stats();' +
    ' return { collapsed:a.collapsed, dispatched:a.dispatched };})()')));
  ok(live.dispatched > live.collapsed,
    '정상 재생된 사건이 몰아본 사건보다 많다 (몰아보기가 기본이 되면 연출이 죽는다)', live);
}

/* 감속 모드 — 움직임은 줄되 정보는 남아야 한다. */
async function reduced(pg) {
  await boot(pg);
  await pg.sleep(1200);
  var r = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle;' +
    ' H.advance(30);' +                       // 교전 상태를 만들고
    ' var before = H.Stage.fx.particleCount();' +
    ' H.Stage.fx.dust(50, 50, true);' +       // 파티클을 강제로 터뜨려 본다
    ' var after = H.Stage.fx.particleCount();' +
    ' var s=H.state;' +
    ' return { reduced:H.Stage.reducedMotion, before:before, after:after,' +
    '          phase:s.phase, mode:H.Stage.view.mode,' +
    '          enemyDisp:getComputedStyle(document.getElementById("enemy")).display,' +
    '          hpW:document.getElementById("enemyHpFill").style.width,' +
    '          stats:H.Stage.queue.stats() };})()')));

  ok(r.reduced === true, '감속 모드가 인식된다 (--force-prefers-reduced-motion)', r);
  ok(r.after === 0 && r.before === 0, '감속 모드에서는 캔버스 파티클을 만들지 않는다', r);
  ok(r.stats.pushed === r.stats.dispatched, '감속 모드에서도 사건 유실이 없다', r.stats);
  var fighting = r.phase !== 'advance';
  ok(fighting ? r.enemyDisp !== 'none' : true,
    '감속 모드에서도 적은 화면에 남는다 (움직임만 줄고 정보는 유지)', r);
  ok(fighting ? /%/.test(r.hpW) : true, '감속 모드에서도 HP 가 갱신된다', r);
}

H.withPage('/games/mallang-idle/index.html?dev=1', main).then(function () {
  return H.withPage('/games/mallang-idle/index.html?dev=1', reduced,
    { args: ['--force-prefers-reduced-motion'] });
}).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) {
  console.log('  FAIL (harness) ' + e.message);
  console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
