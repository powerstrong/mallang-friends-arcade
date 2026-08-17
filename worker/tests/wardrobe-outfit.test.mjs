/* Integration tests for the human-avatar wardrobe protocol (AVATAR_DESIGN.md §11).
 *
 * Reuses the hand-rolled DO mock approach from match-start.test.mjs. Verifies:
 *   - join_world with characterId 'human' — outfit sanitized onto the wire,
 *     gameBuddyId kept server-side only (never broadcast)
 *   - invalid outfit fields are substituted with preset defaults (마네킹 비노출)
 *   - outfit_change: revision monotonicity + broadcast + throttle
 *   - launch paths translate human → gameBuddyId (URL + world-launch seed body)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorldChannel } from '../src/world.js';
import { PLAYER_STATUS } from '../src/matcher.js';
import { getZone } from '../src/worldZones.js';
import { sanitizeOutfit, WARDROBE } from '../src/wardrobe.js';

const JUMP = getZone('jump-climber'); // min=1, max=2

function makeWs(initialAttach = null) {
  let attachment = initialAttach;
  const sent = [];
  return {
    serializeAttachment(v) { attachment = v; },
    deserializeAttachment() { return attachment; },
    send(s) { sent.push(typeof s === 'string' ? JSON.parse(s) : s); },
    close() { /* noop */ },
    sent,
    setAttach(a) { attachment = a; },
    getAttach() { return attachment; },
  };
}

function makeState() {
  const sockets = [];
  const store = new Map();
  return {
    sockets,
    getWebSockets() { return sockets; },
    blockConcurrencyWhile(fn) { return fn(); },
    storage: {
      get(k) { return Promise.resolve(store.get(k)); },
      put(k, v) { store.set(k, v); return Promise.resolve(); },
      setAlarm() { return Promise.resolve(); },
      deleteAlarm() { return Promise.resolve(); },
    },
    acceptWebSocket() { /* noop */ },
  };
}

function makeEnv(capture = {}) {
  return {
    GAME_ROOM: {
      idFromName(name) { return { name }; },
      get() {
        return {
          fetch: async (req) => {
            capture.body = JSON.parse(await req.text());
            return { ok: true, status: 200 };
          },
        };
      },
    },
  };
}

function makeChannel(capture = {}) {
  const state = makeState();
  const env = makeEnv(capture);
  const ch = new WorldChannel(state, env);
  ch.loungeId = 'lounge-test';
  return { ch, state, env };
}

function joinMsg(d) {
  return JSON.stringify({ v: 1, t: 'join_world', d });
}

function findSent(ws, t) {
  return ws.sent.filter((m) => m.t === t);
}

test('human join: outfit sanitized on the wire, gameBuddyId server-side only', async () => {
  const { ch, state } = makeChannel();
  const peer = makeWs({
    sessionId: 'peer1', name: 'Peer', characterId: 'peach_chick',
    x: 100, y: 100, dir: 'down', moving: false,
    status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null,
  });
  state.sockets.push(peer);
  const ws = makeWs(null);
  state.sockets.push(ws);

  await ch.webSocketMessage(ws, joinMsg({
    name: '지수',
    characterId: 'human',
    gameBuddyId: 'mint_kitten',
    outfit: { outfit: 'outfit_tee_sky', hair: 'hair_short', hairColor: 'gold', hat: 'hat_beret', faceAcc: null },
    catalogVersion: 1,
  }));

  const welcome = findSent(ws, 'welcome')[0];
  assert.ok(welcome, 'welcome sent');
  assert.equal(welcome.d.you.characterId, 'human');
  assert.deepEqual(welcome.d.you.outfit, {
    outfit: 'outfit_tee_sky', hair: 'hair_short', hairColor: 'gold', hat: 'hat_beret', faceAcc: null,
  });
  assert.equal(welcome.d.you.gameBuddyId, undefined, 'buddy never broadcast');

  const attach = ws.getAttach();
  assert.equal(attach.gameBuddyId, 'mint_kitten');
  assert.equal(attach.outfitRevision, 0);

  const joined = findSent(peer, 'player_joined')[0];
  assert.ok(joined, 'peer notified');
  assert.equal(joined.d.player.characterId, 'human');
  assert.ok(joined.d.player.outfit, 'outfit rides player_joined');
  assert.equal(joined.d.player.gameBuddyId, undefined);
});

