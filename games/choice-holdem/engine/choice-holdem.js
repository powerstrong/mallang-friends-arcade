/* 초이스 홀덤(Choice Hold'em) 규칙 엔진 — 순수 함수 모음.
 *
 * 2인용 포커. 최종 패는 "공용 3장 + 개인 2장 = 정확히 5장"이며, 개인 2장 중 두 번째는
 * Choice 단계에서 결정된다. 선플레이어는 Choice 카드 2장을 모두 본 뒤 한 장만 앞면으로
 * 공개하고, 후플레이어가 [공개된 카드 / 미지의 카드] 중 하나를 고른다. 남은 한 장은
 * 선플레이어에게 귀속된다. 이 정보 비대칭이 게임의 핵심이다.
 *
 * 설계 원칙
 *  - I/O 없음, Date.now() 없음, 전역 상태 없음. 난수는 state.rngState(mulberry32)로만 진행하므로
 *    같은 seed·같은 액션열이면 항상 같은 결과가 나온다(테스트/리플레이 가능).
 *  - applyAction 은 입력 state 를 변형하지 않고 새 state 를 돌려준다.
 *  - 서버 권위: 카드 원본(state.deck / 상대 개인 카드)은 절대 그대로 내보내지 말고
 *    반드시 viewFor(state, viewerId) 로 가려서 전송한다.
 *
 * 명세의 상태 머신 중 입력이 필요 없는 단계(ROUND_START·BASE_BET·DEAL_INITIAL_CARDS·
 * SHOWDOWN·NEXT_ROUND)는 별도 phase 로 멈추지 않고 이벤트로만 남긴다. 즉 엔진이 멈추는
 * phase 는 "누군가의 액션을 기다리는 지점"뿐이다.
 */

// ── 상수 ────────────────────────────────────────────────────────────────────

export const PHASE = Object.freeze({
  WAITING: 'WAITING',           // START 대기
  BETTING_1: 'BETTING_1',       // 1차 베팅 (공용 3 + 개인 1 확인 후)
  CHOICE_REVEAL: 'CHOICE_REVEAL', // 선플레이어가 Choice 2장 중 1장 공개
  CHOICE_SELECT: 'CHOICE_SELECT', // 후플레이어가 2장 중 1장 선택
  BETTING_2: 'BETTING_2',       // 2차 베팅 (최종 5장 확정 후)
  SETTLEMENT: 'SETTLEMENT',     // 라운드 정산 완료 — NEXT_ROUND 대기
  GAME_OVER: 'GAME_OVER',
});

export const ACTION = Object.freeze({
  START: 'START',
  CHECK: 'CHECK',
  BET: 'BET',
  CALL: 'CALL',
  RAISE: 'RAISE',
  FOLD: 'FOLD',
  ALL_IN: 'ALL_IN',
  REVEAL: 'REVEAL',
  SELECT: 'SELECT',
  NEXT_ROUND: 'NEXT_ROUND',
});

/* 족보 — suit 가 없으므로 플러시 계열은 존재하지 않는다.
 * 숫자가 1~5뿐이라 "5장이 전부 다른 숫자" = 1·2·3·4·5 = 스트레이트 하나뿐이고,
 * 따라서 하이카드 족보도 존재할 수 없다(아래 6종이 전부). */
export const HAND = Object.freeze({
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FULL_HOUSE: 5,
  FOUR_OF_A_KIND: 6,
});

export const HAND_NAME = Object.freeze({
  [HAND.ONE_PAIR]: '원페어',
  [HAND.TWO_PAIR]: '투페어',
  [HAND.THREE_OF_A_KIND]: '트리플',
  [HAND.STRAIGHT]: '스트레이트',
  [HAND.FULL_HOUSE]: '풀하우스',
  [HAND.FOUR_OF_A_KIND]: '포카드',
});

export const DEFAULT_CONFIG = Object.freeze({
  startingChips: 20,      // 1인 시작 칩
  baseBetStep: 10,        // 몇 라운드마다 기본 베팅이 1칩씩 오르는지
  maxRaisesPerStreet: 1,  // 한 베팅 단계에서 허용되는 Raise 횟수
  deckResetMode: 'EVERY_ROUND', // 매 라운드 20장 전체를 새로 섞는다(방송 규칙 확인 시 변경)
});

