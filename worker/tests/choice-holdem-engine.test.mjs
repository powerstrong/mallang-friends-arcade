/* 엔진 본체는 games/choice-holdem/engine/choice-holdem.js 에 있다(브라우저가 그대로 import 하는
 * 파일). 규칙은 CI 게이트를 받아야 하므로 테스트는 worker 스위트에 둔다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PHASE,
  ACTION,
  HAND,
  DECK_SIZE,
  createGame,
  applyAction,
  legalActions,
  evaluateHand,
  compareHands,
  baseBetFor,
  finalCards,
  viewFor,
  potTotal,
} from '../../games/choice-holdem/engine/choice-holdem.js';

const A = 'alice';
const B = 'bob';

// 스택드 덱 순서: [공용3, 선플레이어 개인1, 후플레이어 개인1, Choice2]
function game(stackedDecks, opts = {}) {
  return createGame({
    players: [{ id: A, name: 'Alice' }, { id: B, name: 'Bob' }],
    seed: 12345,
    stackedDecks,
    ...opts,
  });
}

/* 액션들을 차례로 적용한다. 거부되면 즉시 실패시켜 테스트가 조용히 통과하지 않게 한다. */
function play(state, actions) {
  let s = state;
  for (const action of actions) {
    const res = applyAction(s, action);
    assert.equal(res.error, null, `거부됨: ${JSON.stringify(action)} → ${JSON.stringify(res.error)}`);
    s = res.state;
  }
  return s;
}

function ranksOf(cards) {
  return cards.map((c) => c.rank);
}

// ── 족보 판정 (명세 21~27) ──────────────────────────────────────────────────

test('포카드 — 같은 숫자 4장, 높은 쪽이 이긴다', () => {
  const strong = evaluateHand([5, 5, 5, 5, 2].map((rank) => ({ id: `x${rank}`, rank })));
  const weak = evaluateHand([4, 4, 4, 4, 5].map((rank) => ({ id: `y${rank}`, rank })));
  assert.equal(strong.rank, HAND.FOUR_OF_A_KIND);
  assert.equal(weak.rank, HAND.FOUR_OF_A_KIND);
  assert.equal(compareHands(strong, weak), 1);
});

test('풀하우스 — 트리플 숫자를 먼저 비교한다', () => {
  const strong = evaluateHand([5, 5, 5, 2, 2].map((rank) => ({ rank })));
  const weak = evaluateHand([4, 4, 4, 5, 5].map((rank) => ({ rank })));
  assert.equal(strong.rank, HAND.FULL_HOUSE);
  assert.equal(compareHands(strong, weak), 1);
});

test('스트레이트 — 1·2·3·4·5 하나뿐이며 서로 완전 동점', () => {
  const one = evaluateHand([1, 2, 3, 4, 5].map((rank) => ({ rank })));
  const two = evaluateHand([5, 4, 3, 2, 1].map((rank) => ({ rank })));
  assert.equal(one.rank, HAND.STRAIGHT);
  assert.equal(compareHands(one, two), 0);
});

test('족보 서열 — 포카드 > 풀하우스 > 스트레이트 > 트리플 > 투페어 > 원페어', () => {
  const four = evaluateHand([5, 5, 5, 5, 1].map((rank) => ({ rank })));
  const full = evaluateHand([5, 5, 5, 1, 1].map((rank) => ({ rank })));
  const straight = evaluateHand([1, 2, 3, 4, 5].map((rank) => ({ rank })));
  const triple = evaluateHand([5, 5, 5, 2, 1].map((rank) => ({ rank })));
  const twoPair = evaluateHand([5, 5, 3, 3, 1].map((rank) => ({ rank })));
  const pair = evaluateHand([5, 5, 4, 3, 1].map((rank) => ({ rank })));
  const order = [four, full, straight, triple, twoPair, pair];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(compareHands(order[i], order[i + 1]), 1, `${order[i].name} > ${order[i + 1].name}`);
  }
});

test('투페어 — 높은 페어 → 낮은 페어 → 나머지 순으로 비교', () => {
  const strong = evaluateHand([5, 5, 3, 3, 1].map((rank) => ({ rank })));
  const weak = evaluateHand([4, 4, 3, 3, 5].map((rank) => ({ rank })));
  assert.equal(strong.rank, HAND.TWO_PAIR);
  assert.equal(compareHands(strong, weak), 1);
  const sameePairs = evaluateHand([5, 5, 3, 3, 2].map((rank) => ({ rank })));
  assert.equal(compareHands(sameePairs, strong), 1); // 키커 2 > 1
});

