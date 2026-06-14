/* Integration tests for the lab '같이하기' auto-pairing queue (lab_queue).
 *
 * Reuses the same hand-rolled DO mock approach as match-start.test.mjs: we
 * drive WorldChannel methods directly and assert on captured sends + the
 * proposal map. Verifies that lab_queue plugs into the EXISTING match pipeline
 * (proposal → match_proposal → _handleMatchStart → go_to_game).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorldChannel } from '../src/world.js';
import { PLAYER_STATUS } from '../src/matcher.js';
import { getLabZoneForGame, getZone, isLabZoneId } from '../src/worldZones.js';

const LAB_RUNNER = getLabZoneForGame('machine-animal-runner');

function makeWs(initialAttach = null) {
  let attachment = initialAttach;
  const sent = [];
  return {
    serializeAttachment(v) { attachment = v; },
    deserializeAttachment() { return attachment; },
    send(s) { sent.push(typeof s === 'string' ? JSON.parse(s) : s); },
    close() {},
    addEventListener() {},
    sent,
    setAttach(a) { attachment = a; },
    getAttach() { return attachment; },
  };
}

function makeState() {
  const sockets = [];
  return {
    sockets,
    getWebSockets() { return sockets; },
    blockConcurrencyWhile(fn) { return fn(); },
    storage: { setAlarm() { return Promise.resolve(); }, deleteAlarm() { return Promise.resolve(); } },
    acceptWebSocket() {},
  };
}

function makeEnv() {
  return {
    GAME_ROOM: {
      idFromName(name) { return { name }; },
      get() { return { fetch: async () => ({ ok: true, status: 200 }) }; },
    },
  };
}

function makeChannel() {
  const ch = new WorldChannel(makeState(), makeEnv());
  ch.loungeId = 'lounge-test';
  return { ch, state: ch.state };
}

// A roaming player standing in the (client-only) lab booth area — server sees
// them as ROAM (no physical zone there).
function makeRoamer(id, name) {
  const attach = {
    sessionId: id, name, characterId: 'peach_chick',
    x: 650, y: 280, dir: 'down', moving: false,
    status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null, lastMoveAt: 0,
  };
  const ws = makeWs(attach);
  return { ws, attach };
}

function findSent(ws, t) { return ws.sent.filter((m) => m.t === t); }
function labProposal(ch) {
  return [...ch.proposals.values()].find((p) => p.zoneId === LAB_RUNNER.id);
}

test('lab zone resolves + is flagged; getZone resolves the lab id', () => {
  assert.ok(LAB_RUNNER, 'runner has a lab match zone');
  assert.equal(LAB_RUNNER.gameId, 'machine-animal-runner');
  assert.equal(LAB_RUNNER.minPlayers, 2);
  assert.ok(isLabZoneId(LAB_RUNNER.id));
  assert.equal(getZone(LAB_RUNNER.id).id, LAB_RUNNER.id);
  assert.equal(getLabZoneForGame('mallang-stairs'), null, 'stairs is not lab-matchable');
});

test('lab_queue: single player becomes INTENT_READY in lab zone + gets a waiting proposal', async () => {
  const { ch, state } = makeChannel();
  const a = makeRoamer('a', 'Alice');
  state.sockets.push(a.ws);

  await ch._handleLabQueue(a.ws, a.attach, { gameId: 'machine-animal-runner' });

  const at = a.ws.getAttach();
  assert.equal(at.status, PLAYER_STATUS.INTENT_READY, 'queued = INTENT_READY immediately');
  assert.equal(at.currentZoneId, LAB_RUNNER.id);

  const p = labProposal(ch);
  assert.ok(p, 'a proposal was opened for the lab zone');
  assert.equal(p.gameId, 'machine-animal-runner');
  // Solo waiter sees the match modal (proposal) advertising min 2.
  assert.equal(findSent(a.ws, 'match_proposal').length, 1, 'waiting modal opened');
  assert.equal(findSent(a.ws, 'go_to_game').length, 0, 'no launch with only 1 player');
});

test('lab_queue: unsupported game → BAD_REQUEST, no proposal', async () => {
  const { ch, state } = makeChannel();
  const a = makeRoamer('a', 'Alice');
  state.sockets.push(a.ws);

  await ch._handleLabQueue(a.ws, a.attach, { gameId: 'mallang-stairs' });

  const errs = findSent(a.ws, 'error');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].d.code, 'BAD_REQUEST');
  assert.equal(labProposal(ch), undefined, 'no proposal created');
  assert.equal(a.ws.getAttach().status, PLAYER_STATUS.ROAM, 'status untouched');
});

test('lab_queue: two players pair → start launches both into the same room', async () => {
  const { ch, state } = makeChannel();
  const a = makeRoamer('a', 'Alice');
  const b = makeRoamer('b', 'Bob');
  state.sockets.push(a.ws, b.ws);

  await ch._handleLabQueue(a.ws, a.ws.getAttach(), { gameId: 'machine-animal-runner' });
  await ch._handleLabQueue(b.ws, b.ws.getAttach(), { gameId: 'machine-animal-runner' });

  const p = labProposal(ch);
  assert.ok(p, 'proposal exists');
  assert.equal(p.lastMemberIds.size, 2, 'both seated');

  // Alice clicks 시작.
  await ch._handleMatchStart(a.ws, a.ws.getAttach(), { matchId: p.matchId });

  // Both launched together; proposal consumed.
  assert.equal(ch.proposals.has(p.matchId), false, 'proposal deleted after launch');
  for (const w of [a.ws, b.ws]) {
    assert.equal(findSent(w, 'go_to_game').length, 1, 'launched');
    assert.equal(w.getAttach().status, PLAYER_STATUS.IN_GAME, 'flipped to in_game');
  }
  // URL carries from=world + players=2 → runner boots into co-op.
  const url = findSent(a.ws, 'go_to_game')[0].d.url;
  assert.match(url, /\/games\/machine-animal-runner\//);
  assert.match(url, /from=world/);
  assert.match(url, /players=2/);
});

test('move while lab-queued does NOT demote (position-based zone reassignment skipped)', async () => {
  const { ch, state } = makeChannel();
  const a = makeRoamer('a', 'Alice');
  state.sockets.push(a.ws);
  await ch._handleLabQueue(a.ws, a.ws.getAttach(), { gameId: 'machine-animal-runner' });

  // A small legal move (within MAX_JUMP_PX) while queued.
  await ch._handleMove(a.ws, a.ws.getAttach(), { x: 655, y: 285, dir: 'right', moving: true });

  const at = a.ws.getAttach();
  assert.equal(at.status, PLAYER_STATUS.INTENT_READY, 'still queued after moving');
  assert.equal(at.currentZoneId, LAB_RUNNER.id, 'still in lab zone');
  assert.equal(at.x, 655, 'position updated');
});