const RANKS = 5;        // 숫자 1~5
const COPIES_PER_RANK = 4;
export const DECK_SIZE = RANKS * COPIES_PER_RANK; // 20장

// ── 족보 판정 ───────────────────────────────────────────────────────────────

/* 정확히 5장을 받아 족보를 판정한다.
 * 반환: { rank, name, tiebreak:[...] } — tiebreak 은 같은 족보끼리 비교할 숫자 배열(높은 우선순위 순). */
export function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error('evaluateHand: 정확히 5장이어야 합니다.');
  }
  const counts = new Map();
  for (const card of cards) {
    const rank = typeof card === 'number' ? card : card.rank;
    if (!Number.isInteger(rank) || rank < 1 || rank > RANKS) {
      throw new Error(`evaluateHand: 잘못된 숫자 ${rank}`);
    }
    counts.set(rank, (counts.get(rank) || 0) + 1);
  }
  // [숫자, 장수] 를 장수 내림차순 → 숫자 내림차순으로 정렬.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [topRank, topCount] = groups[0];

  if (topCount === 4) return hand(HAND.FOUR_OF_A_KIND, [topRank, groups[1][0]]);
  if (topCount === 3 && groups[1][1] === 2) return hand(HAND.FULL_HOUSE, [topRank, groups[1][0]]);
  if (topCount === 3) return hand(HAND.THREE_OF_A_KIND, [topRank, groups[1][0], groups[2][0]]);
  if (topCount === 2 && groups[1][1] === 2) {
    return hand(HAND.TWO_PAIR, [groups[0][0], groups[1][0], groups[2][0]]);
  }
  if (topCount === 2) {
    return hand(HAND.ONE_PAIR, [topRank, groups[1][0], groups[2][0], groups[3][0]]);
  }
  // 5장이 모두 다른 숫자 = 1·2·3·4·5. 비교할 값이 없어 항상 동점이다.
  return hand(HAND.STRAIGHT, []);
}

function hand(rank, tiebreak) {
  return { rank, name: HAND_NAME[rank], tiebreak };
}

/* a 가 강하면 1, b 가 강하면 -1, 완전 동점이면 0. */
export function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank > b.rank ? 1 : -1;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/* 라운드 번호별 기본 베팅: 1~10라운드 1칩, 11~20라운드 2칩 … */
export function baseBetFor(round, step = DEFAULT_CONFIG.baseBetStep) {
  return 1 + Math.floor((Math.max(1, round) - 1) / step);
}

// ── 난수 · 덱 ───────────────────────────────────────────────────────────────

