/* 초이스 홀덤 — 2인 서버 권위 모듈.
 *
 * 규칙 엔진은 games/choice-holdem/engine/choice-holdem.js 하나뿐이고, 브라우저(실험실 솔로)와
 * 이 워커가 같은 파일을 쓴다(wrangler 가 번들에 포함). 규칙이 두 벌로 갈라지지 않는다.
 *
 * 이 모듈이 책임지는 것 — 엔진이 못 하는 것들:
 *  1) 히든 정보. 클라로 나가는 모든 상태는 viewFor(state, seatId) 를 거친다. 덱·상대 개인 카드·
 *     Choice 뒷면 숫자는 애초에 전송되지 않는다(UI 마스킹은 개발자 도구로 뚫린다 — 명세 §35).
 *  2) 좌석 = 신원. 액션의 playerId 는 클라가 보낸 값을 쓰지 않고 연결의 좌석으로 덮어쓴다.
 *     "남의 차례에 대신 액션" / "상대 대신 Choice 선택" 이 프로토콜 수준에서 불가능하다.
 *  3) 재접속. 좌석 토큰(서버 발급, 그 좌석에만 전송)으로 같은 자리에 돌아온다. 모바일에서
 *     화면 잠금·네트워크 끊김으로 판이 통째로 날아가는 것을 막는다.
 *  4) 영속. 하이버네이션 DO 는 ws 가 살아있어도 in-memory 가 사라지므로 매 변화마다 storage 에 쓴다.
 *
 * 좌석 id 는 공개값('p0'/'p1')이다. 토큰을 엔진 playerId 로 쓰면 상대 뷰의 opponent.id 로
 * 남의 토큰이 새어나가므로 절대 그렇게 하지 않는다.
 *
 * 프로토콜 (클라 → {type:'mod', payload}):
 *   { a:'action', action:{ type, amount?, cardId? } }   베팅/공개/선택
 *   { a:'next' }      라운드 정산 후 "다음 라운드" — 양쪽이 눌러야 진행(상대가 끊겼으면 혼자서도)
 *   { a:'rematch' }   게임 종료 후 재대결
 *   { a:'sync' }      재접속 직후 현재 뷰 요청
 * 서버 → 클라:
 *   { event:'seated', token, seatId }   좌석 배정(그 좌석에만, 토큰 포함)
 *   { event:'state', view, seats, ready, phase }  좌석별 뷰 — 개인 전송
 *   { event:'log', events }             공개 이벤트(모두에게 공개된 정보만 담긴다)
 *   { event:'full' } / { event:'reject', code, message }
 */
import {
  PHASE, ACTION, createGame, applyAction, viewFor,
} from '../../../games/choice-holdem/engine/choice-holdem.js';

const SKEY = 'choiceHoldem:v1';
const SEAT_IDS = ['p0', 'p1'];

function send(ctx, ws, event, extra) {
  ctx.sendTo(ws, { type: 'mod', event, ...extra });
}

function newSeed() {
  return crypto.getRandomValues(new Int32Array(1))[0];
}

function newToken() {
  return crypto.randomUUID();
}

/* ── 상태 로드·영속 ──────────────────────────────────────────────────────────
 * 하이버네이션으로 인스턴스가 재생성돼도 판이 이어지도록 매 변화마다 저장한다. */
async function load(ctx) {
  const st = ctx.state;
  if (Array.isArray(st.seats)) return st;
  st.seats = [];
  st.game = null;
  st.ready = {};
  st.rematch = {};
  if (ctx.storage) {
    try {
      const saved = await ctx.storage.get(SKEY);
      if (saved && Array.isArray(saved.seats)) Object.assign(st, saved);
    } catch { /* storage 불가 — in-memory 로만 진행 */ }
  }
  return st;
}

async function persist(ctx) {
  if (!ctx.storage) return;
  const st = ctx.state;
  try {
    await ctx.storage.put(SKEY, { seats: st.seats, game: st.game, ready: st.ready, rematch: st.rematch });
  } catch { /* 다음 persist 가 복구 */ }
}

/* 토큰은 절대 밖으로 내보내지 않는다 — 남의 토큰을 알면 그 좌석으로 재접속할 수 있다. */
function publicSeats(st) {
  return st.seats.map((seat, i) => ({
    seatId: SEAT_IDS[i],
    name: seat.name,
    connected: !!seat.connected,
  }));
}

function seatIndexByConn(st, connId) {
  return st.seats.findIndex((seat) => seat.connId === connId);
}

function wsForSeat(ctx, seat) {
  const found = ctx.sessions().find(({ player }) => player.id === seat.connId);
  return found ? found.ws : null;
}

/* 좌석별로 "그 좌석이 봐도 되는 것"만 보낸다. 브로드캐스트로 판 상태를 뿌리면 안 된다. */
function pushViews(ctx, st) {
  const seats = publicSeats(st);
  for (let i = 0; i < st.seats.length; i++) {
    const ws = wsForSeat(ctx, st.seats[i]);
    if (!ws) continue;
    send(ctx, ws, 'state', {
      you: SEAT_IDS[i],
      seats,
      ready: SEAT_IDS.filter((id) => st.ready[id]),
      view: st.game ? viewFor(st.game, SEAT_IDS[i]) : null,
    });
  }
}

