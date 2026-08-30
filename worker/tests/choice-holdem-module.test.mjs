/* 초이스 홀덤 서버 모듈 — 히든 정보·좌석 신원·재접속 검증.
 * GameRoom 없이 ctx/ws 를 흉내 내 모듈만 단독으로 돌린다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { choiceHoldem } from '../src/games/choice_holdem.js';
import { PHASE, ACTION } from '../../games/choice-holdem/engine/choice-holdem.js';

/* ── 가짜 방 ─────────────────────────────────────────────────────────────── */

function makeRoom() {
  const sessions = [];
  const storage = new Map();
  const state = {};
  const ctx = {
    gameId: 'choice-holdem',
    state,
    storage: {
      get: async (k) => storage.get(k),
      put: async (k, v) => { storage.set(k, structuredClone(v)); },
      delete: async (k) => { storage.delete(k); },
    },
    // 진짜 ctx.sessions() 는 {ws, player} 쌍을 준다 — 그 계약을 그대로 흉내 낸다.
    sessions: () => sessions.filter((s) => s.open).map((ws) => ({ ws, player: ws.player })),
    roster: () => sessions.filter((s) => s.open).map((ws) => ({ id: ws.player.id, name: ws.player.name })),
    broadcast: (m) => { for (const s of sessions) if (s.open) s.inbox.push(structuredClone(m)); },
    sendTo: (target, m) => { if (target.open) target.inbox.push(structuredClone(m)); },
  };

  let n = 0;
  function connect(name) {
    const player = { id: `conn${++n}`, name, gameId: 'choice-holdem', mode: 'module' };
    const ws = {
      open: true,
      player,
      inbox: [],
      deserializeAttachment: () => player,
      last(event) { return [...ws.inbox].reverse().find((m) => m.event === event) || null; },
      drain() { const out = ws.inbox; ws.inbox = []; return out; },
    };
    sessions.push(ws);
    return ws;
  }
  function disconnect(ws) { ws.open = false; }

  return { ctx, connect, disconnect, sessions };
}

async function seatTwo() {
  const room = makeRoom();
  const a = room.connect('앨리스');
  const b = room.connect('밥');
  await choiceHoldem.onJoin(room.ctx, a, {});
  await choiceHoldem.onJoin(room.ctx, b, {});
  return { room, a, b };
}

function viewOf(ws) {
  const msg = ws.last('state');
  return msg ? msg.view : null;
}

async function act(room, ws, action) {
  await choiceHoldem.onMessage(room.ctx, ws, { a: 'action', action });
}

/* 지금 차례인 쪽의 연결을 돌려준다. */
function turnOf(room, a, b) {
  const view = viewOf(a);
  if (!view || !view.street) return null;
  return view.street.turn === view.you.id ? a : b;
}

/* ── 좌석·시작 ───────────────────────────────────────────────────────────── */

test('두 명이 앉으면 게임이 시작되고 각자 자기 뷰를 받는다', async () => {
  const { a, b } = await seatTwo();
  const va = viewOf(a);
  const vb = viewOf(b);
  assert.equal(va.phase, PHASE.BETTING_1);
  assert.equal(va.you.id, 'p0');
  assert.equal(vb.you.id, 'p1');
  assert.equal(va.you.chips, 19);
  assert.equal(va.community.length, 3);
  assert.equal(va.you.hole.length, 1);
});

test('세 번째 연결은 관전 없이 full 로 거절된다', async () => {
  const { room } = await seatTwo();
  const c = room.connect('난입');
  await choiceHoldem.onJoin(room.ctx, c, {});
  assert.ok(c.last('full'), 'full 이벤트가 없다');
  assert.equal(c.last('state'), null, '관전자에게 뷰를 보내면 안 된다');
});

/* ── 히든 정보 (명세 §35) ────────────────────────────────────────────────── */