test('원페어 — 페어를 먼저, 같으면 나머지를 높은 순으로 비교', () => {
  const strong = evaluateHand([5, 5, 4, 3, 1].map((rank) => ({ rank })));
  const weak = evaluateHand([4, 4, 5, 3, 2].map((rank) => ({ rank })));
  assert.equal(strong.rank, HAND.ONE_PAIR);
  assert.equal(compareHands(strong, weak), 1);
  const sameKickerFight = evaluateHand([5, 5, 4, 3, 2].map((rank) => ({ rank })));
  assert.equal(compareHands(sameKickerFight, strong), 1); // 4·3·2 vs 4·3·1
});

test('트리플 — 트리플 숫자 우선, 같으면 키커 비교', () => {
  const strong = evaluateHand([5, 5, 5, 2, 1].map((rank) => ({ rank })));
  const weak = evaluateHand([4, 4, 4, 5, 3].map((rank) => ({ rank })));
  assert.equal(strong.rank, HAND.THREE_OF_A_KIND);
  assert.equal(compareHands(strong, weak), 1);
});

test('5장이 아니면 판정하지 않는다', () => {
  assert.throws(() => evaluateHand([1, 2, 3, 4].map((rank) => ({ rank }))), /5장/);
});

// ── 기본 베팅 (명세 6~7) ────────────────────────────────────────────────────

test('기본 베팅은 10라운드마다 1칩씩 오른다', () => {
  assert.equal(baseBetFor(1), 1);
  assert.equal(baseBetFor(10), 1);
  assert.equal(baseBetFor(11), 2);
  assert.equal(baseBetFor(20), 2);
  assert.equal(baseBetFor(21), 3);
  assert.equal(baseBetFor(31), 4);
});

// ── 라운드 시작 (명세 5·8) ──────────────────────────────────────────────────

test('라운드 시작 — 앤티 1칩씩, 공용 3장, 개인 1장, 선플레이어 선액션', () => {
  const s = play(game([[2, 3, 5, 3, 4, 1, 1]]), [{ type: ACTION.START }]);
  assert.equal(s.phase, PHASE.BETTING_1);
  assert.equal(s.round, 1);
  assert.equal(s.players[A].chips, 19);
  assert.equal(s.players[B].chips, 19);
  assert.equal(potTotal(s), 2);
  assert.deepEqual(ranksOf(s.community), [2, 3, 5]);
  assert.equal(s.players[A].hole.length, 1);
  assert.equal(s.players[B].hole.length, 1);
  assert.equal(s.firstPlayerId, A);
  assert.equal(s.street.turn, A, '1차 베팅은 선플레이어가 먼저 액션한다');
});

test('덱은 1~5 각 4장 총 20장으로 구성된다', () => {
  const s = play(game([]), [{ type: ACTION.START }]);
  const dealt = s.community.concat(s.players[A].hole, s.players[B].hole);
  const all = dealt.concat(s.deck);
  assert.equal(all.length, DECK_SIZE);
  for (let rank = 1; rank <= 5; rank++) {
    assert.equal(all.filter((c) => c.rank === rank).length, 4, `숫자 ${rank} 는 4장`);
  }
});

test('같은 seed 는 같은 카드 배분을 만든다(리플레이 가능)', () => {
  const one = play(createGame({ players: [{ id: A }, { id: B }], seed: 777 }), [{ type: ACTION.START }]);
  const two = play(createGame({ players: [{ id: A }, { id: B }], seed: 777 }), [{ type: ACTION.START }]);
  assert.deepEqual(ranksOf(one.community), ranksOf(two.community));
  assert.deepEqual(ranksOf(one.players[A].hole), ranksOf(two.players[A].hole));
});

test('applyAction 은 입력 state 를 변형하지 않는다', () => {
  const before = play(game([[2, 3, 5, 3, 4, 1, 1]]), [{ type: ACTION.START }]);
  const snapshot = JSON.stringify(before);
  applyAction(before, { type: ACTION.BET, playerId: A, amount: 3 });
  assert.equal(JSON.stringify(before), snapshot);
});

// ── Choice 단계 (명세 10~13) ────────────────────────────────────────────────

const CHOICE_DECK = [[2, 3, 5, 3, 4, 5, 2]]; // 공용 2·3·5 / A 3 / B 4 / Choice 5·2

