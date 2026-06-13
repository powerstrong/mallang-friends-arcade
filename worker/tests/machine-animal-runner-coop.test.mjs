/* 말랑프렌즈 러너 협동 모듈 — 서버 권위 로직 단위 테스트.
 * GameRoom DO 없이 모듈 인터페이스(ctx/ws 모킹)만으로 검증한다:
 * 좌석 배정, 시작, 하이파이브 1회성, DPS 클램프, 새장 중복 소비 차단, 전멸 패배. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { machineAnimalRunnerCoop as mod } from '../src/games/machine_animal_runner.js';

function makeCtx() {
  const sent = [];      // [ws, msg]
  const broadcasts = [];
  const ctx = {
    gameId: 'machine-animal-runner',
    state: {},
    storage: null,
    sessions: () => [],
    roster: () => [],
    broadcast: (m) => broadcasts.push(m),
    sendTo: (ws, m) => sent.push([ws, m]),
  };
  return { ctx, sent, broadcasts };
}

function makeWs(id, name) {
  return { deserializeAttachment: () => ({ id, name }) };
}

async function joinTwo(ctx) {
  const wsA = makeWs('p1', 'A'), wsB = makeWs('p2', 'B');
  await mod.onJoin(ctx, wsA, {});
  await mod.onJoin(ctx, wsB, {});
  return { wsA, wsB };
}

async function startRun(ctx, wsA, wsB) {
  await mod.onMessage(ctx, wsA, { a: 'ready' });
  await mod.onMessage(ctx, wsB, { a: 'ready' });
}

test('좌석 배정: L → R, 3번째는 full 거절', async () => {
  const { ctx, sent } = makeCtx();
  const { } = await joinTwo(ctx);
  assert.equal(ctx.state.players.p1.seat, 'L');
  assert.equal(ctx.state.players.p2.seat, 'R');
  const wsC = makeWs('p3', 'C');
  await mod.onJoin(ctx, wsC, {});
  const fullMsg = sent.filter(([ws, m]) => ws === wsC && m.event === 'full');
  assert.equal(fullMsg.length, 1);
  assert.equal(ctx.state.players.p3, undefined);
});

test('둘 다 ready 면 start 브로드캐스트 + run phase', async () => {
  const { ctx, broadcasts } = makeCtx();
  const { wsA, wsB } = await joinTwo(ctx);
  await startRun(ctx, wsA, wsB);
  assert.equal(ctx.state.phase, 'run');
  assert.ok(broadcasts.some((m) => m.event === 'start' && m.stage === 1));
});

test('하이파이브: 같은 seq 윈도 내 통과 시 1회만', async () => {
  const { ctx, broadcasts } = makeCtx();
  const { wsA, wsB } = await joinTwo(ctx);
  await startRun(ctx, wsA, wsB);
  await mod.onMessage(ctx, wsA, { a: 'gate', seq: 1, amount: 10, power: 2 });
  await mod.onMessage(ctx, wsB, { a: 'gate', seq: 1, amount: 7, power: 1 });
  // 같은 seq 재보고(중복 보상 시도)
  await mod.onMessage(ctx, wsA, { a: 'gate', seq: 1, amount: 10, power: 2 });
  const hf = broadcasts.filter((m) => m.event === 'highfive');
  assert.equal(hf.length, 1);
  assert.equal(hf[0].seq, 1);
});

test('DPS 클램프: 위조 amount/power/dt 가 스테이지 상한으로 깎인다', async () => {
  const { ctx } = makeCtx();
  const { wsA, wsB } = await joinTwo(ctx);
  await startRun(ctx, wsA, wsB);
  // 보스 진입(시간 검증 우회: startTs 를 과거로)
  ctx.state.startTs = Date.now() - 80_000;
  await mod.onMessage(ctx, wsA, { a: 'boss_enter', elapsed: 80_000 });
  assert.equal(ctx.state.phase, 'boss');
  const before = ctx.state.bossHp;
  // 위조 시도: amount 99999, power 99, dt 10 → min(999,12)? amount 클램프 999 → 사수 12,
  // power 는 stage1 maxPower 10, dt 0.3 으로 클램프
  await mod.onMessage(ctx, wsA, { a: 'dps', amount: 99999, power: 99, dt: 10 });
  const dealt = before - ctx.state.bossHp;
  // 인정값 기준: 게이트를 안 지났으므로 amount 5 / power 1 이 상한 (codex P0 수정)
  const maxPerReport = 5 * 1 * 7 * 1.2 * 0.3; // = 12.6
  assert.ok(dealt <= maxPerReport + 1e-9, `dealt=${dealt} > clamp=${maxPerReport}`);
  assert.ok(dealt > 0);
});

test('새장: 한 명 전멸 → cage 드랍, 구출은 1회만 인정', async () => {
  const { ctx, broadcasts } = makeCtx();
  const { wsA, wsB } = await joinTwo(ctx);
  await startRun(ctx, wsA, wsB);
  await mod.onMessage(ctx, wsA, { a: 'wipe', x: 0.4 });
  assert.equal(ctx.state.players.p1.alive, false);
  assert.ok(broadcasts.some((m) => m.event === 'cage' && m.seat === 'L'));
  await mod.onMessage(ctx, wsB, { a: 'cage_hit' });
  assert.equal(ctx.state.players.p1.alive, true);
  assert.equal(ctx.state.players.p1.amount, 8);
  const revives = broadcasts.filter((m) => m.event === 'revive');
  assert.equal(revives.length, 1);
  // 소비된 새장 재사용 시도 → 무시
  await mod.onMessage(ctx, wsB, { a: 'cage_hit' });
  assert.equal(broadcasts.filter((m) => m.event === 'revive').length, 1);
});

test('둘 다 전멸하면 lose', async () => {
  const { ctx, broadcasts } = makeCtx();
  const { wsA, wsB } = await joinTwo(ctx);
  await startRun(ctx, wsA, wsB);
  await mod.onMessage(ctx, wsA, { a: 'wipe', x: 0.5 });
  await mod.onMessage(ctx, wsB, { a: 'wipe', x: 0.5 });
  assert.equal(ctx.state.phase, 'lose');
  assert.ok(broadcasts.some((m) => m.event === 'lose'));
});

test('보스 HP 0 → win', async () => {
  const { ctx, broadcasts } = makeCtx();
  const { wsA, wsB } = await joinTwo(ctx);
  await startRun(ctx, wsA, wsB);
  ctx.state.startTs = Date.now() - 80_000;
  await mod.onMessage(ctx, wsA, { a: 'boss_enter' });
  ctx.state.bossHp = 10; // 막타 직전
  await mod.onMessage(ctx, wsB, { a: 'dps', amount: 12, power: 5, dt: 0.3 });
  assert.equal(ctx.state.phase, 'win');
  assert.ok(broadcasts.some((m) => m.event === 'win'));
});

test('이른 boss_enter 보고는 무시(위조 방지)', async () => {
  const { ctx } = makeCtx();
  const { wsA, wsB } = await joinTwo(ctx);
  await startRun(ctx, wsA, wsB);
  await mod.onMessage(ctx, wsA, { a: 'boss_enter' }); // 방금 시작 — bossAt 도달 불가
  assert.equal(ctx.state.phase, 'run');
});

test('상태 소실(하이버네이션) 시 reset 응답', async () => {
  const { ctx, sent } = makeCtx();
  const ws = makeWs('p1', 'A');
  // join 없이 메시지(상태 없음 시뮬레이션)
  await mod.onMessage(ctx, ws, { a: 'gate', seq: 1 });
  assert.ok(sent.some(([w, m]) => w === ws && m.event === 'reset'));
});

test('게이트 재보고(같은 seq)는 무시 — 에코 루프/리플레이 차단', async () => {
  const { ctx, broadcasts } = makeCtx();
  const { wsA } = await joinTwo(ctx);
  await startRun(ctx, makeWs('p1', 'A'), makeWs('p2', 'B'));
  await mod.onMessage(ctx, wsA, { a: 'gate', seq: 1, amount: 10, power: 2 });
  const before = broadcasts.filter((m) => m.event === 'gate').length;
  await mod.onMessage(ctx, wsA, { a: 'gate', seq: 1, amount: 50, power: 9 });
  assert.equal(broadcasts.filter((m) => m.event === 'gate').length, before);
  assert.equal(ctx.state.players.p1.amount, 10); // 재보고 값 미반영
});

test('full 거절된 ws 는 자가치유로 좌석을 받지 못한다', async () => {
  const { ctx, sent } = makeCtx();
  await joinTwo(ctx);
  const wsC = makeWs('p3', 'C');
  await mod.onJoin(ctx, wsC, {});                    // full 거절
  await mod.onLeave(ctx, { id: 'p2' });              // 자리 1개 비움(로비)
  await mod.onMessage(ctx, wsC, { a: 'ready' });     // 거절자 메시지 → 좌석 없음
  assert.equal(ctx.state.players.p3, undefined);
  assert.ok(sent.some(([w, m]) => w === wsC && m.event === 'full'));
});

test('새장 대기 중 파트너 이탈 → lose (영구 대기 방지)', async () => {
  const { ctx, broadcasts } = makeCtx();
  const { wsA } = await joinTwo(ctx);
  await startRun(ctx, makeWs('p1', 'A'), makeWs('p2', 'B'));
  await mod.onMessage(ctx, wsA, { a: 'wipe', x: 0.5 }); // p1 새장행
  await mod.onLeave(ctx, { id: 'p2' });                  // 구출자 이탈
  assert.equal(ctx.state.phase, 'lose');
  assert.ok(broadcasts.some((m) => m.event === 'lose'));
});

test('전원 이탈 시 in-memory 상태도 정리 — 같은 DO 재사용 가능', async () => {
  const { ctx } = makeCtx();
  await joinTwo(ctx);
  await startRun(ctx, makeWs('p1', 'A'), makeWs('p2', 'B'));
  await mod.onLeave(ctx, { id: 'p1' });
  await mod.onLeave(ctx, { id: 'p2' });
  assert.equal(ctx.state.phase, undefined);
  const wsN = makeWs('p9', 'N');
  await mod.onJoin(ctx, wsN, {});
  assert.equal(ctx.state.players.p9.seat, 'L'); // 새 로비로 재사용
});

test('하이파이브 보너스가 서버 인정값에도 반영된다', async () => {
  const { ctx } = makeCtx();
  const { wsA, wsB } = await joinTwo(ctx);
  await startRun(ctx, wsA, wsB);
  await mod.onMessage(ctx, wsA, { a: 'gate', seq: 1, amount: 20, power: 2 });
  await mod.onMessage(ctx, wsB, { a: 'gate', seq: 1, amount: 10, power: 1 });
  // +15%(최소 +2): 20→23, 10→12 (하이파이브 시점 인정값)
  assert.equal(ctx.state.players.p1.amount, 23);
  assert.equal(ctx.state.players.p2.amount, 12);
});
