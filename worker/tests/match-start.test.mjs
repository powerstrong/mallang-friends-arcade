/* Integration tests for the anyone-can-start + first-wins lock flow.
 *
 * Hand-rolled DO state mock so we can call WorldChannel methods directly.
 * The real DO runtime is irrelevant — we just need:
 *   - state.getWebSockets() returning the array we control
 *   - state.blockConcurrencyWhile(fn) just awaits fn()
 *   - state.storage.setAlarm/deleteAlarm noop
 *   - env.GAME_ROOM.idFromName + get(stub).fetch returning {ok: true}
 *
 * Each mock WebSocket carries an in-memory attachment + a captured-sends
 * array so we can assert what the server sent it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorldChannel } from '../src/world.js';
import { PLAYER_STATUS } from '../src/matcher.js';
import { getZone } from '../src/worldZones.js';

const JUMP = getZone('jump-climber');     // min=1, max=2
const SSEUK = getZone('sseuk-sseuk'); // min=2, max=6

function makeWs(initialAttach = null) {
  let attachment = initialAttach;
  const sent = [];
  return {
    serializeAttachment(v) { attachment = v; },
    deserializeAttachment() { return attachment; },
    send(s) { sent.push(typeof s === 'string' ? JSON.parse(s) : s); },
    close() { /* noop */ },
    addEventListener() { /* noop */ },
    sent, // test-only accessor
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
    storage: {
      setAlarm() { return Promise.resolve(); },
      deleteAlarm() { return Promise.resolve(); },
    },
    acceptWebSocket() { /* noop */ },
  };
}

function makeEnv(opts = {}) {
  return {
    GAME_ROOM: {
      idFromName(name) { return { name }; },
      get(id) {
        return {
          fetch: async () => ({ ok: !opts.gameRoomFail, status: opts.gameRoomFail ? 500 : 200 }),
        };
      },
    },
  };
}

function makeChannel(stateOverrides = {}, envOverrides = {}) {
  const state = { ...makeState(), ...stateOverrides };
  const env = { ...makeEnv(), ...envOverrides };
  const ch = new WorldChannel(state, env);
  ch.loungeId = 'lounge-test';
  return { ch, state, env };
}

function seedReady(ch, state, members, zone = JUMP) {
  /* members: array of { id, name, characterId } — all placed INTENT_READY in zone.
   * Returns { ws, attach } per member in order, and registers the proposal.
   */
  const now = Date.now();
  const out = [];
  for (const m of members) {
    const attach = {
      sessionId: m.id,
      name: m.name,
      characterId: m.characterId || 'peach_chick',
      x: 270, y: 520, dir: 'down', moving: false,
      status: PLAYER_STATUS.INTENT_READY,
      currentZoneId: zone.id,
      candidateSince: now - zone.holdMs - 100,
    };
    const ws = makeWs(attach);
    state.sockets.push(ws);
    out.push({ ws, attach });
  }
  // Hand-craft the proposal so _handleMatchStart finds it; mirror the shape
  // _syncProposalForZone would produce after the dwell tick.
  const proposal = {
    matchId: 'wm-test-0001',
    zoneId: zone.id,
    gameId: zone.gameId,
    hostId: members[0].id,
    lastMemberIds: new Set(members.map((m) => m.id)),
    createdAt: now,
    phase: null,
    startedBy: null,
  };
  ch.proposals.set(proposal.matchId, proposal);
  return { proposal, members: out };
}

function findSent(ws, t) {
  return ws.sent.filter((m) => m.t === t);
}

