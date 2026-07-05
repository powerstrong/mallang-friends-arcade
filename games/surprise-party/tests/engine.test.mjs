/* engine.test.mjs — rush-engine 순수 코어 Node 검증
 * 실행: node games/surprise-party/tests/engine.test.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

require('../rush-engine.js'); // globalThis.SurpriseRushEngine 등록
const Engine = globalThis.SurpriseRushEngine;

const CATALOG = [
  { id: 'a', baseMs: 3000 }, { id: 'b', baseMs: 3400 }, { id: 'c', baseMs: 4200 },
  { id: 'd', baseMs: 3800 }, { id: 'e', baseMs: 3600 },
];

function sequenceOf(seed, rounds, failPlan) {
  const e = Engine.create({ seedString: seed, catalog: CATALOG });
  const seq = [];
  for (let i = 0; i < rounds; i++) {
    const r = e.nextRound();
    seq.push(r.gameId + ':' + r.roundSeed);
    e.reportResult(!(failPlan && failPlan.has(i)));
  }
  return seq;
}

// 1. 같은 시드 = 같은 순서 (성패 무관 — 멀티 공정성 계약)
{
  const s1 = sequenceOf('ROOM1', 60);
  const s2 = sequenceOf('ROOM1', 60, new Set([0, 3, 7, 20, 40])); // 실패 섞어도
  assert.deepEqual(s1, s2, '성패가 미션 순서를 바꾸면 안 됨');
  const s3 = sequenceOf('ROOM2', 60);
  assert.notDeepEqual(s1, s3, '다른 시드는 다른 순서여야 함');
  console.log('✅ 시드 결정성 + 성패 독립');
}

// 2. 직전 미션 즉시 반복 금지
{
  const e = Engine.create({ seedString: 'NOREPEAT', catalog: CATALOG });
  let prev = null;
  for (let i = 0; i < 200; i++) {
    const r = e.nextRound();
    assert.notEqual(r.gameId, prev, '즉시 반복 발견 (round ' + r.round + ')');
    prev = r.gameId;
    e.reportResult(true);
  }
  console.log('✅ 즉시 반복 금지 (200라운드)');
}

// 3. 속도 곡선: 단조 증가, 4라운드 주기, 2.0 캡, speedUp 플래그
{
  assert.equal(Engine.speedForRound(1), 1);
  assert.equal(Engine.speedForRound(4), 1);
  assert.equal(Engine.speedForRound(5), 1.15);
  assert.equal(Engine.speedForRound(9), 1.3);
  assert.equal(Engine.speedForRound(100), 2.0);
  const e = Engine.create({ seedString: 'SPD', catalog: CATALOG });
  let prevSpeed = 0;
  for (let i = 0; i < 40; i++) {
    const r = e.nextRound();
    assert.ok(r.speed >= prevSpeed, '속도 역행');
    assert.equal(r.speedUp, r.round > 1 && (r.round - 1) % 4 === 0, 'speedUp 플래그 오류');
    assert.ok(r.durationMs >= 1200, '최소 제한시간 위반');
    prevSpeed = r.speed;
    e.reportResult(true);
  }
  console.log('✅ 속도 곡선 + speedUp + 최소시간');
}

// 4. 목숨/콤보/점수/사망
{
  const e = Engine.create({ seedString: 'LIFE', catalog: CATALOG });
  e.nextRound();
  let r = e.reportResult(true);
  assert.equal(r.gained, 100); assert.equal(r.combo, 1);
  e.nextRound();
  r = e.reportResult(true);
  assert.equal(r.gained, 125); assert.equal(r.combo, 2); assert.equal(r.score, 225);
  e.nextRound();
  r = e.reportResult(false);
  assert.equal(r.combo, 0); assert.equal(r.lives, 2); assert.equal(r.dead, false);
  e.nextRound(); e.reportResult(false);
  e.nextRound();
  r = e.reportResult(false);
  assert.equal(r.lives, 0); assert.equal(r.dead, true);
  assert.equal(e.getState().bestCombo, 2);
  console.log('✅ 목숨 3 → 사망, 콤보 점수 (100/+25), bestCombo');
}

console.log('\n전체 통과 🎉');