function random(state) {
  // mulberry32 — state 에 시드를 담아 진행하므로 엔진 전체가 직렬화 가능하다.
  let a = (state.rngState + 0x6d2b79f5) | 0;
  state.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function freshRanks() {
  const ranks = [];
  for (let r = 1; r <= RANKS; r++) {
    for (let i = 0; i < COPIES_PER_RANK; i++) ranks.push(r);
  }
  return ranks;
}

function shuffleInPlace(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/* 20장 덱 생성. state.stackedDecks 에 남은 항목이 있으면 그 숫자열을 덱 앞쪽에 그대로 배치한다
 * (테스트용 스택드 덱). 카드 id 는 덱 위치 기반이라 숫자를 노출하지 않는다. */
function buildDeck(state) {
  if (state.config.deckResetMode !== 'EVERY_ROUND') {
    // 방송 규칙 확인 전까지 EVERY_ROUND 하나만 구현되어 있다. 다른 값이 들어오면
    // 조용히 EVERY_ROUND 로 동작하는 대신 바로 실패시킨다(규칙이 틀린 채 배포되는 것 방지).
    throw new Error(`deckResetMode "${state.config.deckResetMode}" 는 아직 구현되지 않았습니다.`);
  }
  const pool = freshRanks();
  const stacked = state.stackedDecks.length ? state.stackedDecks.shift() : null;
  let ordered;
  if (stacked) {
    ordered = [];
    for (const rank of stacked) {
      const idx = pool.indexOf(rank);
      if (idx === -1) throw new Error(`stackedDeck: 숫자 ${rank} 를 4장 넘게 사용할 수 없습니다.`);
      pool.splice(idx, 1);
      ordered.push(rank);
    }
    ordered = ordered.concat(shuffleInPlace(state, pool));
  } else {
    ordered = shuffleInPlace(state, pool);
  }
  return ordered.map((rank, i) => ({ id: `r${state.round}c${i}`, rank }));
}

function draw(state, n) {
  return state.deck.splice(0, n);
}

// ── 게임 생성 ───────────────────────────────────────────────────────────────

/* players: [{id, name}, {id, name}] — 배열 0번이 1라운드 선플레이어가 된다.
 * seed: 정수. stackedDecks: [[ranks…], …] 라운드별 덱 앞부분 고정(테스트용). */
export function createGame({ players, seed = 1, config = {}, stackedDecks = [] } = {}) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error('createGame: 플레이어는 정확히 2명이어야 합니다.');
  }
  if (players[0].id === players[1].id) {
    throw new Error('createGame: 플레이어 id 가 중복됩니다.');
  }
  const merged = { ...DEFAULT_CONFIG, ...config };
  const state = {
    config: merged,
    phase: PHASE.WAITING,
    round: 0,
    rngState: seed | 0,
    stackedDecks: stackedDecks.map((d) => d.slice()),
    playerOrder: [players[0].id, players[1].id],
    players: {},
    deck: [],
    community: [],
    pot: 0,
    carryPot: 0,
    firstPlayerId: players[0].id,
    secondPlayerId: players[1].id,
    street: null,
    choice: null,
    lastResult: null,
    gameResult: null,
  };
  for (const p of players) {
    state.players[p.id] = {
      id: p.id,
      name: p.name ?? p.id,
      chips: merged.startingChips,
      hole: [],
      folded: false,
    };
  }
  return state;
}

// ── 조회 헬퍼 ───────────────────────────────────────────────────────────────

function opponentOf(state, playerId) {
  const [a, b] = state.playerOrder;
  return playerId === a ? b : a;
}

export function potTotal(state) {
  const street = state.street;
  if (!street) return state.pot;
  return state.pot + street.bets[state.playerOrder[0]] + street.bets[state.playerOrder[1]];
}

function maxBet(street, order) {
  return Math.max(street.bets[order[0]], street.bets[order[1]]);
}

function isBettingPhase(phase) {
  return phase === PHASE.BETTING_1 || phase === PHASE.BETTING_2;
}

/* 지금 이 플레이어가 낼 수 있는 액션 목록. UI·AI·서버 검증이 공유한다. */
export function legalActions(state, playerId) {
  if (state.phase === PHASE.WAITING) return [{ type: ACTION.START }];
  if (state.phase === PHASE.SETTLEMENT) return [{ type: ACTION.NEXT_ROUND }];
  if (state.phase === PHASE.GAME_OVER) return [];

  if (state.phase === PHASE.CHOICE_REVEAL) {
    if (playerId !== state.firstPlayerId) return [];
    return [{ type: ACTION.REVEAL, cardIds: state.choice.cardIds.slice() }];
  }
  if (state.phase === PHASE.CHOICE_SELECT) {
    if (playerId !== state.secondPlayerId) return [];
    return [{ type: ACTION.SELECT, cardIds: state.choice.cardIds.slice() }];
  }

  if (!isBettingPhase(state.phase) || !state.street) return [];
  const street = state.street;
  if (street.turn !== playerId) return [];

  const stack = state.players[playerId].chips;
  const top = maxBet(street, state.playerOrder);
  const toCall = top - street.bets[playerId];
  const out = [{ type: ACTION.FOLD }];

  if (toCall === 0) {
    out.push({ type: ACTION.CHECK });
    if (stack > 0 && top === 0) out.push({ type: ACTION.BET, min: 1, max: stack });
    if (stack > 0) out.push({ type: ACTION.ALL_IN, amount: stack });
  } else {
    out.push({ type: ACTION.CALL, amount: Math.min(toCall, stack) });
    const canRaise = street.raises < state.config.maxRaisesPerStreet && stack > toCall;
    if (canRaise) {
      out.push({ type: ACTION.RAISE, min: top + 1, max: street.bets[playerId] + stack });
      out.push({ type: ACTION.ALL_IN, amount: stack });
    } else if (stack <= toCall && stack > 0) {
      out.push({ type: ACTION.ALL_IN, amount: stack });
    }
  }
  return out;
}