test('상대 개인 카드 숫자는 어느 메시지에도 실리지 않는다', async () => {
  const { a, b } = await seatTwo();
  const vb = viewOf(b);
  assert.deepEqual(vb.opponent.hole.map((c) => c.rank), [null]);
  // b 가 받은 모든 메시지를 통째로 뒤져 a 의 카드 id 가 숫자와 함께 나오는지 확인
  const aHoleId = viewOf(a).you.hole[0].id;
  const dump = JSON.stringify(b.inbox);
  const leaked = new RegExp(`"id":"${aHoleId}","rank":[0-9]`).test(dump);
  assert.equal(leaked, false, '상대 개인 카드 숫자가 전송됐다');
});

test('Choice 뒷면 카드 숫자는 후플레이어에게 전송되지 않는다', async () => {
  const { room, a, b } = await seatTwo();
  // 1차 베팅을 체크-체크로 넘긴다
  await act(room, turnOf(room, a, b), { type: ACTION.CHECK });
  await act(room, turnOf(room, a, b), { type: ACTION.CHECK });

  const va = viewOf(a);
  const first = va.isFirstPlayer ? a : b;
  const second = first === a ? b : a;
  assert.equal(viewOf(first).phase, PHASE.CHOICE_REVEAL);
  assert.deepEqual(
    viewOf(second).choice.cards.map((c) => c.rank), [null, null],
    '후플레이어가 공개 전에 Choice 카드 숫자를 받았다'
  );
  assert.equal(viewOf(first).choice.cards.every((c) => c.rank != null), true);

  const revealId = viewOf(first).choice.cards[0].id;
  second.drain();
  await act(room, first, { type: ACTION.REVEAL, cardId: revealId });

  const cards = viewOf(second).choice.cards;
  assert.equal(cards.find((c) => c.faceUp).rank != null, true, '공개 카드는 보여야 한다');
  assert.equal(cards.find((c) => !c.faceUp).rank, null, '뒷면 카드 숫자가 전송됐다');
  const hiddenId = cards.find((c) => !c.faceUp).id;
  assert.equal(
    new RegExp(`"id":"${hiddenId}","rank":[0-9]`).test(JSON.stringify(second.inbox)), false,
    '뒷면 카드 숫자가 다른 메시지로 새어나갔다'
  );
});

test('좌석 토큰은 그 좌석에게만 가고 상대에게는 절대 가지 않는다', async () => {
  const { a, b } = await seatTwo();
  const tokenA = a.last('seated').token;
  const tokenB = b.last('seated').token;
  assert.ok(tokenA && tokenB && tokenA !== tokenB);
  assert.equal(JSON.stringify(b.inbox).includes(tokenA), false, 'b 에게 a 의 토큰이 갔다');
  assert.equal(JSON.stringify(a.inbox).includes(tokenB), false, 'a 에게 b 의 토큰이 갔다');
});

/* ── 좌석 = 신원 (명세 §36) ──────────────────────────────────────────────── */

test('playerId 를 위조해도 상대 대신 액션할 수 없다', async () => {
  const { room, a, b } = await seatTwo();
  const turn = turnOf(room, a, b);
  const idle = turn === a ? b : a;
  idle.drain();
  // 자기 차례가 아닌 쪽이 상대 좌석 id 를 실어 보낸다 — 서버가 좌석으로 덮어쓰므로 거절돼야 한다.
  await choiceHoldem.onMessage(room.ctx, idle, {
    a: 'action',
    action: { type: ACTION.CHECK, playerId: viewOf(turn).you.id },
  });
  assert.equal(idle.last('reject').code, 'NOT_YOUR_TURN');
});

test('후플레이어가 대신 공개하거나 선플레이어가 대신 선택할 수 없다', async () => {
  const { room, a, b } = await seatTwo();
  await act(room, turnOf(room, a, b), { type: ACTION.CHECK });
  await act(room, turnOf(room, a, b), { type: ACTION.CHECK });
  const first = viewOf(a).isFirstPlayer ? a : b;
  const second = first === a ? b : a;

  const cardId = viewOf(first).choice.cards[0].id;
  second.drain();
  await act(room, second, { type: ACTION.REVEAL, cardId });
  assert.equal(second.last('reject').code, 'NOT_FIRST_PLAYER');

  await act(room, first, { type: ACTION.REVEAL, cardId });
  first.drain();
  await act(room, first, { type: ACTION.SELECT, cardId });
  assert.equal(first.last('reject').code, 'NOT_SECOND_PLAYER');
});