test('human join: invalid outfit/buddy substituted, never rejected (마네킹 비노출)', async () => {
  const { ch, state } = makeChannel();
  const ws = makeWs(null);
  state.sockets.push(ws);

  await ch.webSocketMessage(ws, joinMsg({
    name: '유나',
    characterId: 'human',
    gameBuddyId: 'not_an_animal',
    outfit: { outfit: 'hack.png', hair: 42, hairColor: 'rainbow', hat: 'outfit_tee_sky', faceAcc: 'x' },
  }));

  const welcome = findSent(ws, 'welcome')[0];
  assert.ok(welcome, 'welcome sent despite junk payload');
  const o = welcome.d.you.outfit;
  // girl 프리셋 기본으로 치환 + slot 이 안 맞는 hat(코디 id) 은 null.
  assert.deepEqual(o, { ...WARDROBE.presets.girl });
  const attach = ws.getAttach();
  assert.notEqual(attach.gameBuddyId, 'not_an_animal');
  assert.ok(attach.gameBuddyId, 'buddy fell back to a random valid animal');
});

test('animal join unchanged: no outfit on the wire (하위 호환)', async () => {
  const { ch, state } = makeChannel();
  const ws = makeWs(null);
  state.sockets.push(ws);
  await ch.webSocketMessage(ws, joinMsg({ name: '토토', characterId: 'mochi_rabbit' }));
  const welcome = findSent(ws, 'welcome')[0];
  assert.equal(welcome.d.you.characterId, 'mochi_rabbit');
  assert.equal('outfit' in welcome.d.you, false);
});

test('outfit_change: sanitize + monotonic revision + broadcast to everyone', async () => {
  const { ch, state } = makeChannel();
  const human = makeWs({
    sessionId: 'h1', name: '지수', characterId: 'human',
    gameBuddyId: 'mint_kitten',
    outfit: { ...WARDROBE.presets.girl }, outfitRevision: 0,
    x: 100, y: 100, dir: 'down', moving: false,
    status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null,
  });
  const peer = makeWs({
    sessionId: 'p1', name: 'Peer', characterId: 'peach_chick',
    x: 200, y: 200, dir: 'down', moving: false,
    status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null,
  });
  state.sockets.push(human, peer);

  await ch.webSocketMessage(human, JSON.stringify({
    v: 1, t: 'outfit_change',
    d: { revision: 1, outfit: { outfit: 'outfit_dress_peach', hair: 'hair_long', hairColor: 'rose', hat: null, faceAcc: 'glasses_round' } },
  }));

  assert.equal(human.getAttach().outfitRevision, 1);
  assert.equal(human.getAttach().outfit.hairColor, 'rose');
  const gotPeer = findSent(peer, 'outfit_change')[0];
  const gotSelf = findSent(human, 'outfit_change')[0];
  assert.ok(gotPeer && gotSelf, 'broadcast to all, sender included');
  assert.equal(gotPeer.d.id, 'h1');
  assert.equal(gotPeer.d.revision, 1);
  assert.equal(gotPeer.d.outfit.faceAcc, 'glasses_round');

  // 역순 revision 은 조용히 무시 (throttle 을 지나도록 lastOutfitAt 을 되감는다).
  human.setAttach({ ...human.getAttach(), lastOutfitAt: Date.now() - 5000 });
  await ch.webSocketMessage(human, JSON.stringify({
    v: 1, t: 'outfit_change',
    d: { revision: 1, outfit: { ...WARDROBE.presets.boy } },
  }));
  assert.equal(human.getAttach().outfit.hairColor, 'rose', 'stale revision did not apply');
  assert.equal(findSent(peer, 'outfit_change').length, 1, 'no rebroadcast');

  // 연타 보호: revision 은 새로워도 1초 안에 오면 드랍.
  human.setAttach({ ...human.getAttach(), lastOutfitAt: Date.now() });
  await ch.webSocketMessage(human, JSON.stringify({
    v: 1, t: 'outfit_change',
    d: { revision: 2, outfit: { ...WARDROBE.presets.boy } },
  }));
  assert.equal(human.getAttach().outfitRevision, 1, 'throttled save dropped');
});