// ── 라운드 진행 ─────────────────────────────────────────────────────────────

function startRound(state, events) {
  state.round += 1;
  // 선플레이어는 라운드마다 교대한다(홀수 라운드 = playerOrder[0]).
  const [a, b] = state.playerOrder;
  state.firstPlayerId = state.round % 2 === 1 ? a : b;
  state.secondPlayerId = opponentOf(state, state.firstPlayerId);

  state.pot = state.carryPot;
  state.carryPot = 0;
  state.choice = null;
  state.lastResult = null;
  for (const pid of state.playerOrder) {
    state.players[pid].hole = [];
    state.players[pid].folded = false;
  }
  state.deck = buildDeck(state);
  events.push({ type: 'ROUND_START', round: state.round, firstPlayerId: state.firstPlayerId });

  postAntes(state, events);
  dealInitial(state, events);
  beginStreet(state, PHASE.BETTING_1, events);
}

function postAntes(state, events) {
  const bet = baseBetFor(state.round, state.config.baseBetStep);
  const paid = {};
  for (const pid of state.playerOrder) {
    const player = state.players[pid];
    const amount = Math.min(bet, player.chips);
    player.chips -= amount;
    paid[pid] = amount;
  }
  // 칩이 모자라 앤티가 불균등해지면 초과분은 돌려준다(콜되지 않은 칩은 팟에 남지 않는다).
  const [a, b] = state.playerOrder;
  const diff = paid[a] - paid[b];
  if (diff !== 0) {
    const over = diff > 0 ? a : b;
    const back = Math.abs(diff);
    state.players[over].chips += back;
    paid[over] -= back;
  }
  state.pot += paid[a] + paid[b];
  events.push({ type: 'BASE_BET', baseBet: bet, paid, pot: state.pot });
}

function dealInitial(state, events) {
  state.community = draw(state, 3);
  // 선플레이어 → 후플레이어 순으로 개인 카드 1장씩.
  state.players[state.firstPlayerId].hole = draw(state, 1);
  state.players[state.secondPlayerId].hole = draw(state, 1);
  events.push({ type: 'DEAL_INITIAL_CARDS', community: state.community.map((c) => c.rank) });
}

function beginStreet(state, phase, events) {
  const [a, b] = state.playerOrder;
  // 한쪽이라도 칩이 없으면(올인) 더 이상 의미 있는 베팅이 불가능하므로 단계를 건너뛴다.
  if (state.players[a].chips === 0 || state.players[b].chips === 0) {
    state.street = null;
    state.phase = phase;
    events.push({ type: 'BETTING_SKIPPED', phase });
    advanceAfterStreet(state, events);
    return;
  }
  state.phase = phase;
  state.street = {
    name: phase,
    bets: { [a]: 0, [b]: 0 },
    acted: { [a]: false, [b]: false },
    raises: 0,
    turn: state.firstPlayerId, // 1차·2차 모두 선플레이어가 먼저 액션한다.
  };
  events.push({ type: 'BETTING_START', phase, turn: state.street.turn });
}

function commit(state, playerId, amount) {
  const player = state.players[playerId];
  const paid = Math.min(amount, player.chips);
  player.chips -= paid;
  state.street.bets[playerId] += paid;
  return paid;
}

/* 양쪽이 모두 액션했고 베팅액이 같으면(또는 낮은 쪽이 올인이면) 단계가 끝난다. */
function streetComplete(state) {
  const street = state.street;
  const [a, b] = state.playerOrder;
  if (!street.acted[a] || !street.acted[b]) return false;
  if (street.bets[a] === street.bets[b]) return true;
  const low = street.bets[a] < street.bets[b] ? a : b;
  return state.players[low].chips === 0;
}

function closeStreet(state, events) {
  const street = state.street;
  const [a, b] = state.playerOrder;
  // 콜되지 않은 초과 베팅은 되돌려준다.
  const diff = street.bets[a] - street.bets[b];
  if (diff !== 0) {
    const over = diff > 0 ? a : b;
    const back = Math.abs(diff);
    state.players[over].chips += back;
    street.bets[over] -= back;
    events.push({ type: 'UNCALLED_RETURNED', playerId: over, amount: back });
  }
  state.pot += street.bets[a] + street.bets[b];
  state.street = null;
  events.push({ type: 'BETTING_END', phase: state.phase, pot: state.pot });
  advanceAfterStreet(state, events);
}

