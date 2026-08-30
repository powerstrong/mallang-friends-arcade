/* 초이스 홀덤 봇 — 실험실 솔로 플레이용 상대.
 *
 * 봇은 반드시 viewFor(state, botId) 로 만든 "가려진 뷰"만 입력으로 받는다.
 * 원본 state 를 넘기면 상대 카드를 훔쳐보는 봇이 되므로 절대 그렇게 쓰지 말 것.
 *
 * 덱이 20장(1~5 각 4장)뿐이라 승률을 근사하지 않고 남은 카드를 전부 열거해 정확히 계산한다.
 * 미지의 카드가 최대 3장이라 경우의 수는 5^3 = 125 이하다.
 */
import { evaluateHand, compareHands, ACTION, PHASE } from './choice-holdem.js';

const RANKS = 5;
const COPIES = 4;
const TIE_SCORE = 0.45; // 동점은 팟 이월이라 승리보다 확실히 나쁘고 패배보다는 낫다.

/* 뷰에서 "아직 못 본 카드"의 숫자별 장수. 상대 손패·덱·미공개 Choice 카드가 여기 섞여 있다.
 * 같은 카드가 여러 곳에 나타나므로(Choice 선택이 끝나면 그 카드는 hole 과 choice.cards 양쪽에
 * 있다) 반드시 카드 id 로 중복을 제거한다 — 안 하면 덱에서 두 번 빠져 승률이 틀어진다. */
function unseenCounts(view) {
  const counts = new Array(RANKS + 1).fill(COPIES);
  counts[0] = 0;
  const seen = new Map();   // cardId -> rank (같은 카드는 한 번만 센다)
  const note = (c) => { if (c && c.rank != null) seen.set(c.id, c.rank); };
  for (const c of view.community) note(c);
  for (const c of view.you.hole) note(c);
  for (const c of view.opponent.hole) note(c);
  if (view.choice) for (const c of view.choice.cards) note(c);
  for (const rank of seen.values()) {
    if (rank >= 1 && rank <= RANKS) counts[rank] = Math.max(0, counts[rank] - 1);
  }
  return counts;
}

/* 남은 카드에서 n장을 "순서 있게" 뽑는 모든 경우와 그 가중치. 앞에서부터 자리(내 카드/상대 카드)에
 * 배정하므로 순서 있는 열거가 맞다. */
function sequences(counts, n) {
  if (n === 0) return [{ ranks: [], weight: 1 }];
  const out = [];
  for (let r = 1; r <= RANKS; r++) {
    if (counts[r] <= 0) continue;
    const w = counts[r];
    counts[r] -= 1;
    for (const sub of sequences(counts, n - 1)) {
      out.push({ ranks: [r, ...sub.ranks], weight: w * sub.weight });
    }
    counts[r] += 1;
  }
  return out;
}

/* 내 확정 카드 + 상대 확정 카드로부터 승률(0~1)을 계산한다.
 * 부족한 장수는 남은 카드에서 열거해 채운다. */
function equity({ community, mine, theirs, counts }) {
  const need = (5 - community.length - mine.length) + (5 - community.length - theirs.length);
  const myMissing = 5 - community.length - mine.length;
  const draws = sequences(counts.slice(), need);
  let score = 0;
  let total = 0;
  for (const draw of draws) {
    const myFive = community.concat(mine, draw.ranks.slice(0, myMissing));
    const theirFive = community.concat(theirs, draw.ranks.slice(myMissing));
    const cmp = compareHands(
      evaluateHand(myFive.map((rank) => ({ rank }))),
      evaluateHand(theirFive.map((rank) => ({ rank })))
    );
    score += draw.weight * (cmp > 0 ? 1 : cmp === 0 ? TIE_SCORE : 0);
    total += draw.weight;
  }
  return total ? score / total : 0.5;
}

function ranksOf(cards) {
  return cards.map((c) => c.rank);
}

/* 현재 뷰 기준 내 승률. Choice 전이면 내 5번째 카드도 미지수로 두고 계산한다. */
export function winProbability(view) {
  return equity({
    community: ranksOf(view.community),
    mine: ranksOf(view.you.hole),
    theirs: view.opponent.hole.filter((c) => c.rank != null).map((c) => c.rank),
    counts: unseenCounts(view),
  });
}