test('outfit_change from an animal avatar is refused', async () => {
  const { ch, state } = makeChannel();
  const ws = makeWs({
    sessionId: 'a1', name: '토토', characterId: 'mochi_rabbit',
    x: 100, y: 100, dir: 'down', moving: false,
    status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null,
  });
  state.sockets.push(ws);
  await ch.webSocketMessage(ws, JSON.stringify({
    v: 1, t: 'outfit_change', d: { revision: 1, outfit: { ...WARDROBE.presets.girl } },
  }));
  const err = findSent(ws, 'error')[0];
  assert.equal(err?.d.code, 'NOT_HUMAN');
});

test('launch: human translates to gameBuddyId in both the URL and the seed body', async () => {
  const capture = {};
  const { ch, state } = makeChannel(capture);
  const now = Date.now();
  const mk = (id, name, extra) => {
    const ws = makeWs({
      sessionId: id, name,
      x: 270, y: 520, dir: 'down', moving: false,
      status: PLAYER_STATUS.INTENT_READY,
      currentZoneId: JUMP.id,
      candidateSince: now - JUMP.holdMs - 100,
      ...extra,
    });
    state.sockets.push(ws);
    return ws;
  };
  const humanWs = mk('h1', '지수', {
    characterId: 'human', gameBuddyId: 'mint_kitten',
    outfit: { ...WARDROBE.presets.girl }, outfitRevision: 0,
  });
  const animalWs = mk('a1', '토토', { characterId: 'mochi_rabbit' });

  ch.proposals.set('wm-test-0001', {
    matchId: 'wm-test-0001', zoneId: JUMP.id, gameId: JUMP.gameId,
    hostId: 'h1', lastMemberIds: new Set(['h1', 'a1']), createdAt: now,
    phase: null, startedBy: null,
  });

  await ch.webSocketMessage(humanWs, JSON.stringify({
    v: 1, t: 'match_start', d: { matchId: 'wm-test-0001' },
  }));

  // world-launch 시드 body: human → 말랑 친구 world id 로 치환됐는지.
  const seeded = Object.fromEntries(capture.body.players.map((p) => [p.id, p.characterId]));
  assert.equal(seeded.h1, 'mint_kitten');
  assert.equal(seeded.a1, 'mochi_rabbit');

  // go_to_game URL: 게임 kebab-case id.
  const urlOfHuman = findSent(humanWs, 'go_to_game')[0].d.url;
  assert.match(urlOfHuman, /characterId=mint-kitten/);
  const urlOfAnimal = findSent(animalWs, 'go_to_game')[0].d.url;
  assert.match(urlOfAnimal, /characterId=mochi-rabbit/);
});

test('sanitizeOutfit: 코디+헤어는 항상 채워진 완전한 착장을 돌려준다', () => {
  const o = sanitizeOutfit(null);
  assert.ok(o.outfit && o.hair && o.hairColor, 'complete outfit from nothing');
  const boy = sanitizeOutfit({ hat: 'hat_beret' }, 'boy');
  assert.equal(boy.outfit, WARDROBE.presets.boy.outfit);
  assert.equal(boy.hat, 'hat_beret');
});
