/* 4자리 방 코드는 재사용된다(POST /api/rooms → DO /init). 재사용 시 이전 방의 잔여 상태가
 * 남아 있으면 새 손님이 남의 판을 물려받고, 옛 좌석 토큰 보유자가 그 자리로 돌아온다.
 * "/init 이 방과 방 사이의 경계"라는 계약을 지키는지 검증한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { GameRoom } = await import(new URL('../src/room.js', import.meta.url));

function createSocket(id, name) {
  let attachment = { id, name };
  return {
    open: true,
    sent: [],
    send(text) { this.sent.push(JSON.parse(text)); },
    deserializeAttachment: () => attachment,
    serializeAttachment: (next) => { attachment = next; },
    last(event) { return [...this.sent].reverse().find((m) => m.type === 'mod' && m.event === event) || null; },
  };
}

function createRoom() {
  const sockets = [];
  const data = new Map();
  const state = {
    getWebSockets: () => sockets.filter((s) => s.open),
    storage: {
      async get(key) { return data.get(key); },
      async put(key, value) { data.set(key, structuredClone(value)); },
      async delete(key) { data.delete(key); },
      async deleteAll() { data.clear(); },
    },
  };
  return { room: new GameRoom(state, {}), sockets, data };
}

async function joinChoiceHoldem(room, sockets, socket) {
  sockets.push(socket);
  await room._handleModuleJoinGame(socket, { gameId: 'choice-holdem', name: socket.deserializeAttachment().name });
}

function initRequest(code) {
  return new Request('https://example.com/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

test('연결이 살아 있는 방은 /init 이 409 로 거절한다(코드 재추첨)', async () => {
  const { room, sockets } = createRoom();
  await joinChoiceHoldem(room, sockets, createSocket('c1', '앨리스'));
  const res = await room.fetch(initRequest('1234'));
  assert.equal(res.status, 409);
});

test('재사용된 방 코드는 이전 판·좌석 토큰을 물려주지 않는다', async () => {
  const { room, sockets, data } = createRoom();
  const a = createSocket('c1', '앨리스');
  const b = createSocket('c2', '밥');
  await joinChoiceHoldem(room, sockets, a);
  await joinChoiceHoldem(room, sockets, b);

  const oldToken = a.last('seated').token;
  assert.ok(oldToken, '전제: 좌석 토큰이 발급된다');
  assert.ok(a.last('state').view, '전제: 두 명이 앉으면 판이 시작된다');
  assert.ok(data.size > 0, '전제: 판이 storage 에 남는다(하이버네이션 대비)');

  // 둘 다 나가서 방이 비었다 → 이 코드가 새 방으로 다시 발급된다.
  a.open = false;
  b.open = false;
  const res = await room.fetch(initRequest('1234'));
  assert.equal(res.status, 200);
  assert.deepEqual([...data.keys()], ['code'], '이전 방의 저장 상태는 남지 않는다');
  assert.equal(room.moduleGames.size, 0, 'in-memory 모듈 상태도 비워진다');

  // 새 손님이 옛 토큰을 들고 와도 남의 좌석·판을 되찾을 수 없다.
  const c = createSocket('c3', '이전 사람');
  sockets.push(c);
  await room._handleModuleJoinGame(c, { gameId: 'choice-holdem', name: '이전 사람', token: oldToken });
  const seated = c.last('seated');
  assert.ok(seated, '빈 자리에 새로 앉는다');
  assert.notEqual(seated.token, oldToken, '옛 토큰이 되살아나지 않는다');
  assert.equal(seated.seatId, 'p0', '이전 좌석 배치가 아니라 첫 자리부터 다시 채운다');
  assert.equal(c.last('state').view, null, '혼자이므로 판은 아직 없다 — 이전 판이 복원되지 않았다');
});

test('모듈 storage 는 게임별 네임스페이스로 격리된다', async () => {
  const { room, data } = createRoom();
  const ctx = room._moduleCtx('choice-holdem');
  await ctx.storage.put('k', 1);
  // 접두사로 모아 둬야 코어가 "이 방이 남긴 모듈 상태"를 통째로 지울 수 있다.
  assert.equal(data.get('mod:choice-holdem:k'), 1);
  assert.equal(await ctx.storage.get('k'), 1);
  assert.equal(await room._moduleCtx('machine-animal-runner').storage.get('k'), undefined, '다른 게임의 키를 읽지 않는다');
  await ctx.storage.delete('k');
  assert.equal(data.has('mod:choice-holdem:k'), false);
});