function toChoice(stacked = CHOICE_DECK) {
  return play(game(stacked), [
    { type: ACTION.START },
    { type: ACTION.CHECK, playerId: A },
    { type: ACTION.CHECK, playerId: B },
  ]);
}

test('1차 베팅이 끝나면 Choice 카드 2장이 나오고 선플레이어만 두 장을 본다', () => {
  const s = toChoice();
  assert.equal(s.phase, PHASE.CHOICE_REVEAL);
  const firstView = viewFor(s, A);
  const secondView = viewFor(s, B);
  assert.deepEqual(firstView.choice.cards.map((c) => c.rank), [5, 2]);
  assert.deepEqual(secondView.choice.cards.map((c) => c.rank), [null, null],
    '후플레이어는 공개 전 두 장 모두 볼 수 없다');
});

test('공개는 선플레이어만, 선택은 후플레이어만 할 수 있다', () => {
  const s = toChoice();
  const wrongReveal = applyAction(s, { type: ACTION.REVEAL, playerId: B, cardId: s.choice.cardIds[0] });
  assert.equal(wrongReveal.error.code, 'NOT_FIRST_PLAYER');

  const revealed = play(s, [{ type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] }]);
  assert.equal(revealed.phase, PHASE.CHOICE_SELECT);
  const wrongSelect = applyAction(revealed, { type: ACTION.SELECT, playerId: A, cardId: revealed.choice.cardIds[0] });
  assert.equal(wrongSelect.error.code, 'NOT_SECOND_PLAYER');
});

test('Choice 카드가 아닌 id 는 거부된다', () => {
  const s = toChoice();
  const res = applyAction(s, { type: ACTION.REVEAL, playerId: A, cardId: s.community[0].id });
  assert.equal(res.error.code, 'BAD_CARD');
});

test('공개 후에도 후플레이어는 뒷면 카드의 숫자를 받지 못한다', () => {
  const s = toChoice();
  const revealed = play(s, [{ type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] }]);
  const view = viewFor(revealed, B);
  const faceUp = view.choice.cards.find((c) => c.faceUp);
  const faceDown = view.choice.cards.find((c) => !c.faceUp);
  assert.equal(faceUp.rank, 5, '공개된 카드는 후플레이어도 본다');
  assert.equal(faceDown.rank, null, '뒷면 카드 숫자는 후플레이어에게 전송되지 않는다');
  assert.equal(view.choice.cards.length, 2);
});

test('후플레이어가 뒷면을 고르면 그 카드는 후플레이어, 공개 카드는 선플레이어에게 간다', () => {
  const s = toChoice();
  const revealed = play(s, [{ type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] }]); // 5 공개
  const hiddenId = revealed.choice.hiddenCardId;
  const done = play(revealed, [{ type: ACTION.SELECT, playerId: B, cardId: hiddenId }]);
  assert.deepEqual(ranksOf(done.players[B].hole), [4, 2], '후플레이어는 숨겨진 2를 가져간다');
  assert.deepEqual(ranksOf(done.players[A].hole), [3, 5], '남은 공개 카드 5는 선플레이어에게 귀속된다');
});

test('후플레이어가 공개 카드를 고르면 선플레이어는 숨긴 카드를 갖고, 그 숫자는 상대에게 비공개', () => {
  const s = toChoice();
  const revealed = play(s, [{ type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] }]); // 5 공개
  const done = play(revealed, [{ type: ACTION.SELECT, playerId: B, cardId: revealed.choice.revealedCardId }]);
  assert.deepEqual(ranksOf(done.players[B].hole), [4, 5]);
  assert.deepEqual(ranksOf(done.players[A].hole), [3, 2]);
  const secondView = viewFor(done, B);
  assert.deepEqual(secondView.opponent.hole.map((c) => c.rank), [null, null],
    '선플레이어의 두 장 모두 후플레이어에게는 숫자가 가려진다');
});

test('Choice 가 끝나면 양쪽 모두 최종 5장을 갖는다', () => {
  const s = toChoice();
  const revealed = play(s, [{ type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] }]);
  const done = play(revealed, [{ type: ACTION.SELECT, playerId: B, cardId: revealed.choice.hiddenCardId }]);
  assert.equal(finalCards(done, A).length, 5);
  assert.equal(finalCards(done, B).length, 5);
  assert.equal(done.phase, PHASE.BETTING_2);
  assert.equal(done.street.turn, A, '2차 베팅도 선플레이어가 먼저 액션한다');
});