function advanceAfterStreet(state, events) {
  if (state.phase === PHASE.BETTING_1) {
    beginChoice(state, events);
    return;
  }
  showdown(state, events);
}

function beginChoice(state, events) {
  const cards = draw(state, 2);
  state.choice = {
    cardIds: [cards[0].id, cards[1].id],
    cards, // 서버 전용 — viewFor 가 후플레이어에게는 숫자를 가린다.
    firstPlayerId: state.firstPlayerId,
    secondPlayerId: state.secondPlayerId,
    revealedCardId: null,
    hiddenCardId: null,
    selectedCardId: null,
  };
  state.phase = PHASE.CHOICE_REVEAL;
  events.push({ type: 'CHOICE_DEALT', firstPlayerId: state.firstPlayerId });
}

function showdown(state, events) {
  const [a, b] = state.playerOrder;
  const handOf = {};
  for (const pid of [a, b]) {
    handOf[pid] = evaluateHand(finalCards(state, pid));
  }
  const cmp = compareHands(handOf[a], handOf[b]);
  const winnerId = cmp === 0 ? null : cmp > 0 ? a : b;
  events.push({ type: 'SHOWDOWN', hands: { [a]: handOf[a], [b]: handOf[b] } });
  settle(state, {
    reason: 'SHOWDOWN',
    winnerId,
    hands: { [a]: handOf[a], [b]: handOf[b] },
  }, events);
}

/* 공용 3장 + 개인 2장 = 정확히 5장. 텍사스 홀덤처럼 7장 중 5장을 고르지 않는다. */
export function finalCards(state, playerId) {
  return state.community.concat(state.players[playerId].hole);
}

function settle(state, result, events) {
  const pot = state.pot;
  if (result.winnerId) {
    state.players[result.winnerId].chips += pot;
    state.pot = 0;
  } else {
    // 완전 동점 — 팟을 나누지 않고 다음 라운드로 이월한다.
    state.carryPot = pot;
    state.pot = 0;
  }
  state.lastResult = {
    round: state.round,
    reason: result.reason,
    winnerId: result.winnerId ?? null,
    pot,
    carried: result.winnerId ? 0 : pot,
    hands: result.hands ?? null,
    chips: { ...chipsSnapshot(state) },
  };
  state.street = null;
  events.push({ type: 'SETTLEMENT', ...state.lastResult });

  const [a, b] = state.playerOrder;
  const aBroke = state.players[a].chips === 0;
  const bBroke = state.players[b].chips === 0;
  if (aBroke || bBroke) {
    state.phase = PHASE.GAME_OVER;
    state.gameResult = aBroke && bBroke
      ? { winnerId: null, reason: 'DRAW' }
      : { winnerId: aBroke ? b : a, reason: 'CHIPS_ZERO' };
    events.push({ type: 'GAME_OVER', ...state.gameResult });
    return;
  }
  state.phase = PHASE.SETTLEMENT;
}

function chipsSnapshot(state) {
  const out = {};
  for (const pid of state.playerOrder) out[pid] = state.players[pid].chips;
  return out;
}

// ── 액션 적용 ───────────────────────────────────────────────────────────────

function fail(state, code, message) {
  return { state, events: [], error: { code, message } };
}

/* 유일한 상태 변경 진입점.
 *   action: { type, playerId, amount? , cardId? }
 * 반환: { state, events, error } — error 가 있으면 state 는 입력 그대로다(거부). */