test('first-wins: two simultaneous clicks — only one launches, late click is silent', async () => {
  const { ch, state } = makeChannel();
  const { proposal, members } = seedReady(ch, state, [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ]);

  // Two clicks fired together. _handleMatchStart is async; the FIRST to hit
  // the synchronous body (before any await) claims phase='launching'. The
  // second sees phase and returns silently.
  const [r1, r2] = await Promise.all([
    ch._handleMatchStart(members[0].ws, members[0].attach, { matchId: proposal.matchId }),
    ch._handleMatchStart(members[1].ws, members[1].attach, { matchId: proposal.matchId }),
  ]);

  // Exactly one launch happened — proposal is gone from the map.
  assert.equal(ch.proposals.has(proposal.matchId), false, 'proposal deleted after launch');

  // Both members got go_to_game (everyone in the proposal launches together).
  assert.equal(findSent(members[0].ws, 'go_to_game').length, 1, 'A got go_to_game');
  assert.equal(findSent(members[1].ws, 'go_to_game').length, 1, 'B got go_to_game');

  // match_starting was broadcast once to each.
  assert.equal(findSent(members[0].ws, 'match_starting').length, 1, 'A got match_starting');
  assert.equal(findSent(members[1].ws, 'match_starting').length, 1, 'B got match_starting');

  // Neither got an error — late click is silent ok.
  assert.equal(findSent(members[0].ws, 'error').length, 0);
  assert.equal(findSent(members[1].ws, 'error').length, 0);
});

test('MIN_PLAYERS recheck: click after a member dropped — unstarting broadcast + error', async () => {
  const { ch, state } = makeChannel();
  // Use SSEUK (min=2) so dropping B to CANDIDATE actually breaks the floor.
  const { proposal, members } = seedReady(ch, state, [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ], SSEUK);
  // After the modal was advertised, B's status drifts to CANDIDATE (e.g. joystick
  // jitter pushed them past the edge). lastMemberIds still contains them, but
  // the seated-recheck loop will reject (only A is INTENT_READY, min=2).
  members[1].ws.setAttach({ ...members[1].attach, status: PLAYER_STATUS.CANDIDATE });

  await ch._handleMatchStart(members[0].ws, members[0].attach, { matchId: proposal.matchId });

  // Phase rolled back, proposal still alive (members may rejoin).
  const stillProposal = ch.proposals.get(proposal.matchId);
  assert.ok(stillProposal, 'proposal kept alive');
  assert.equal(stillProposal.phase, null, 'phase rolled back');
  assert.equal(stillProposal.startedBy, null);

  // Clicker got MIN_PLAYERS error.
  const errs = findSent(members[0].ws, 'error');
  assert.equal(errs.length, 1, 'one error sent to clicker');
  assert.equal(errs[0].d.code, 'MIN_PLAYERS');

  // Both members got match_starting (the optimistic lock) AND match_unstarting
  // (the rollback) — modal locked then released.
  for (const m of members) {
    assert.equal(findSent(m.ws, 'match_starting').length, 1, 'starting sent');
    assert.equal(findSent(m.ws, 'match_unstarting').length, 1, 'unstarting sent');
  }

  // No go_to_game.
  assert.equal(findSent(members[0].ws, 'go_to_game').length, 0);
});

test('NO_PROPOSAL: click after proposal vanished — explicit error, no broadcast', async () => {
  const { ch, state } = makeChannel();
  const { members } = seedReady(ch, state, [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ]);
  // Server already cleaned up the proposal (e.g. zone emptied between syncs).
  ch.proposals.clear();

  await ch._handleMatchStart(members[0].ws, members[0].attach, { matchId: 'wm-test-0001' });

  const errs = findSent(members[0].ws, 'error');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].d.code, 'NO_PROPOSAL');
  // No starting/unstarting broadcast — nothing to lock.
  assert.equal(findSent(members[1].ws, 'match_starting').length, 0);
});

test('NOT_MEMBER: clicker is not in lastMemberIds (e.g. over-cap waiter)', async () => {
  const { ch, state } = makeChannel();
  const { proposal, members } = seedReady(ch, state, [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ]);
  // Drop B from lastMemberIds — simulating a stale-UI click from someone who
  // was demoted out of the seated set.
  proposal.lastMemberIds = new Set(['a']);

  await ch._handleMatchStart(members[1].ws, members[1].attach, { matchId: proposal.matchId });

  const errs = findSent(members[1].ws, 'error');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].d.code, 'NOT_MEMBER');
  // No state mutation.
  assert.equal(ch.proposals.get(proposal.matchId).phase, null);
});

