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

  // ═══ 단계 1 기반 (COMBAT_STAGE_OVERHAUL 6절) ═══════════════════

  // ── 좌표 일치 — 캔버스 세계좌표와 DOM 액터 접점이 같은 곳을 가리킨다 ──
  /* 전에는 fxLayer 원점 기준 좌표를 캔버스(stage-cam 원점)에 그대로 그려 117px 위에
   * 찍혔다(codex 리뷰 실측). 세계좌표 = fx-canvas 로컬로 통일한 것을 고정한다. */
  var coord = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle;' +
    ' for (var i=0;i<40 && H.state.phase==="advance";i++) H.advance(3);' +
    ' var cv=document.getElementById("fxCanvas").getBoundingClientRect();' +
    ' var er=document.getElementById("enemyArt").getBoundingClientRect();' +
    ' var fr=document.getElementById("fxLayer").getBoundingClientRect();' +
    ' var p=H.Stage.fx.enemyPoint();' +
    ' var lp=H.Stage.fx.layerPoint(p.x,p.y);' +
    ' return { phase:H.state.phase,' +
    '   dx: Math.abs(p.x-(er.left+er.width*0.5-cv.left)),' +
    '   dy: Math.abs(p.y-(er.top+er.height*0.55-cv.top)),' +
    '   ldx: Math.abs(lp.x-(er.left+er.width*0.5-fr.left)),' +
    '   ldy: Math.abs(lp.y-(er.top+er.height*0.55-fr.top)),' +
    '   layerOffset: fr.top-cv.top };})()')));
  ok(coord.phase !== 'advance', '좌표 검증 전제 — 교전 상태를 만들었다', coord);
  ok(coord.dx < 2 && coord.dy < 2, '캔버스 세계좌표가 적 접점과 일치한다 (117px 오프셋 회귀)', coord);
  ok(coord.ldx < 2 && coord.ldy < 2, 'DOM 레이어 변환도 같은 접점을 가리킨다', coord);
  ok(coord.layerOffset > 10, '전제 확인 — 두 레이어의 원점이 실제로 다르다 (오프셋 존재)', coord);

  // ── 히트스톱 — 파티클 하위 시계만 얼고, DOM 클래스와 함께 풀린다 ──
  var hs = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle; var fx=H.Stage.fx;' +
    ' fx.stepDraw(30);' +
    ' fx.emit("dust", 100, 100, { vx: 60, vy: 0, life: 5 });' +
    ' fx.forceHitstop(0.06); fx.forceHitstop(0.02);' +
    ' var rem0=fx.hitstopRemaining();' +
    ' var s0=fx.snapshot()[0];' +
    ' H.Stage.update(0.03, 0, H.state);' +
    ' var s1=fx.snapshot()[0];' +
    ' var frozen = !!(s1 && s0.x===s1.x && s0.age===s1.age);' +
    ' var cls1=document.getElementById("arena").className.indexOf("hitstop")>=0;' +
    ' H.Stage.update(0.2, 0, H.state);' +
    ' H.Stage.update(0.05, 0, H.state);' +
    ' var s2=fx.snapshot()[0];' +
    ' var moved = !!(s2 && s2.x>s1.x);' +
    ' var cls2=document.getElementById("arena").className.indexOf("hitstop")>=0;' +
    ' fx.stepDraw(30);' +
    ' return { rem0:rem0, frozen:frozen, cls1:cls1, moved:moved, cls2:cls2 };})()')));
  ok(hs.rem0 >= 0.05, '중첩 히트스톱은 더 긴 쪽이 이긴다 (조기 해제 금지)', hs);
  ok(hs.frozen, '히트스톱 동안 파티클 위치·age 가 언다', hs);
  ok(hs.cls1, '히트스톱 동안 DOM 정지 클래스가 걸려 있다 (캔버스·DOM 동기)', hs);
  ok(hs.moved && !hs.cls2, '히트스톱이 끝나면 파티클이 다시 흐르고 클래스가 풀린다', hs);

  // ── 상한 포화 — 장식은 정보 예약분을 침범하지 못한다 ──
  var cap = JSON.parse(await pg.eval(J(
    '(function(){var fx=window.__mallangIdle.Stage.fx; var caps=fx.caps();' +
    ' fx.stepDraw(60);' +
    ' for (var i=0;i<caps.particle+50;i++) fx.emit("spark", 5, 5, { life: 30 });' +
    ' var deco=fx.particleCount();' +
    ' fx.emit("gold", 5, 5, { info: true, life: 30 });' +
    ' var withInfo=fx.particleCount();' +
    ' for (var j=0;j<caps.reserve+20;j++) fx.emit("gold", 5, 5, { info: true, life: 30 });' +
    ' var full=fx.particleCount();' +
    ' var over=fx.emit("gold", 5, 5, { info: true });' +
    ' fx.stepDraw(60);' +
    ' return { caps:caps, deco:deco, withInfo:withInfo, full:full,' +
    '          overRejected: over===undefined, cleaned: fx.particleCount() };})()')));
  ok(cap.deco === cap.caps.particle - cap.caps.reserve, '장식은 정보 예약분 앞에서 멈춘다', cap);
  ok(cap.withInfo === cap.deco + 1, '포화 상태에서도 정보는 받는다', cap);
  ok(cap.full === cap.caps.particle && cap.overRejected, '정보도 절대 상한은 넘지 않는다', cap);
  ok(cap.cleaned === 0, '수명이 다하면 풀이 완전히 복귀한다 (누수 없음)', cap);

  // ── CI 성능 게이트 — 파티클 최대 부하 프레임타임 (이 러너의 회귀 기준선) ──
  /* headless·GPU 비활성·고정 뷰포트라 "모바일 60fps"의 증거는 아니다 — 그 판정은
   * 단계 5 실기기 게이트가 한다. 여기서는 같은 러너에서의 회귀만 잡는다 (결정 6). */
  /* 평균은 상위 5% 절사 평균이다 — 헤드리스 러너의 단발 GC/스케줄링 이상치(실측 한
   * 프레임 352ms)가 게이트를 뒤집으면 안 된다. 지속적인 저하는 절사해도 그대로 잡힌다. */
  var perf = JSON.parse(await pg.eval(J(
    '(function(){var fx=window.__mallangIdle.Stage.fx; var caps=fx.caps();' +
    ' fx.stepDraw(120);' +
    ' for (var i=0;i<caps.particle-caps.reserve;i++) fx.emit("spark", (i*7)%390, (i*13)%300, { vx: 40, vy: -20, life: 600 });' +
    ' for (var j=0;j<caps.reserve;j++) fx.emit("gold", (j*11)%390, (j*17)%300, { info: true, vx: -30, vy: 10, life: 600 });' +
    ' var n=fx.particleCount();' +
    ' for (var w=0;w<30;w++) fx.stepDraw(1/240);' +
    ' var samples=[];' +
    ' for (var f=0;f<240;f++){ var t0=performance.now(); fx.stepDraw(1/240); var t1=performance.now(); samples.push(t1-t0); }' +
    ' fx.stepDraw(1200);' +
    ' samples.sort(function(a,b){return a-b;});' +
    ' var keep=Math.floor(samples.length*0.95);' +
    ' var sum=0; for (var k=0;k<keep;k++) sum+=samples[k];' +
    ' return { cap:caps.particle, n:n, avg:sum/keep,' +
    '          p95:samples[Math.floor(samples.length*0.95)], max:samples[samples.length-1] };})()')));
  ok(perf.n === perf.cap, '측정 전제 — PARTICLE_CAP 포화 상태다', perf);
  ok(perf.avg <= 8, 'CI 성능 게이트 — 최대 부하 절사 평균 프레임타임 ≤ 8ms', perf);
  ok(perf.p95 <= 16, 'CI 성능 게이트 — p95 ≤ 16ms', perf);

  // ── 슬라이스 1 — 타격 = 캔버스 버스트 + DOM 숫자(관측값) ──
  await pg.eval('(function(){var fx=window.__mallangIdle.Stage.fx; fx.stepDraw(1300);' +
    ' document.querySelectorAll(".fx-dmg").forEach(function(n){n.remove();});' +
    ' fx.strike(999, 1000); return 1;})()');
  await pg.sleep(260);   // 접촉 프레임(120ms) 이후
  var s1r = JSON.parse(await pg.eval(J(
    '(function(){var fx=window.__mallangIdle.Stage.fx;' +
    ' var hit=null; document.querySelectorAll(".fx-layer .fx-dmg").forEach(function(n){ if(n.textContent==="999") hit=n; });' +
    ' return { particles: fx.particleCount(), sheets: fx.sheetReady("impact") && fx.sheetReady("slash"),' +
    '   found: !!hit, cls: hit ? hit.className : null };})()')));
  ok(s1r.found, '데미지 숫자는 DOM 잔류 — 전달된 관측값 그대로 표시된다', s1r);
  ok(/huge/.test(s1r.cls || ''), '숫자 크기가 타격 크기(최대 HP 대비 몫)에 반응한다', s1r);
  ok(s1r.particles >= 8, '타격 접점에서 임팩트·궤적·스파크·섬광이 캔버스에 함께 터진다', s1r);
  ok(s1r.sheets, '플립북 시트가 decode 되어 캔버스 재생 준비가 되어 있다', s1r);

  // ── 슬라이스 2 — 처치 세트피스 + collapsed 합산 플러시 ──
  var s2a = JSON.parse(await pg.eval(J(
    '(function(){var fx=window.__mallangIdle.Stage.fx;' +
    ' fx.stepDraw(1300);' +
    ' fx.poofAt();' +
    ' return { particles: fx.particleCount(), poofSheet: fx.sheetReady("poof") };})()')));
  ok(s2a.particles >= 12, '처치가 펑 한 장이 아니다 — 플립북+파편+골드 분출+섬광 합성', s2a);
  ok(s2a.poofSheet, '처치 플립북 시트가 캔버스 재생 준비가 되어 있다', s2a);

  /* 몰아보기로만 끝나는 배치 — 합산 골드가 queue idle 플러시로 반드시 표시된다.
   * (전에는 다음 비-collapsed 처치가 있어야만 보였다 — 벽에 머물면 영영 증발) */
  var s2b = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle;' +
    ' H.Stage.push([{ type:"mob_kill", gold:0, stage:H.state.stage, index:0 }]);' +   // 라이브 잔여 합산분 선플러시
    ' H.Stage.update(1, 0, H.state);' +
    ' H.Stage.update(1, 0, H.state);' +          // 표시 쿨다운(0.25s)까지 소진
    ' document.querySelectorAll(".gold-float").forEach(function(n){n.remove();});' +
    ' var evs=[]; for (var i=0;i<60;i++) evs.push({ type:"mob_kill", gold:5, stage:H.state.stage, index:0 });' +
    ' H.Stage.push(evs);' +
    ' H.Stage.update(1/60, 0, H.state);' +       // collapseAt 초과 → 몰아보기 → idle 플러시
    ' var g=document.querySelector(".gold-float");' +
    ' return { gold: g ? g.textContent : null, idle: H.Stage.queue.idle() };})()')));
  ok(s2b.idle, '몰아본 배치가 즉시 소진된다', s2b);
  ok(s2b.gold === '+300', 'collapsed 로 끝난 배치의 합산 골드가 플러시된다 (60×5)', s2b);

  // ── 슬라이스 3 — 별 투사체가 캔버스 탄도로 날고, 착탄이 장식으로 터진다 ──
  var s3 = JSON.parse(await pg.eval(J(
    '(function(){var fx=window.__mallangIdle.Stage.fx;' +
    ' fx.stepDraw(1300);' +
    ' fx.shot(document.getElementById("hero"));' +
    ' var first=fx.lastEmit() ? fx.lastEmit().kind : null, n0=fx.particleCount(), maxN=0;' +
    ' for (var s=0;s<10;s++){ fx.stepDraw(0.1); var c=fx.particleCount(); if (c>maxN) maxN=c; }' +
    ' return { first:first, n0:n0, maxN:maxN, end:fx.particleCount(),' +
    '          domProj: document.querySelectorAll(".fx-proj").length };})()')));
  ok(s3.first === 'proj' && s3.n0 === 1, '투사체가 캔버스 파티클로 발사된다 (WAAPI DOM 폐지)', s3);
  ok(s3.domProj === 0, 'DOM 투사체 노드가 더는 생기지 않는다', s3);
  ok(s3.maxN >= 4, '착탄 순간 섬광+스파크가 터진다 (수명 종료 = 착탄)', s3);
  ok(s3.end === 0, '착탄 잔여물까지 수명이 다하면 풀이 완전히 복귀한다', s3);
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
  ok(r.after === 0 && r.before === 0, '감속 모드에서는 캔버스 파티클(장식)을 만들지 않는다', r);
  ok(r.stats.pushed === r.stats.dispatched, '감속 모드에서도 사건 유실이 없다', r.stats);
  var fighting = r.phase !== 'advance';
  ok(fighting ? r.enemyDisp !== 'none' : true,
    '감속 모드에서도 적은 화면에 남는다 (움직임만 줄고 정보는 유지)', r);
  ok(fighting ? /%/.test(r.hpW) : true, '감속 모드에서도 HP 가 갱신된다', r);

  // ── 단계 1 — 감속 모드의 정보/장식 이원화 ──
  /* 정보 FX 는 "사라지는 것"도 "그대로 움직이는 것"도 실패다 (체크리스트).
   * 남되, 속도·성장 없이 페이드만 한다. 정지 연출(히트스톱)도 걸지 않는다. */
  var r2 = JSON.parse(await pg.eval(J(
    '(function(){var fx=window.__mallangIdle.Stage.fx;' +
    ' var deco=fx.emit("spark", 30, 30, { vx: 50, life: 5 });' +
    ' var info=fx.emit("gold", 40, 40, { info: true, vx: 50, life: 5 });' +
    ' var n0=fx.particleCount(); var s0=fx.snapshot()[0];' +
    ' fx.stepDraw(0.1);' +
    ' var s1=fx.snapshot()[0];' +
    ' fx.forceHitstop(0.1); var hsRem=fx.hitstopRemaining();' +
    ' fx.stepDraw(10);' +
    ' return { decoRejected: deco===undefined, n0:n0,' +
    '          still: !!(s0 && s1 && s0.x===s1.x), aged: !!(s1 && s1.age>s0.age),' +
    '          hsRem:hsRem, cleaned: fx.particleCount() };})()')));
  ok(r2.decoRejected && r2.n0 === 1, '감속 모드 — 장식은 0, 정보 파티클은 남는다', r2);
  ok(r2.still && r2.aged, '감속 모드 — 정보 파티클은 움직이지 않고 페이드만 한다', r2);
  ok(r2.hsRem === 0, '감속 모드 — 히트스톱(정지 연출)을 걸지 않는다', r2);
  ok(r2.cleaned === 0, '감속 모드 — 정보 파티클도 수명이 다하면 정리된다', r2);
}