export function applyAction(state, action) {
  if (!action || typeof action.type !== 'string') {
    return fail(state, 'BAD_ACTION', '액션 형식이 올바르지 않습니다.');
  }
  const { type, playerId } = action;
  if (playerId !== undefined && !state.players[playerId]) {
    return fail(state, 'UNKNOWN_PLAYER', '알 수 없는 플레이어입니다.');
  }
  if (state.phase === PHASE.GAME_OVER) {
    return fail(state, 'GAME_OVER', '이미 종료된 게임입니다.');
  }

  const next = cloneState(state);
  const events = [];

  switch (type) {
    case ACTION.START: {
      if (next.phase !== PHASE.WAITING) return fail(state, 'WRONG_PHASE', '이미 시작된 게임입니다.');
      startRound(next, events);
      return { state: next, events, error: null };
    }
    case ACTION.NEXT_ROUND: {
      if (next.phase !== PHASE.SETTLEMENT) return fail(state, 'WRONG_PHASE', '정산 단계가 아닙니다.');
      startRound(next, events);
      return { state: next, events, error: null };
    }
    case ACTION.REVEAL: {
      if (next.phase !== PHASE.CHOICE_REVEAL) return fail(state, 'WRONG_PHASE', 'Choice 공개 단계가 아닙니다.');
      if (playerId !== next.firstPlayerId) return fail(state, 'NOT_FIRST_PLAYER', '선플레이어만 공개할 수 있습니다.');
      const choice = next.choice;
      if (!choice.cardIds.includes(action.cardId)) {
        return fail(state, 'BAD_CARD', 'Choice 카드가 아닙니다.');
      }
      choice.revealedCardId = action.cardId;
      choice.hiddenCardId = choice.cardIds.find((id) => id !== action.cardId);
      next.phase = PHASE.CHOICE_SELECT;
      events.push({
        type: 'CHOICE_REVEALED',
        cardId: choice.revealedCardId,
        rank: cardById(next, choice.revealedCardId).rank,
      });
      return { state: next, events, error: null };
    }
    case ACTION.SELECT: {
      if (next.phase !== PHASE.CHOICE_SELECT) return fail(state, 'WRONG_PHASE', 'Choice 선택 단계가 아닙니다.');
      if (playerId !== next.secondPlayerId) return fail(state, 'NOT_SECOND_PLAYER', '후플레이어만 선택할 수 있습니다.');
      const choice = next.choice;
      if (!choice.cardIds.includes(action.cardId)) {
        return fail(state, 'BAD_CARD', 'Choice 카드가 아닙니다.');
      }
      choice.selectedCardId = action.cardId;
      const takenBySecond = cardById(next, action.cardId);
      const leftover = choice.cards.find((c) => c.id !== action.cardId);
      next.players[next.secondPlayerId].hole.push(takenBySecond);
      // 후플레이어가 고르지 않은 카드는 자동으로 선플레이어에게 귀속된다.
      next.players[next.firstPlayerId].hole.push(leftover);
      events.push({
        type: 'CHOICE_SELECTED',
        selectedCardId: action.cardId,
        pickedHidden: action.cardId === choice.hiddenCardId,
      });
      beginStreet(next, PHASE.BETTING_2, events);
      return { state: next, events, error: null };
    }
    default:
      return applyBettingAction(state, next, action, events);
  }
}