test('_syncProposalForZone is a no-op while phase=launching', async () => {
  const { ch, state } = makeChannel();
  const { proposal, members } = seedReady(ch, state, [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ]);
  // Simulate: lock is held, launch is mid-await. A new player walks into the zone.
  proposal.phase = 'launching';
  proposal.startedBy = 'a';

  const newWs = makeWs({
    sessionId: 'c', name: 'Carol', characterId: 'mochi_rabbit',
    x: 270, y: 520, dir: 'down', moving: false,
    status: PLAYER_STATUS.INTENT_READY,
    currentZoneId: JUMP.id,
    candidateSince: Date.now() - JUMP.holdMs - 50,
  });
  state.sockets.push(newWs);

  await ch._syncProposalForZone(JUMP.id, Date.now());

  // Proposal unchanged — phase still 'launching', no new member added.
  const p = ch.proposals.get(proposal.matchId);
  assert.equal(p.phase, 'launching');
  assert.equal(p.lastMemberIds.has('c'), false, 'new arrival not added during launch');
  // Carol gets no match_proposal — wouldn't be fair, the existing one is mid-flight.
  assert.equal(findSent(newWs, 'match_proposal').length, 0);
});

test('over-cap: 3 READY, maxPlayers=2 — only top 2 seated launch, third is silent', async () => {
  // JUMP zone: min=1, max=2. We seat A+B as the advertised proposal members
  // (lastMemberIds = {A, B}); C is INTENT_READY in the same zone but NOT in
  // lastMemberIds — simulating an over-cap waiter (3+ ready, but only 2 seats).
  const { ch, state } = makeChannel();
  const { proposal, members } = seedReady(ch, state, [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ], JUMP);
  // C arrives later — INTENT_READY in zone but later candidateSince, so the
  // seated-recheck sort still puts A,B first.
  const cAttach = {
    sessionId: 'c', name: 'Carol', characterId: 'mochi_rabbit',
    x: 270, y: 520, dir: 'down', moving: false,
    status: PLAYER_STATUS.INTENT_READY,
    currentZoneId: JUMP.id,
    candidateSince: Date.now(), // newest — sorts last
  };
  const cWs = makeWs(cAttach);
  state.sockets.push(cWs);

  await ch._handleMatchStart(members[0].ws, members[0].attach, { matchId: proposal.matchId });

  // A + B launched, C did not.
  assert.equal(findSent(members[0].ws, 'go_to_game').length, 1, 'A launched');
  assert.equal(findSent(members[1].ws, 'go_to_game').length, 1, 'B launched');
  assert.equal(findSent(cWs, 'go_to_game').length, 0, 'C did not launch (over-cap)');

  // C also did not get match_starting broadcast (broadcast targets lastMemberIds only).
  assert.equal(findSent(cWs, 'match_starting').length, 0);
  assert.equal(findSent(members[0].ws, 'match_starting').length, 1);
});

test('GameRoom seed failure: phase rolled back + unstarting broadcast + cancel', async () => {
  const { ch, state } = makeChannel({}, { GAME_ROOM: {
    idFromName(n) { return { n }; },
    get() { return { fetch: async () => ({ ok: false, status: 500 }) }; },
  }});
  const { proposal, members } = seedReady(ch, state, [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ]);

  await ch._handleMatchStart(members[0].ws, members[0].attach, { matchId: proposal.matchId });

  // Both got starting then unstarting then cancelled — modal must release.
  for (const m of members) {
    assert.equal(findSent(m.ws, 'match_starting').length, 1);
    assert.equal(findSent(m.ws, 'match_unstarting').length, 1);
    assert.equal(findSent(m.ws, 'match_cancelled').length, 1, 'cancel for cleanup');
    assert.equal(findSent(m.ws, 'go_to_game').length, 0, 'no navigate on seed failure');
  }
  // Proposal gone.
  assert.equal(ch.proposals.has(proposal.matchId), false);
});