function pick(list, type) {
  return list.find((a) => a.type === type) || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/* 베팅 판단 — 승률 vs 팟 오즈. 약간의 블러프·슬로우플레이를 섞어 읽히지 않게 한다. */
function decideBetting(view, rand) {
  const legal = view.legalActions;
  const p = winProbability(view);
  const toCall = view.street.toCall;
  const pot = view.pot;

  if (toCall === 0) {
    const bet = pick(legal, ACTION.BET);
    const check = pick(legal, ACTION.CHECK);
    if (bet) {
      if (p > 0.72) {
        const size = p > 0.88 && rand() < 0.4 ? pot : pot * 0.6;
        return { type: ACTION.BET, amount: clamp(size, bet.min, bet.max) };
      }
      if (p > 0.58 && rand() < 0.5) {
        return { type: ACTION.BET, amount: clamp(Math.max(1, pot * 0.3), bet.min, bet.max) };
      }
      if (p < 0.35 && rand() < 0.12) {
        // 순수 블러프 — 약한 패로 작게 찔러본다.
        return { type: ACTION.BET, amount: clamp(Math.max(1, pot * 0.4), bet.min, bet.max) };
      }
    }
    return check ? { type: ACTION.CHECK } : { type: ACTION.FOLD };
  }

  const odds = toCall / (pot + toCall); // 콜에 필요한 최소 승률
  const raise = pick(legal, ACTION.RAISE);
  const call = pick(legal, ACTION.CALL);

  if (raise && p > odds + 0.28 && p > 0.7 && rand() < 0.55) {
    const target = raise.min + (view.pot * 0.5);
    return { type: ACTION.RAISE, amount: clamp(target, raise.min, raise.max) };
  }
  if (call && (p >= odds || (toCall <= 1 && p > 0.3))) return { type: ACTION.CALL };
  const allIn = pick(legal, ACTION.ALL_IN);
  if (!call && allIn && p >= odds) return { type: ACTION.ALL_IN };
  return { type: ACTION.FOLD };
}

/* Choice 공개 — 선플레이어일 때. 두 장을 모두 보고 있으므로 "내가 갖고 싶은 쪽"을 계산한 뒤,
 * 상대가 가져가길 바라는 쪽을 앞면으로 깐다. 30% 는 반대로 깔아 읽히지 않게 한다.
 * (내가 X 를 가지면 상대는 반드시 Y 를 갖는다 — 상대 카드 한 장이 확정되므로 정확히 계산된다.) */
function decideReveal(view, rand) {
  const [cardA, cardB] = view.choice.cards;
  const community = ranksOf(view.community);
  const mine = ranksOf(view.you.hole);
  const counts = unseenCounts(view);

  const keepValue = (keep, give) => equity({
    community,
    mine: mine.concat([keep.rank]),
    theirs: [give.rank],
    counts,
  });

  const valueA = keepValue(cardA, cardB);
  const valueB = keepValue(cardB, cardA);
  const keep = valueA >= valueB ? cardA : cardB;
  const give = keep === cardA ? cardB : cardA;
  const bluff = rand() < 0.3;
  return { type: ACTION.REVEAL, cardId: bluff ? keep.id : give.id };
}

/* Choice 선택 — 후플레이어일 때. 공개 카드를 가져갈 때와 뒷면을 가져갈 때의 승률을 비교한다.
 * 공개 카드를 남기면 상대의 두 번째 카드가 확정되므로 그 정보까지 반영된다. */
function decideSelect(view, rand) {
  const revealed = view.choice.cards.find((c) => c.faceUp);
  const hidden = view.choice.cards.find((c) => !c.faceUp);
  const community = ranksOf(view.community);
  const mine = ranksOf(view.you.hole);
  const counts = unseenCounts(view);

  // 공개 카드를 가져간다 → 내 5장 확정, 상대는 미지의 뒷면 카드를 갖는다.
  const takeRevealed = equity({ community, mine: mine.concat([revealed.rank]), theirs: [], counts });
  // 뒷면을 가져간다 → 내 5번째는 미지수, 상대는 공개 카드를 갖는다.
  const takeHidden = equity({ community, mine, theirs: [revealed.rank], counts });

  const gap = takeRevealed - takeHidden;
  const wantRevealed = Math.abs(gap) < 0.02 ? rand() < 0.5 : gap > 0;
  return { type: ACTION.SELECT, cardId: wantRevealed ? revealed.id : hidden.id };
}

/* 봇의 다음 액션. view 는 반드시 viewFor(state, botId) 결과여야 한다.
 * 반환값에는 playerId 가 없으므로 호출부가 채워 넣는다. */
export function decide(view, rand = Math.random) {
  if (!view.legalActions.length) return null;
  if (view.choice && view.phase === PHASE.CHOICE_REVEAL) return decideReveal(view, rand);
  if (view.choice && view.phase === PHASE.CHOICE_SELECT) return decideSelect(view, rand);
  if (view.street) return decideBetting(view, rand);
  return { type: view.legalActions[0].type };
}