test('뷰에는 덱이 절대 포함되지 않는다', () => {
  const s = toChoice();
  for (const viewer of [A, B]) {
    const view = viewFor(s, viewer);
    assert.equal(view.deck, undefined);
    assert.equal(JSON.stringify(view).includes('"deck"'), false);
  }
});

// ── 베팅 (명세 15~19) ───────────────────────────────────────────────────────

test('레이즈는 한 베팅 단계에서 1회만 허용된다', () => {
  const s = play(game([[2, 3, 5, 3, 4, 5, 2]]), [
    { type: ACTION.START },
    { type: ACTION.BET, playerId: A, amount: 3 },
    { type: ACTION.RAISE, playerId: B, amount: 7 },
  ]);
  const reraise = applyAction(s, { type: ACTION.RAISE, playerId: A, amount: 12 });
  assert.equal(reraise.error.code, 'RAISE_LIMIT');
  assert.equal(legalActions(s, A).some((a) => a.type === ACTION.RAISE), false);
  assert.equal(legalActions(s, A).some((a) => a.type === ACTION.CALL), true);

  const called = play(s, [{ type: ACTION.CALL, playerId: A }]);
  assert.equal(called.phase, PHASE.CHOICE_REVEAL);
  assert.equal(potTotal(called), 16); // 앤티 2 + 7 + 7
  assert.equal(called.players[A].chips, 12);
  assert.equal(called.players[B].chips, 12);
});

test('차례가 아닌 플레이어의 액션은 거부된다', () => {
  const s = play(game([[2, 3, 5, 3, 4, 5, 2]]), [{ type: ACTION.START }]);
  const res = applyAction(s, { type: ACTION.CHECK, playerId: B });
  assert.equal(res.error.code, 'NOT_YOUR_TURN');
});

test('보유 칩을 넘는 베팅은 거부된다', () => {
  const s = play(game([[2, 3, 5, 3, 4, 5, 2]]), [{ type: ACTION.START }]);
  const res = applyAction(s, { type: ACTION.BET, playerId: A, amount: 20 });
  assert.equal(res.error.code, 'NOT_ENOUGH_CHIPS');
});

test('콜할 금액이 없으면 CALL 은 거부되고, 있으면 CHECK 이 거부된다', () => {
  const s = play(game([[2, 3, 5, 3, 4, 5, 2]]), [{ type: ACTION.START }]);
  assert.equal(applyAction(s, { type: ACTION.CALL, playerId: A }).error.code, 'NOTHING_TO_CALL');
  const bet = play(s, [{ type: ACTION.BET, playerId: A, amount: 2 }]);
  assert.equal(applyAction(bet, { type: ACTION.CHECK, playerId: B }).error.code, 'CANNOT_CHECK');
});

test('폴드하면 즉시 라운드가 끝나고 상대가 팟을 가져간다 — 카드는 공개하지 않는다', () => {
  const s = play(game([[2, 3, 5, 3, 4, 5, 2]]), [
    { type: ACTION.START },
    { type: ACTION.BET, playerId: A, amount: 4 },
    { type: ACTION.FOLD, playerId: B },
  ]);
  assert.equal(s.phase, PHASE.SETTLEMENT);
  assert.equal(s.lastResult.reason, 'FOLD');
  assert.equal(s.lastResult.winnerId, A);
  assert.equal(s.players[A].chips, 21); // 20 - 1(앤티) + 2(팟)
  assert.equal(s.players[B].chips, 19);
  assert.equal(s.choice, null, '폴드하면 Choice 단계로 가지 않는다');
  assert.equal(viewFor(s, A).opponent.hole[0].rank, null, '폴드한 쪽의 개인 카드는 공개되지 않는다');
});

test('콜되지 않은 초과 베팅은 되돌려준다', () => {
  const s = play(game([[2, 3, 5, 3, 4, 5, 2]]), [
    { type: ACTION.START },
    { type: ACTION.BET, playerId: A, amount: 9 },
    { type: ACTION.FOLD, playerId: B },
  ]);
  assert.equal(s.players[A].chips, 21, '베팅 9는 콜되지 않아 반환되고 앤티 2칩만 가져간다');
});

// ── Showdown · 정산 (명세 20·28·32) ─────────────────────────────────────────

/* 공용 5·5·4 / A 5 / B 1 / Choice 2·3 → A 트리플, B 원페어 */
const SHOWDOWN_DECK = [[5, 5, 4, 5, 1, 2, 3]];

