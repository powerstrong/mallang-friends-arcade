/* 실험실 솔로 상대(봇) 테스트. 봇은 viewFor 로 가려진 뷰만 보고 판단해야 하므로,
 * "원본 state 를 주지 않아도 항상 합법 액션을 낸다"가 핵심 검증이다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PHASE, ACTION, createGame, applyAction, viewFor, legalActions, evaluateHand, compareHands,
} from '../../games/choice-holdem/engine/choice-holdem.js';
import { decide, winProbability } from '../../games/choice-holdem/engine/bot.js';

const A = 'p1';
const B = 'p2';

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function actorFor(state) {
  if (state.phase === PHASE.WAITING || state.phase === PHASE.SETTLEMENT) return state.playerOrder[0];
  if (state.phase === PHASE.CHOICE_REVEAL) return state.firstPlayerId;
  if (state.phase === PHASE.CHOICE_SELECT) return state.secondPlayerId;
  if (state.street) return state.street.turn;
  return null;
}

test('봇 대 봇 50판 — 언제나 합법 액션을 내고 게임이 끝난다', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rand = lcg(seed * 2654435761);
    let s = createGame({ players: [{ id: A }, { id: B }], seed });
    let steps = 0;
    while (s.phase !== PHASE.GAME_OVER) {
      const actor = actorFor(s);
      if (s.phase === PHASE.WAITING || s.phase === PHASE.SETTLEMENT) {
        s = applyAction(s, { type: s.phase === PHASE.WAITING ? ACTION.START : ACTION.NEXT_ROUND, playerId: actor }).state;
        continue;
      }
      const action = decide(viewFor(s, actor), rand);
      assert.ok(action, `seed ${seed}: 봇이 액션을 내지 못했다 (${s.phase})`);
      const res = applyAction(s, { ...action, playerId: actor });
      assert.equal(res.error, null, `seed ${seed}: 봇이 불법 액션 ${JSON.stringify(action)} → ${JSON.stringify(res.error)}`);
      s = res.state;
      const total = s.players[A].chips + s.players[B].chips
        + s.pot + (s.street ? s.street.bets[A] + s.street.bets[B] : 0) + s.carryPot;
      assert.equal(total, 40, `seed ${seed}: 칩 총량 ${total}`);
      assert.ok(++steps < 5000, `seed ${seed}: 게임이 끝나지 않는다`);
    }
  }
});

test('승률 계산 — 확정 5장끼리는 실제 족보 비교와 방향이 같다', () => {
  // 공용 5·5·4 / 나 5·3(트리플) → 상대가 어떤 두 장을 받아도 이기기 어려운 자리
  const state = createGame({
    players: [{ id: A }, { id: B }],
    seed: 5,
    stackedDecks: [[5, 5, 4, 5, 1, 3, 2]],
  });
  let s = applyAction(state, { type: ACTION.START }).state;
  s = applyAction(s, { type: ACTION.CHECK, playerId: A }).state;
  s = applyAction(s, { type: ACTION.CHECK, playerId: B }).state;
  s = applyAction(s, { type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] }).state;
  s = applyAction(s, { type: ACTION.SELECT, playerId: B, cardId: s.choice.cardIds[0] }).state;

  const strong = winProbability(viewFor(s, A)); // 5·5·4·5·2 = 트리플
  const weak = winProbability(viewFor(s, B));   // 5·5·4·1·3 = 원페어
  assert.ok(strong > 0.8, `강한 패 승률이 낮다: ${strong}`);
  assert.ok(weak < 0.5, `약한 패 승률이 높다: ${weak}`);
  assert.equal(
    compareHands(
      evaluateHand(s.community.concat(s.players[A].hole)),
      evaluateHand(s.community.concat(s.players[B].hole))
    ),
    1
  );
});

test('봇은 뷰에 없는 정보를 요구하지 않는다 — 뷰만으로 모든 단계 판단', () => {
  const rand = lcg(7);
  let s = createGame({ players: [{ id: A }, { id: B }], seed: 31 });
  s = applyAction(s, { type: ACTION.START }).state;
  const phasesSeen = new Set();
  let steps = 0;
  while (s.phase !== PHASE.GAME_OVER && steps++ < 2000) {
    const actor = actorFor(s);
    if (s.phase === PHASE.SETTLEMENT) {
      s = applyAction(s, { type: ACTION.NEXT_ROUND, playerId: actor }).state;
      continue;
    }
    phasesSeen.add(s.phase);
    const view = viewFor(s, actor);
    // 뷰를 JSON 왕복시켜 "네트워크로 받은 것"과 동일한 입력만 쓰게 만든다.
    const action = decide(JSON.parse(JSON.stringify(view)), rand);
    const res = applyAction(s, { ...action, playerId: actor });
    assert.equal(res.error, null, `${s.phase}: ${JSON.stringify(res.error)}`);
    assert.ok(legalActions(s, actor).some((a) => a.type === action.type));
    s = res.state;
  }
  for (const phase of [PHASE.BETTING_1, PHASE.CHOICE_REVEAL, PHASE.CHOICE_SELECT]) {
    assert.ok(phasesSeen.has(phase), `${phase} 단계를 한 번도 거치지 않았다`);
  }
});

/* 같은 카드가 hole 과 choice.cards 양쪽에 있어 남은 덱에서 두 번 빠지면 승률이 틀어진다.
 * 뷰에 보이는 카드를 id 로 세어 얻은 "정확한 남은 덱"과 봇 계산이 일치해야 한다. */
