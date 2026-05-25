import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAYER_STATUS, applyZonePresence, compareReadyForSeat } from '../src/matcher.js';
import { GAME_ZONES, getZone, findZoneAt, pointInRect } from '../src/worldZones.js';
import { CHARACTERS, isValidCharacterId, toGameCharacterId, pickGameCharacter } from '../src/characters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOLD = 3000;
const JUMP = getZone('jump-climber');
const QUIZ = getZone('mallang-quiz-battle');

function fresh(id, overrides = {}) {
  return { id, status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null, ...overrides };
}

// ── applyZonePresence ───────────────────────────────────────────────────────

test('roam player stepping into a zone becomes candidate', () => {
  const next = applyZonePresence(fresh('a'), JUMP, 1000, HOLD);
  assert.equal(next.status, PLAYER_STATUS.CANDIDATE);
  assert.equal(next.currentZoneId, 'jump-climber');
  assert.equal(next.candidateSince, 1000);
});

test('candidate that has not held long enough stays candidate', () => {
  const after1s = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.CANDIDATE, currentZoneId: 'jump-climber', candidateSince: 1000 },
    JUMP, 2999, HOLD
  );
  assert.equal(after1s.status, PLAYER_STATUS.CANDIDATE);
});

test('candidate that has held >= holdMs becomes intent_ready', () => {
  const ready = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.CANDIDATE, currentZoneId: 'jump-climber', candidateSince: 1000 },
    JUMP, 4000, HOLD
  );
  assert.equal(ready.status, PLAYER_STATUS.INTENT_READY);
});

test('intent_ready player stays intent_ready while inside the zone', () => {
  const stay = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'jump-climber', candidateSince: 1000 },
    JUMP, 9000, HOLD
  );
  assert.equal(stay.status, PLAYER_STATUS.INTENT_READY);
});

test('leaving the zone immediately demotes any non-proposed status', () => {
  const out = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'jump-climber', candidateSince: 1000 },
    null, 5000, HOLD
  );
  assert.equal(out.status, PLAYER_STATUS.ROAM);
  assert.equal(out.currentZoneId, null);
  assert.equal(out.candidateSince, null);
});

test('switching zones resets the candidate timer', () => {
  const switched = applyZonePresence(
    { id: 'a', status: PLAYER_STATUS.INTENT_READY, currentZoneId: 'jump-climber', candidateSince: 1000 },
    QUIZ, 5000, HOLD
  );
  assert.equal(switched.status, PLAYER_STATUS.CANDIDATE);
  assert.equal(switched.currentZoneId, 'mallang-quiz-battle');
  assert.equal(switched.candidateSince, 5000);
});

test('proposed status is not affected by movement updates', () => {
  const proposed = { id: 'a', status: PLAYER_STATUS.PROPOSED, currentZoneId: 'jump-climber', candidateSince: 1000 };
  assert.deepEqual(applyZonePresence(proposed, null, 9999, HOLD), proposed);
  assert.deepEqual(applyZonePresence(proposed, QUIZ, 9999, HOLD), proposed);
});

test('in_game status is not affected by movement updates', () => {
  const inGame = { id: 'a', status: PLAYER_STATUS.IN_GAME, currentZoneId: 'jump-climber', candidateSince: 1000 };
  assert.deepEqual(applyZonePresence(inGame, JUMP, 9999, HOLD), inGame);
});

// ── compareReadyForSeat ─────────────────────────────────────────────────────
// 좌석 선정은 server _syncProposalForZone() 에서 이 comparator 로 정렬한 뒤
// maxPlayers 만큼 자른다. proposal modal 과 launch set 이 어긋나지 않으려면
// (a) earliest candidateSince 우선, (b) tie 는 id 알파벳 순으로 결정.

test('compareReadyForSeat orders by candidateSince ascending', () => {
  const players = [
    { id: 'late', candidateSince: 5000 },
    { id: 'early', candidateSince: 1000 },
    { id: 'mid', candidateSince: 3000 },
  ];
  players.sort(compareReadyForSeat);
  assert.deepEqual(players.map((p) => p.id), ['early', 'mid', 'late']);
});

test('compareReadyForSeat breaks ties by id (deterministic seating)', () => {
  const players = [
    { id: 'b', candidateSince: 1000 },
    { id: 'a', candidateSince: 1000 },
    { id: 'c', candidateSince: 1000 },
  ];
  players.sort(compareReadyForSeat);
  assert.deepEqual(players.map((p) => p.id), ['a', 'b', 'c']);
});