function applyBettingAction(state, next, action, events) {
  const { type, playerId } = action;
  if (!isBettingPhase(next.phase) || !next.street) {
    return fail(state, 'WRONG_PHASE', '베팅 단계가 아닙니다.');
  }
  const street = next.street;
  if (street.turn !== playerId) return fail(state, 'NOT_YOUR_TURN', '당신의 차례가 아닙니다.');

  const player = next.players[playerId];
  const top = maxBet(street, next.playerOrder);
  const toCall = top - street.bets[playerId];

  switch (type) {
    case ACTION.FOLD: {
      player.folded = true;
      const winnerId = opponentOf(next, playerId);
      // 폴드한 플레이어의 개인 카드는 공개하지 않는다.
      street.acted[playerId] = true;
      const [a, b] = next.playerOrder;
      const diff = street.bets[a] - street.bets[b];
      if (diff !== 0) {
        const over = diff > 0 ? a : b;
        const back = Math.abs(diff);
        next.players[over].chips += back;
        street.bets[over] -= back;
      }
      next.pot += street.bets[a] + street.bets[b];
      next.street = null;
      events.push({ type: 'FOLD', playerId });
      settle(next, { reason: 'FOLD', winnerId }, events);
      return { state: next, events, error: null };
    }
    case ACTION.CHECK: {
      if (toCall !== 0) return fail(state, 'CANNOT_CHECK', '콜해야 할 금액이 있습니다.');
      street.acted[playerId] = true;
      events.push({ type: 'CHECK', playerId });
      break;
    }
    case ACTION.BET: {
      if (toCall !== 0 || top !== 0) return fail(state, 'CANNOT_BET', '이미 베팅이 있습니다 — RAISE 를 사용하세요.');
      const amount = action.amount;
      if (!Number.isInteger(amount) || amount < 1) return fail(state, 'BAD_AMOUNT', '베팅은 1칩 이상이어야 합니다.');
      if (amount > player.chips) return fail(state, 'NOT_ENOUGH_CHIPS', '보유 칩을 초과했습니다.');
      commit(next, playerId, amount);
      street.acted = { [next.playerOrder[0]]: false, [next.playerOrder[1]]: false };
      street.acted[playerId] = true;
      events.push({ type: 'BET', playerId, amount });
      break;
    }
    case ACTION.CALL: {
      if (toCall === 0) return fail(state, 'NOTHING_TO_CALL', '콜할 금액이 없습니다 — CHECK 을 사용하세요.');
      const paid = commit(next, playerId, toCall);
      street.acted[playerId] = true;
      events.push({ type: 'CALL', playerId, amount: paid, allIn: player.chips === 0 });
      break;
    }
    case ACTION.RAISE: {
      if (toCall === 0) return fail(state, 'CANNOT_RAISE', '레이즈할 베팅이 없습니다 — BET 을 사용하세요.');
      if (street.raises >= next.config.maxRaisesPerStreet) {
        return fail(state, 'RAISE_LIMIT', '한 베팅 단계에서 레이즈는 1회만 가능합니다.');
      }
      // amount 는 "이 단계에서의 총 베팅액(raise-to)" 이다. 예: 상대 BET 3 → RAISE 7.
      const target = action.amount;
      if (!Number.isInteger(target) || target <= top) {
        return fail(state, 'BAD_AMOUNT', `레이즈는 ${top + 1}칩 이상(총액 기준)이어야 합니다.`);
      }
      const need = target - street.bets[playerId];
      if (need > player.chips) return fail(state, 'NOT_ENOUGH_CHIPS', '보유 칩을 초과했습니다.');
      commit(next, playerId, need);
      street.raises += 1;
      street.acted = { [next.playerOrder[0]]: false, [next.playerOrder[1]]: false };
      street.acted[playerId] = true;
      events.push({ type: 'RAISE', playerId, amount: target });
      break;
    }
    case ACTION.ALL_IN: {
      const stack = player.chips;
      if (stack <= 0) return fail(state, 'NOT_ENOUGH_CHIPS', '남은 칩이 없습니다.');
      if (toCall === 0) {
        if (top !== 0) return fail(state, 'CANNOT_BET', '이미 베팅이 있습니다.');
        commit(next, playerId, stack);
        street.acted = { [next.playerOrder[0]]: false, [next.playerOrder[1]]: false };
        street.acted[playerId] = true;
        events.push({ type: 'ALL_IN', playerId, amount: stack, as: 'BET' });
      } else if (stack <= toCall) {
        commit(next, playerId, stack);
        street.acted[playerId] = true;
        events.push({ type: 'ALL_IN', playerId, amount: stack, as: 'CALL' });
      } else {
        if (street.raises >= next.config.maxRaisesPerStreet) {
          return fail(state, 'RAISE_LIMIT', '레이즈가 이미 사용되어 올인할 수 없습니다 — CALL 만 가능합니다.');
        }
        commit(next, playerId, stack);
        street.raises += 1;
        street.acted = { [next.playerOrder[0]]: false, [next.playerOrder[1]]: false };
        street.acted[playerId] = true;
        events.push({ type: 'ALL_IN', playerId, amount: stack, as: 'RAISE' });
      }
      break;
    }
    default:
      return fail(state, 'BAD_ACTION', `알 수 없는 액션: ${type}`);
  }

  if (streetComplete(next)) {
    closeStreet(next, events);
  } else {
    next.street.turn = opponentOf(next, playerId);
  }
  return { state: next, events, error: null };
}

function cardById(state, cardId) {
  const pools = [state.community, state.choice ? state.choice.cards : []];
  for (const pid of state.playerOrder) pools.push(state.players[pid].hole);
  for (const pool of pools) {
    const found = pool.find((c) => c.id === cardId);
    if (found) return found;
  }
  return null;
}