test('Choice 가 끝난 뒤에도 봇의 승률은 카드 id 기준 남은 덱과 일치한다', () => {
  let s = createGame({ players: [{ id: A }, { id: B }], seed: 3, stackedDecks: [[5, 5, 4, 5, 1, 3, 2]] });
  const step = (action) => {
    const res = applyAction(s, action);
    assert.equal(res.error, null, `거부됨: ${JSON.stringify(action)} → ${JSON.stringify(res.error)}`);
    s = res.state;
  };
  step({ type: ACTION.START });
  step({ type: ACTION.CHECK, playerId: A });
  step({ type: ACTION.CHECK, playerId: B });
  step({ type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] });
  step({ type: ACTION.SELECT, playerId: B, cardId: s.choice.cardIds[0] });

  const view = viewFor(s, A);
  // A 는 [5,5,4] + 5 + 2 = 포카드는 아니고 트리플 5. 남은 미지수는 상대의 뒷면 1장뿐이다.
  const seen = new Map();
  for (const card of view.community) seen.set(card.id, card.rank);
  for (const card of view.you.hole) seen.set(card.id, card.rank);
  for (const card of view.opponent.hole) if (card.rank != null) seen.set(card.id, card.rank);
  for (const card of view.choice.cards) if (card.rank != null) seen.set(card.id, card.rank);
  const remaining = new Array(6).fill(4);
  remaining[0] = 0;
  for (const rank of seen.values()) remaining[rank] -= 1;
  const deckLeft = remaining.reduce((a, b) => a + b, 0);
  assert.equal(deckLeft, 20 - seen.size, '전제: 뷰에 보이는 카드는 6장(중복 제거 기준)');

  // 상대의 마지막 한 장만 남은 덱에서 뽑는다 — 각 숫자가 나올 확률로 직접 계산한 값.
  let expected = 0;
  const mine = evaluateHand(view.community.concat(view.you.hole).map((c) => ({ rank: c.rank })));
  const theirKnown = view.opponent.hole.filter((c) => c.rank != null).map((c) => c.rank);
  for (let rank = 1; rank <= 5; rank++) {
    if (!remaining[rank]) continue;
    const theirs = evaluateHand(
      view.community.map((c) => ({ rank: c.rank })).concat(theirKnown.map((r) => ({ rank: r })), [{ rank }])
    );
    const cmp = compareHands(mine, theirs);
    expected += (remaining[rank] / deckLeft) * (cmp > 0 ? 1 : cmp === 0 ? 0.45 : 0);
  }
  assert.ok(
    Math.abs(winProbability(view) - expected) < 1e-9,
    `봇 승률 ${winProbability(view)} ≠ 정확값 ${expected} — Choice 카드를 두 번 빼고 있다`
  );
});