test('쇼다운 — 정확히 5장으로 승부를 가리고 팟을 지급한다', () => {
  const s = play(game(SHOWDOWN_DECK), [
    { type: ACTION.START },
    { type: ACTION.CHECK, playerId: A },
    { type: ACTION.CHECK, playerId: B },
  ]);
  const done = play(s, [
    { type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] },   // 2 공개
    { type: ACTION.SELECT, playerId: B, cardId: s.choice.cardIds[0] },   // B 가 2 선택 → A 는 3
    { type: ACTION.CHECK, playerId: A },
    { type: ACTION.CHECK, playerId: B },
  ]);
  assert.equal(done.phase, PHASE.SETTLEMENT);
  assert.equal(done.lastResult.reason, 'SHOWDOWN');
  assert.equal(done.lastResult.winnerId, A);
  assert.equal(done.lastResult.hands[A].rank, HAND.THREE_OF_A_KIND);
  assert.equal(done.lastResult.hands[B].rank, HAND.ONE_PAIR);
  assert.equal(done.players[A].chips, 21);
  assert.equal(done.players[B].chips, 19);
  assert.equal(viewFor(done, B).opponent.hole.every((c) => c.rank !== null), true,
    '쇼다운에서는 양쪽 개인 카드가 공개된다');
});

test('완전 동점이면 팟을 나누지 않고 다음 라운드로 이월한다', () => {
  // 공용 1·1·1 / A 2 / B 2 / Choice 3·3 → 양쪽 모두 1·1·1·2·3
  const s = play(game([[1, 1, 1, 2, 2, 3, 3], [5, 4, 3, 2, 1, 5, 4]]), [
    { type: ACTION.START },
    { type: ACTION.CHECK, playerId: A },
    { type: ACTION.CHECK, playerId: B },
  ]);
  const done = play(s, [
    { type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] },
    { type: ACTION.SELECT, playerId: B, cardId: s.choice.cardIds[0] },
    { type: ACTION.CHECK, playerId: A },
    { type: ACTION.CHECK, playerId: B },
  ]);
  assert.equal(done.lastResult.winnerId, null);
  assert.equal(done.carryPot, 2);
  assert.equal(done.players[A].chips, 19);
  assert.equal(done.players[B].chips, 19);

  const next = play(done, [{ type: ACTION.NEXT_ROUND }]);
  assert.equal(next.round, 2);
  assert.equal(potTotal(next), 4, '이월 2 + 이번 라운드 앤티 2');
  assert.equal(next.carryPot, 0);
});

test('선플레이어는 라운드마다 교대한다', () => {
  const s = play(game([[5, 5, 4, 5, 1, 2, 3], [5, 5, 4, 5, 1, 2, 3]]), [
    { type: ACTION.START },
    { type: ACTION.BET, playerId: A, amount: 1 },
    { type: ACTION.FOLD, playerId: B },
    { type: ACTION.NEXT_ROUND },
  ]);
  assert.equal(s.round, 2);
  assert.equal(s.firstPlayerId, B);
  assert.equal(s.secondPlayerId, A);
  assert.equal(s.street.turn, B);
});

test('올인이면 2차 베팅을 건너뛰고, 칩이 0이 되면 게임이 끝난다', () => {
  const s = play(game(SHOWDOWN_DECK), [
    { type: ACTION.START },
    { type: ACTION.ALL_IN, playerId: A },
    { type: ACTION.CALL, playerId: B },
  ]);
  assert.equal(s.phase, PHASE.CHOICE_REVEAL, '올인이어도 Choice 단계는 진행한다');
  assert.equal(s.players[A].chips, 0);
  assert.equal(s.players[B].chips, 0);

  const done = play(s, [
    { type: ACTION.REVEAL, playerId: A, cardId: s.choice.cardIds[0] },
    { type: ACTION.SELECT, playerId: B, cardId: s.choice.cardIds[0] },
  ]);
  assert.equal(done.phase, PHASE.GAME_OVER, '2차 베팅은 건너뛰고 바로 쇼다운·정산');
  assert.equal(done.lastResult.reason, 'SHOWDOWN');
  assert.equal(done.gameResult.winnerId, A);
  assert.equal(done.players[A].chips, 40);
  assert.equal(done.players[B].chips, 0);
  assert.equal(applyAction(done, { type: ACTION.NEXT_ROUND }).error.code, 'GAME_OVER');
});