function cloneState(state) {
  return {
    ...state,
    stackedDecks: state.stackedDecks.map((d) => d.slice()),
    playerOrder: state.playerOrder.slice(),
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [id, { ...p, hole: p.hole.slice() }])
    ),
    deck: state.deck.slice(),
    community: state.community.slice(),
    street: state.street
      ? { ...state.street, bets: { ...state.street.bets }, acted: { ...state.street.acted } }
      : null,
    choice: state.choice ? { ...state.choice, cardIds: state.choice.cardIds.slice(), cards: state.choice.cards.slice() } : null,
    lastResult: state.lastResult ? { ...state.lastResult } : null,
    gameResult: state.gameResult ? { ...state.gameResult } : null,
  };
}

// ── 가시성 · 뷰 ─────────────────────────────────────────────────────────────

function showdownRevealed(state) {
  return state.lastResult != null && state.lastResult.reason === 'SHOWDOWN';
}

/* 이 카드의 숫자를 viewerId 가 알아도 되는가? 클라이언트로 나가는 모든 숫자는 이 함수를 통과한다. */
export function canSee(state, viewerId, card) {
  if (!card) return false;
  if (state.community.some((c) => c.id === card.id)) return true;
  if (state.players[viewerId] && state.players[viewerId].hole.some((c) => c.id === card.id)) return true;
  // 앞면으로 공개된 Choice 카드는 이후 누구의 것이 되든 모두가 안다.
  if (state.choice && state.choice.revealedCardId === card.id) return true;
  // Choice 카드는 공개 전까지 선플레이어만 본다.
  if (state.choice && state.choice.selectedCardId == null
      && state.choice.cardIds.includes(card.id)
      && viewerId === state.firstPlayerId) return true;
  if (showdownRevealed(state)) return true;
  return false;
}

function maskCard(state, viewerId, card) {
  return { id: card.id, rank: canSee(state, viewerId, card) ? card.rank : null };
}

/* 클라이언트로 보낼 뷰. deck 과 상대 개인 카드 숫자는 절대 포함되지 않는다.
 * (후플레이어에게 hiddenCard 숫자를 보내고 UI 에서만 가리면 개발자 도구로 치팅 가능하다.) */
export function viewFor(state, viewerId) {
  const opponentId = state.players[viewerId] ? opponentOf(state, viewerId) : null;
  const me = state.players[viewerId] ?? null;
  const opp = opponentId ? state.players[opponentId] : null;

  const view = {
    phase: state.phase,
    round: state.round,
    baseBet: state.round ? baseBetFor(state.round, state.config.baseBetStep) : 0,
    pot: potTotal(state),
    carryPot: state.carryPot,
    firstPlayerId: state.firstPlayerId,
    secondPlayerId: state.secondPlayerId,
    isFirstPlayer: viewerId === state.firstPlayerId,
    community: state.community.map((c) => ({ id: c.id, rank: c.rank })),
    you: me
      ? {
          id: me.id,
          name: me.name,
          chips: me.chips,
          folded: me.folded,
          hole: me.hole.map((c) => ({ id: c.id, rank: c.rank })),
        }
      : null,
    opponent: opp
      ? {
          id: opp.id,
          name: opp.name,
          chips: opp.chips,
          folded: opp.folded,
          hole: opp.hole.map((c) => maskCard(state, viewerId, c)),
        }
      : null,
    street: null,
    choice: null,
    legalActions: legalActions(state, viewerId),
    lastResult: state.lastResult,
    gameResult: state.gameResult,
  };

  if (state.street) {
    const top = maxBet(state.street, state.playerOrder);
    view.street = {
      name: state.street.name,
      turn: state.street.turn,
      bets: { ...state.street.bets },
      toCall: me ? Math.max(0, top - state.street.bets[viewerId]) : 0,
      raises: state.street.raises,
      raiseAvailable: state.street.raises < state.config.maxRaisesPerStreet,
    };
  }

  if (state.choice) {
    const c = state.choice;
    view.choice = {
      revealedCardId: c.revealedCardId,
      selectedCardId: c.selectedCardId,
      cards: c.cards.map((card) => ({
        ...maskCard(state, viewerId, card),
        faceUp: card.id === c.revealedCardId,
      })),
    };
  }

  return view;
}