test('좌석이 없는 연결의 액션은 거절된다', async () => {
  const { room } = await seatTwo();
  const c = room.connect('난입');
  await choiceHoldem.onJoin(room.ctx, c, {});
  await choiceHoldem.onMessage(room.ctx, c, { a: 'action', action: { type: ACTION.CHECK } });
  assert.equal(c.last('reject').code, 'NO_SEAT');
});

/* ── 재접속 · 진행 ───────────────────────────────────────────────────────── */

test('토큰으로 재접속하면 같은 좌석과 같은 패로 돌아온다', async () => {
  const { room, a, b } = await seatTwo();
  const token = a.last('seated').token;
  const holeBefore = viewOf(a).you.hole.map((c) => c.rank);

  await choiceHoldem.onLeave(room.ctx, a.player);
  room.disconnect(a);
  assert.equal(viewOf(b).opponent.chips, 19, '상대가 끊겨도 판은 유지된다');

  const again = room.connect('앨리스');
  await choiceHoldem.onJoin(room.ctx, again, { token });
  const back = viewOf(again);
  assert.equal(back.you.id, 'p0');
  assert.deepEqual(back.you.hole.map((c) => c.rank), holeBefore);
  assert.equal(back.phase, PHASE.BETTING_1);
});

test('토큰 없이 재접속하면 남의 자리를 뺏지 못한다', async () => {
  const { room, a } = await seatTwo();
  await choiceHoldem.onLeave(room.ctx, a.player);
  room.disconnect(a);
  const stranger = room.connect('낯선사람');
  await choiceHoldem.onJoin(room.ctx, stranger, {});
  assert.ok(stranger.last('full'), '진행 중인 좌석이 토큰 없이 넘어갔다');
});

test('다음 라운드는 양쪽이 모두 눌러야 진행된다', async () => {
  const { room, a, b } = await seatTwo();
  // 폴드로 라운드를 빨리 끝낸다
  await act(room, turnOf(room, a, b), { type: ACTION.FOLD });
  assert.equal(viewOf(a).phase, PHASE.SETTLEMENT);

  await choiceHoldem.onMessage(room.ctx, a, { a: 'next' });
  assert.equal(viewOf(a).phase, PHASE.SETTLEMENT, '한 명만 눌렀는데 넘어갔다');
  assert.deepEqual(a.last('state').ready, [viewOf(a).you.id]);

  await choiceHoldem.onMessage(room.ctx, b, { a: 'next' });
  assert.equal(viewOf(a).round, 2);
  assert.equal(viewOf(a).phase, PHASE.BETTING_1);
});

test('상대가 끊겨 있으면 혼자서도 다음 라운드로 갈 수 있다', async () => {
  const { room, a, b } = await seatTwo();
  await act(room, turnOf(room, a, b), { type: ACTION.FOLD });
  await choiceHoldem.onLeave(room.ctx, b.player);
  room.disconnect(b);
  await choiceHoldem.onMessage(room.ctx, a, { a: 'next' });
  assert.equal(viewOf(a).round, 2);
});

test('하이버네이션으로 in-memory 가 날아가도 storage 에서 판이 복원된다', async () => {
  const { room, a, b } = await seatTwo();
  const round1Hole = viewOf(a).you.hole.map((c) => c.rank);
  // DO 인스턴스 재생성 흉내 — ctx.state 를 비운다.
  for (const key of Object.keys(room.ctx.state)) delete room.ctx.state[key];
  a.drain();
  await choiceHoldem.onMessage(room.ctx, a, { a: 'sync' });
  assert.deepEqual(viewOf(a).you.hole.map((c) => c.rank), round1Hole);
  assert.equal(viewOf(b) != null, true);
});