test('레이즈가 이미 나온 뒤의 올인은 거부된다(콜만 가능)', () => {
  const s = play(game([[2, 3, 5, 3, 4, 5, 2]]), [
    { type: ACTION.START },
    { type: ACTION.BET, playerId: A, amount: 3 },
    { type: ACTION.RAISE, playerId: B, amount: 7 },
  ]);
  assert.equal(applyAction(s, { type: ACTION.ALL_IN, playerId: A }).error.code, 'RAISE_LIMIT');
});

test('legalActions 는 단계별로 가능한 액션만 준다', () => {
  const start = play(game([[2, 3, 5, 3, 4, 5, 2]]), [{ type: ACTION.START }]);
  assert.deepEqual(
    legalActions(start, A).map((a) => a.type).sort(),
    [ACTION.ALL_IN, ACTION.BET, ACTION.CHECK, ACTION.FOLD].sort()
  );
  assert.deepEqual(legalActions(start, B), [], '차례가 아니면 낼 수 있는 액션이 없다');

  const choice = toChoice();
  assert.deepEqual(legalActions(choice, A).map((a) => a.type), [ACTION.REVEAL]);
  assert.deepEqual(legalActions(choice, B), []);
});

// ── 무작위 자가대국 — 칩 보존 불변식 ─────────────────────────────────────────

/* 액션을 무작위로 고른다. 금액이 필요한 액션은 legalActions 가 준 min/max 안에서 뽑는다. */
function randomAction(state, playerId, rand) {
  const options = legalActions(state, playerId);
  if (!options.length) return null;
  const pick = options[Math.floor(rand() * options.length)];
  const action = { type: pick.type, playerId };
  if (pick.type === ACTION.BET || pick.type === ACTION.RAISE) {
    action.amount = pick.min + Math.floor(rand() * (pick.max - pick.min + 1));
  }
  if (pick.type === ACTION.REVEAL || pick.type === ACTION.SELECT) {
    action.cardId = pick.cardIds[Math.floor(rand() * pick.cardIds.length)];
  }
  return action;
}

function actorFor(state) {
  if (state.phase === PHASE.WAITING || state.phase === PHASE.SETTLEMENT) return state.playerOrder[0];
  if (state.phase === PHASE.CHOICE_REVEAL) return state.firstPlayerId;
  if (state.phase === PHASE.CHOICE_SELECT) return state.secondPlayerId;
  if (state.street) return state.street.turn;
  return null;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('무작위 자가대국 200판 — 칩 총량 40이 항상 보존되고 게임은 반드시 끝난다', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = lcg(seed * 7919);
    let s = createGame({ players: [{ id: A }, { id: B }], seed });
    let steps = 0;
    while (s.phase !== PHASE.GAME_OVER) {
      const actor = actorFor(s);
      const action = randomAction(s, actor, rand);
      assert.ok(action, `seed ${seed}: ${s.phase} 에서 낼 수 있는 액션이 없다`);
      const res = applyAction(s, action);
      assert.equal(res.error, null, `seed ${seed}: ${JSON.stringify(action)} → ${JSON.stringify(res.error)}`);
      s = res.state;

      const total = s.players[A].chips + s.players[B].chips + potTotal(s) + s.carryPot;
      assert.equal(total, 40, `seed ${seed} step ${steps}: 칩 총량이 ${total} (액션 ${action.type})`);
      assert.ok(s.players[A].chips >= 0 && s.players[B].chips >= 0, `seed ${seed}: 칩이 음수`);
      assert.ok(++steps < 5000, `seed ${seed}: 게임이 끝나지 않는다`);
    }
    assert.ok(s.players[A].chips === 0 || s.players[B].chips === 0);
  }
});

test('무작위 자가대국 — 최종 패는 언제나 공용 3장 + 개인 2장', () => {
  const rand = lcg(4242);
  let s = createGame({ players: [{ id: A }, { id: B }], seed: 99 });
  let showdowns = 0;
  while (s.phase !== PHASE.GAME_OVER) {
    const res = applyAction(s, randomAction(s, actorFor(s), rand));
    assert.equal(res.error, null);
    s = res.state;
    if (s.lastResult && s.lastResult.reason === 'SHOWDOWN' && s.phase !== PHASE.WAITING) {
      showdowns++;
      assert.equal(s.community.length, 3);
      for (const pid of s.playerOrder) {
        assert.equal(s.players[pid].hole.length, 2);
        assert.equal(finalCards(s, pid).length, 5);
      }
    }
  }
  assert.ok(showdowns > 0, '쇼다운이 한 번도 없었다면 테스트가 의미 없다');
});