/* DPR 2 — 백킹 해상도만 배가되고 좌표 수학(CSS px)은 그대로여야 한다. */
async function dpr2(pg) {
  await boot(pg);
  await pg.sleep(400);
  var d = JSON.parse(await pg.eval(J(
    '(function(){var H=window.__mallangIdle;' +
    ' for (var i=0;i<40 && H.state.phase==="advance";i++) H.advance(3);' +
    ' var c=document.getElementById("fxCanvas");var r=c.getBoundingClientRect();' +
    ' var er=document.getElementById("enemyArt").getBoundingClientRect();' +
    ' var p=H.Stage.fx.enemyPoint();' +
    ' return { dpr:window.devicePixelRatio, w:c.width, cssW:Math.round(r.width),' +
    '   dx: Math.abs(p.x-(er.left+er.width*0.5-r.left)),' +
    '   dy: Math.abs(p.y-(er.top+er.height*0.55-r.top)) };})()')));
  ok(d.dpr === 2, 'DPR 2 로 기동됐다 (--force-device-scale-factor=2)', d);
  ok(Math.abs(d.w - d.cssW * 2) <= 2, 'DPR 2 — 캔버스 백킹이 CSS 의 2배다', d);
  ok(d.dx < 2 && d.dy < 2, 'DPR 2 에서도 세계좌표가 접점과 일치한다', d);
}

H.withPage('/games/mallang-idle/index.html?dev=1', main).then(function () {
  return H.withPage('/games/mallang-idle/index.html?dev=1', reduced,
    { args: ['--force-prefers-reduced-motion'] });
}).then(function () {
  return H.withPage('/games/mallang-idle/index.html?dev=1', dpr2,
    { args: ['--force-device-scale-factor=2'] });
}).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) {
  console.log('  FAIL (harness) ' + e.message);
  console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