/* 엔진 이벤트는 설계상 전부 공개 정보다(카드 숫자가 실리는 것은 공용 카드·앞면 공개 카드·
 * 쇼다운 결과뿐). 그래서 그대로 브로드캐스트해도 히든 정보가 새지 않는다. */
function pushLog(ctx, events) {
  if (!events || !events.length) return;
  ctx.broadcast({ type: 'mod', event: 'log', events });
}

function startGame(st) {
  st.game = createGame({
    players: [
      { id: SEAT_IDS[0], name: st.seats[0].name },
      { id: SEAT_IDS[1], name: st.seats[1].name },
    ],
    seed: newSeed(),
  });
  st.ready = {};
  st.rematch = {};
  const res = applyAction(st.game, { type: ACTION.START, playerId: SEAT_IDS[0] });
  st.game = res.state;
  return res.events;
}

export const choiceHoldem = {
  id: 'choice-holdem',

  async onJoin(ctx, ws, msg) {
    const st = await load(ctx);
    const me = ws.deserializeAttachment();
    const name = (me && me.name) || '플레이어';
    const token = typeof msg?.token === 'string' ? msg.token : null;

    // 1) 토큰 재접속 — 같은 좌석으로 복귀.
    let index = token ? st.seats.findIndex((seat) => seat.token === token) : -1;
    if (index >= 0) {
      st.seats[index].connId = me.id;
      st.seats[index].connected = true;
      st.seats[index].name = name;
    } else if (st.seats.length < 2) {
      // 2) 빈 자리 배정 — 토큰은 이 좌석에게만 보낸다.
      index = st.seats.length;
      st.seats.push({ token: newToken(), connId: me.id, name, connected: true });
      send(ctx, ws, 'seated', { seatId: SEAT_IDS[index], token: st.seats[index].token });
    } else {
      // 3) 2인 전용 — 관전은 없다(관전자에게 보낼 안전한 뷰가 없다).
      send(ctx, ws, 'full', {});
      return;
    }

    let events = [];
    if (!st.game && st.seats.length === 2) events = startGame(st);

    await persist(ctx);
    pushLog(ctx, events);
    pushViews(ctx, st);
  },

  async onMessage(ctx, ws, payload) {
    const st = await load(ctx);
    const me = ws.deserializeAttachment();
    const index = seatIndexByConn(st, me?.id);
    if (index < 0) {
      send(ctx, ws, 'reject', { code: 'NO_SEAT', message: '이 방의 좌석이 아닙니다.' });
      return;
    }
    const seatId = SEAT_IDS[index];
    const other = SEAT_IDS[1 - index];
    const a = payload && payload.a;

    if (a === 'sync') {
      pushViews(ctx, st);
      return;
    }

    if (a === 'action') {
      if (!st.game) return;
      const action = payload.action || {};
      // playerId 는 클라 값을 무시하고 좌석으로 덮어쓴다 — 남의 차례를 대신 둘 수 없다.
      const res = applyAction(st.game, {
        type: action.type,
        amount: action.amount,
        cardId: action.cardId,
        playerId: seatId,
      });
      if (res.error) {
        send(ctx, ws, 'reject', res.error);
        return;
      }
      st.game = res.state;
      st.ready = {};
      await persist(ctx);
      pushLog(ctx, res.events);
      pushViews(ctx, st);
      return;
    }

    if (a === 'next') {
      if (!st.game || st.game.phase !== PHASE.SETTLEMENT) return;
      st.ready[seatId] = true;
      // 양쪽이 눌러야 다음 라운드로 간다. 상대가 끊겨 있으면 혼자서도 진행할 수 있다.
      const opponentSeat = st.seats[1 - index];
      const soloOk = !opponentSeat || !opponentSeat.connected;
      if (st.ready[other] || soloOk) {
        const res = applyAction(st.game, { type: ACTION.NEXT_ROUND, playerId: seatId });
        if (!res.error) {
          st.game = res.state;
          st.ready = {};
          await persist(ctx);
          pushLog(ctx, res.events);
          pushViews(ctx, st);
          return;
        }
      }
      await persist(ctx);
      pushViews(ctx, st);
      return;
    }

    if (a === 'rematch') {
      if (!st.game || st.game.phase !== PHASE.GAME_OVER) return;
      st.rematch[seatId] = true;
      const opponentSeat = st.seats[1 - index];
      const soloOk = !opponentSeat || !opponentSeat.connected;
      if ((st.rematch[other] || soloOk) && st.seats.length === 2) {
        const events = startGame(st);
        await persist(ctx);
        pushLog(ctx, events);
        pushViews(ctx, st);
        return;
      }
      await persist(ctx);
      ctx.broadcast({ type: 'mod', event: 'rematch_wait', seatId });
      return;
    }
  },

  async onLeave(ctx, player) {
    const st = await load(ctx);
    const index = seatIndexByConn(st, player?.id);
    if (index < 0) return;
    if (!st.game) {
      // 아직 시작 전이면 자리를 비워 다른 사람이 앉을 수 있게 한다.
      st.seats.splice(index, 1);
    } else {
      // 진행 중이면 좌석을 남겨 둔다 — 토큰으로 같은 자리에 돌아올 수 있다.
      st.seats[index].connected = false;
      st.seats[index].connId = null;
    }
    await persist(ctx);
    pushViews(ctx, st);
    ctx.broadcast({ type: 'mod', event: 'seats', seats: publicSeats(st) });
  },
};