test('compareReadyForSeat treats null candidateSince as last', () => {
  const players = [
    { id: 'b', candidateSince: null },
    { id: 'a', candidateSince: 5000 },
  ];
  players.sort(compareReadyForSeat);
  assert.deepEqual(players.map((p) => p.id), ['a', 'b']);
});

// ── zone geometry ───────────────────────────────────────────────────────────

test('pointInRect handles edges (right/bottom exclusive)', () => {
  const r = { x: 10, y: 10, w: 100, h: 50 };
  assert.equal(pointInRect(10, 10, r), true);
  assert.equal(pointInRect(109, 59, r), true);
  assert.equal(pointInRect(110, 60, r), false);
  assert.equal(pointInRect(9, 10, r), false);
});

test('findZoneAt returns the matching zone or null', () => {
  const z = findZoneAt(JUMP.rect.x + 10, JUMP.rect.y + 10);
  assert.equal(z.id, 'jump-climber');
  assert.equal(findZoneAt(0, 0), null);
});

test('every zone has a registered gameId path', () => {
  const known = new Set(['jump-climber', 'mallang-quiz-battle', 'sseuk-sseuk']);
  for (const zone of GAME_ZONES) {
    assert.ok(known.has(zone.gameId), `unknown gameId: ${zone.gameId}`);
    assert.ok(zone.minPlayers >= 1);
    assert.ok(zone.maxPlayers >= zone.minPlayers);
    assert.ok(zone.holdMs > 0);
  }
});

// ── characters ──────────────────────────────────────────────────────────────

test('character ids round-trip world → game', () => {
  assert.equal(isValidCharacterId('latte_puppy'), true);
  assert.equal(isValidCharacterId('latte-puppy'), false); // game id is not a world id
  assert.equal(isValidCharacterId('not_a_thing'), false);

  assert.equal(toGameCharacterId('mochi_rabbit', 'jump-climber'), 'mochi-rabbit');
  assert.equal(toGameCharacterId('mint_kitten', 'mallang-quiz-battle'), 'mint-kitten');
  assert.equal(toGameCharacterId('peach_chick', 'jump-climber'), 'peach-chick');
  assert.equal(toGameCharacterId('not_a_thing', 'jump-climber'), null);
});

test('pickGameCharacter passes supported avatars through unchanged', () => {
  const direct = pickGameCharacter('mochi_rabbit', 'jump-climber');
  assert.deepEqual(direct, { worldId: 'mochi_rabbit', gameCharacterId: 'mochi-rabbit' });
});

test('catalogs are frozen so accidental mutation cannot drift', () => {
  assert.ok(Object.isFrozen(CHARACTERS));
  assert.ok(Object.isFrozen(CHARACTERS[0]));
  assert.ok(Object.isFrozen(CHARACTERS[0].gameIds));
});

test('shared/character_sprites.js worldIds match worker/src/characters.js', () => {
  const sharedSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'shared', 'character_sprites.js'),
    'utf8'
  );
  const worldIdsInShared = [...sharedSrc.matchAll(/worldId:\s*'([^']+)'/g)].map((m) => m[1]);
  const worldIdsInServer = CHARACTERS.map((c) => c.worldId);
  assert.deepEqual(worldIdsInShared, worldIdsInServer);
});

// ── stale-state healing ─────────────────────────────────────────────────────

test('stale state with status=roam but currentZoneId set is healed', () => {
  const stale = { id: 'a', status: PLAYER_STATUS.ROAM, currentZoneId: JUMP.id, candidateSince: null };
  const healed = applyZonePresence(stale, JUMP, 1000, HOLD);
  assert.equal(healed.status, PLAYER_STATUS.CANDIDATE);
  assert.equal(healed.candidateSince, 1000);
});

test('candidate with null candidateSince is healed (does not freeze)', () => {
  const stale = { id: 'a', status: PLAYER_STATUS.CANDIDATE, currentZoneId: JUMP.id, candidateSince: null };
  const t1 = applyZonePresence(stale, JUMP, 1000, HOLD);
  assert.equal(t1.candidateSince, 1000);
  const t2 = applyZonePresence(t1, JUMP, 4000, HOLD);
  assert.equal(t2.status, PLAYER_STATUS.INTENT_READY);
});

test('applyZonePresence honors zone.holdMs when override is omitted', () => {
  const fastZone = { ...JUMP, holdMs: 500 };
  const at0 = applyZonePresence(fresh('a'), fastZone, 0);
  const at500 = applyZonePresence(at0, fastZone, 500);
  assert.equal(at500.status, PLAYER_STATUS.INTENT_READY);
});

