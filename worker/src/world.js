/* WorldChannel — Durable Object backing the public 2D lounge.
 *
 * Scope of this commit (scaffold only):
 *   - WebSocket upgrade with Hibernation API
 *   - join_world / heartbeat / disconnect bookkeeping
 *   - server-authoritative roster (players keyed by sessionId)
 *
 * Out of scope (future commits):
 *   - position broadcast tick, chat, reactions, zone state machine,
 *     match proposals, GameRoom launch.
 *
 * The world state lives only in DO memory. Nothing here writes to D1.
 */

import { GAME_ZONES, getZone, findZoneAt } from './worldZones.js';
import { CHARACTERS, isValidCharacterId, randomCharacterId } from './characters.js';
import { applyZonePresence, tryFormMatch, resolveProposal, compareReadyForSeat, PLAYER_STATUS } from './matcher.js';
import { toGameCharacterId } from './characters.js';

// Mirrors GAME_PATHS in worker/src/room.js — keep these aligned so a new
// game added to the registry needs no world-side change unless we want a zone.
const GAME_URLS = Object.freeze({
  'jump-climber': '/prototypes/jump-climber/index.html',
  'mallang-tug-war': '/prototypes/mallang-tug-war/index.html',
  'mallang-quiz-battle': '/prototypes/mallang-quiz-battle/index.html',
});

const PROTOCOL_VERSION = 1;
const MAX_NAME_LEN = 16;
const HEARTBEAT_TIMEOUT_MS = 30_000;

const WORLD_BOUNDS = { width: 540, height: 960 };
const SPAWN_POINT = { x: 270, y: 520 };

// Movement validation. Server is authoritative on bounds and direction.
// Speed cheat-prevention is a soft check: positions are clamped to bounds
// and impossibly large jumps within MOVE_THROTTLE_MS are rejected with
// a correction. Stricter physics validation is a future hardening pass.
const MOVE_SPEED = 180;          // px/sec, must match client world.js
const MOVE_THROTTLE_MS = 40;      // server drops moves arriving faster than this
const MAX_JUMP_PX = 80;           // hard ceiling per accepted move (rejects teleports)
const VALID_DIRS = new Set(['up', 'down', 'left', 'right']);

const MAX_CHAT_LEN = 120;
const CHAT_THROTTLE_MS = 800;
const CHAT_HISTORY_MS = 2 * 60 * 60 * 1000; // 2 hours
const CHAT_HISTORY_KEY = 'chatHistory';
const REACTION_THROTTLE_MS = 1500;
const VALID_REACTIONS = new Set(['wave', 'heart', 'lol', 'wow', 'party', 'sleep']);

// Match proposal lifetime — every member must accept before this deadline
// passes. Single decline cancels immediately.
const PROPOSAL_TIMEOUT_MS = 7000;

function newMatchId() {
  return 'wm-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function safeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, MAX_NAME_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

function newSessionId() {
  return 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export class WorldChannel {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.loungeId = null;
    // Active match proposals. Memory-only — proposals are short-lived (7s) and
    // tied to live WebSocket sessions which can't survive hibernation anyway.
    this.proposals = new Map();

    // Hibernation wake-up cleanup:
    //   1) WebSocket attachments survive hibernation but in-memory proposals
    //      do not. Demote any orphan PROPOSED player to ROAM.
    //   2) When WORLD_BOUNDS changes between deploys, the persisted x/y from
    //      old sessions could be outside the new canvas. Re-clamp and rebuild
    //      currentZoneId from the actual position so stale state doesn't
    //      leak into zone counts or render off-screen.
    this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      for (const ws of this.state.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (!a) continue;

        const px = clamp(Number.isFinite(a.x) ? a.x : SPAWN_POINT.x, 16, WORLD_BOUNDS.width - 16);
        const py = clamp(Number.isFinite(a.y) ? a.y : SPAWN_POINT.y, 16, WORLD_BOUNDS.height - 16);
        const zoneNow = findZoneAt(px, py);
        const zoneNowId = zoneNow?.id ?? null;

        // Decide whether status needs touching. The earlier version reset
        // every INTENT_READY back to CANDIDATE which lost ready state for
        // anyone standing in place across a deploy/hibernation. Keep the
        // existing dwell state when the player is still validly inside the
        // same zone; only reset on mismatch or orphan PROPOSED.
        let nextStatus = a.status;
        let nextCurrentZoneId = a.currentZoneId ?? null;
        let nextCandidateSince = a.candidateSince ?? null;

        const sameZone = zoneNowId === a.currentZoneId;
        const isStale = sameZone && (
          a.status === PLAYER_STATUS.ROAM || a.candidateSince == null
        );

        if (a.status === PLAYER_STATUS.PROPOSED || !sameZone) {
          if (zoneNow) {
            nextStatus = PLAYER_STATUS.CANDIDATE;
            nextCurrentZoneId = zoneNowId;
            nextCandidateSince = now;
          } else {
            nextStatus = PLAYER_STATUS.ROAM;
            nextCurrentZoneId = null;
            nextCandidateSince = null;
          }
        } else if (isStale) {
          // Same zone but state is internally inconsistent (e.g. status=roam
          // with a currentZoneId set, or missing candidateSince). Heal it the
          // same way applyZonePresence does — treat as a fresh entry.
          nextStatus = PLAYER_STATUS.CANDIDATE;
          nextCurrentZoneId = zoneNowId;
          nextCandidateSince = now;
        }

        const dirty =
          px !== a.x ||
          py !== a.y ||
          nextStatus !== a.status ||
          nextCurrentZoneId !== (a.currentZoneId ?? null) ||
          nextCandidateSince !== (a.candidateSince ?? null);

        if (dirty) {
          ws.serializeAttachment({
            ...a,
            x: px,
            y: py,
            status: nextStatus,
            currentZoneId: nextCurrentZoneId,
            candidateSince: nextCandidateSince,
          });
        }
      }
      // Re-arm alarm so any reset CANDIDATE still gets promoted on schedule.
      await this._scheduleZoneAlarm();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/init')) {
      const body = await request.json().catch(() => ({}));
      if (body.loungeId) await this.state.storage.put('loungeId', String(body.loungeId));
      return new Response('ok');
    }

    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    if (this.loungeId == null) {
      this.loungeId = (await this.state.storage.get('loungeId')) || 'lounge-1';
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      sessionId: null,
      joinedAt: Date.now(),
      lastHeartbeat: Date.now(),
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket Hibernation API handlers ──────────────────────────────────────

  async webSocketMessage(ws, raw) {
    let envelope;
    try {
      envelope = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this._sendError(ws, 'BAD_JSON', 'message is not valid JSON');
    }

    if (!envelope || typeof envelope !== 'object' || envelope.v !== PROTOCOL_VERSION) {
      return this._sendError(ws, 'VERSION', `expected protocol v${PROTOCOL_VERSION}`);
    }

    const t = envelope.t;
    const d = envelope.d ?? {};
    const attach = ws.deserializeAttachment() || {};

    switch (t) {
      case 'join_world':
        return this._handleJoin(ws, attach, d);
      case 'move':
        return this._handleMove(ws, attach, d);
      case 'chat':
        return this._handleChat(ws, attach, d);
      case 'reaction':
        return this._handleReaction(ws, attach, d);
      case 'match_start':
        return this._handleMatchStart(ws, attach, d);
      case 'match_leave':
        return this._handleMatchLeave(ws, attach, d);
      case 'pong':
        ws.serializeAttachment({ ...attach, lastHeartbeat: Date.now() });
        return;
      default:
        return this._sendError(ws, 'UNKNOWN_TYPE', `unknown message type: ${String(t)}`);
    }
  }

  async webSocketClose(ws) {
    const attach = ws.deserializeAttachment() || {};
    if (!attach.sessionId) return;

    this._broadcast({ t: 'player_left', d: { id: attach.sessionId } }, ws);

    const prevZoneId = attach.currentZoneId ?? null;
    if (prevZoneId) {
      ws.serializeAttachment({
        ...attach,
        status: PLAYER_STATUS.ROAM,
        currentZoneId: null,
        candidateSince: null,
      });
      this._broadcastZoneState(prevZoneId);
      // Re-sync the proposal: transfers host if needed, drops if zone empty.
      await this._syncProposalForZone(prevZoneId, Date.now());
    }
    await this._scheduleZoneAlarm();
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async _handleJoin(ws, attach, d) {
    if (attach.sessionId) {
      return this._sendError(ws, 'ALREADY_JOINED', 'session already joined');
    }

    const name = safeName(d.name);
    if (!name) return this._sendError(ws, 'BAD_NAME', '닉네임이 필요합니다.');

    const characterId = isValidCharacterId(d.characterId) ? d.characterId : randomCharacterId();
    const sessionId = newSessionId();

    // 게임에서 돌아왔으면 광장 가운데 빈 영역에 랜덤 스폰. 첫 입장 등 그 외
    // 경로는 기존 고정 spawn point.
    const spawn = pickSpawn(d?.entryFrom);

    const me = {
      id: sessionId,
      name,
      characterId,
      x: spawn.x,
      y: spawn.y,
      dir: 'down',
      moving: false,
      status: 'roam',
      currentZoneId: null,
      candidateSince: null,
    };

    ws.serializeAttachment({
      ...attach,
      sessionId, name, characterId,
      x: me.x, y: me.y, dir: me.dir, moving: me.moving,
      status: me.status, currentZoneId: me.currentZoneId,
      candidateSince: me.candidateSince,
      lastMoveAt: 0,
    });

    const peers = this._collectPlayers().filter((p) => p.id !== sessionId);
    const zoneSnapshots = GAME_ZONES.map((z) => {
      let count = 0, ready = 0;
      for (const sock of this.state.getWebSockets()) {
        const a = sock.deserializeAttachment();
        if (!a || a.currentZoneId !== z.id) continue;
        count += 1;
        if (a.status === PLAYER_STATUS.INTENT_READY) ready += 1;
      }
      return {
        id: z.id, gameId: z.gameId, title: z.title, rect: z.rect,
        minPlayers: z.minPlayers, maxPlayers: z.maxPlayers, holdMs: z.holdMs,
        count, ready,
      };
    });
    const chatHistory = await this._recentChatHistory();
    this._send(ws, {
      t: 'welcome',
      d: {
        youId: sessionId,
        loungeId: this.loungeId,
        bounds: WORLD_BOUNDS,
        characters: CHARACTERS.map((c) => ({ worldId: c.worldId, label: c.label, sheet: null })),
        zones: zoneSnapshots,
        players: peers,
        you: me,
        chat: chatHistory,
      },
    });

    this._broadcast({ t: 'player_joined', d: { player: me } }, ws);
  }

  async _handleMove(ws, attach, d) {
    if (!attach.sessionId) return; // not joined yet — silently ignore

    const now = Date.now();
    const lastMoveAt = attach.lastMoveAt || 0;

    const x = Number(d?.x), y = Number(d?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const dir = VALID_DIRS.has(d?.dir) ? d.dir : (attach.dir ?? 'down');
    const moving = !!d?.moving;

    // Throttle motion bursts but never drop a stop transition — peers must
    // see moving:false promptly or they'll render this player walking forever.
    const isStopTransition = !moving && !!attach.moving;
    if (!isStopTransition && now - lastMoveAt < MOVE_THROTTLE_MS) return;

    // Clamp to bounds.
    const cx = clamp(x, 16, WORLD_BOUNDS.width  - 16);
    const cy = clamp(y, 16, WORLD_BOUNDS.height - 16);

    // Reject obvious teleports (since-last-accepted distance).
    const px = attach.x ?? SPAWN_POINT.x;
    const py = attach.y ?? SPAWN_POINT.y;
    const dist = Math.hypot(cx - px, cy - py);
    if (dist > MAX_JUMP_PX) {
      // Send a correction so the cheat-attempting client snaps back.
      this._send(ws, { t: 'tick', d: { players: [{ id: attach.sessionId, x: px, y: py, dir, moving: false }], at: now } });
      return;
    }

    // Re-evaluate zone presence at the new position. applyZonePresence is
    // pure, so we just feed it the previous snapshot and the zone (if any).
    const zone = findZoneAt(cx, cy);
    const prevSnap = {
      status: attach.status || PLAYER_STATUS.ROAM,
      currentZoneId: attach.currentZoneId ?? null,
      candidateSince: attach.candidateSince ?? null,
    };
    const nextSnap = applyZonePresence(prevSnap, zone, now);
    const zoneChanged = nextSnap.currentZoneId !== prevSnap.currentZoneId;
    const statusChanged = nextSnap.status !== prevSnap.status;

    ws.serializeAttachment({
      ...attach,
      x: cx, y: cy, dir, moving, lastMoveAt: now,
      status: nextSnap.status,
      currentZoneId: nextSnap.currentZoneId,
      candidateSince: nextSnap.candidateSince,
    });

    this._broadcast({
      t: 'tick',
      d: { players: [{ id: attach.sessionId, x: cx, y: cy, dir, moving }], at: now },
    }, ws);

    if (zoneChanged || statusChanged) {
      // Notify the player about their own zone progress (or absence).
      this._sendZoneProgress(ws, nextSnap, now);
      // Broadcast updated counts for any zone that gained or lost this player.
      const affected = new Set([prevSnap.currentZoneId, nextSnap.currentZoneId].filter(Boolean));
      for (const zoneId of affected) this._broadcastZoneState(zoneId);
      // Sync the host-driven proposal for any zone this move affected. New
      // INTENT_READY players join the lobby; players walking out are removed.
      for (const zoneId of affected) await this._syncProposalForZone(zoneId, now);
      await this._scheduleZoneAlarm();
    }
  }

  // ── Zone state machine + alarms ─────────────────────────────────────────────

  /* alarm() fires when at least one candidate is expected to cross holdMs.
   * Re-evaluates every player's zone presence at the current time, broadcasts
   * any changes, and re-arms the alarm for the next deadline (if any).
   */
  async alarm() {
    const now = Date.now();
    const affectedZones = new Set();
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a?.sessionId) continue;
      const zone = a.currentZoneId ? getZone(a.currentZoneId) : null;
      const prev = {
        status: a.status || PLAYER_STATUS.ROAM,
        currentZoneId: a.currentZoneId ?? null,
        candidateSince: a.candidateSince ?? null,
      };
      const next = applyZonePresence(prev, zone, now);
      if (next.status === prev.status && next.currentZoneId === prev.currentZoneId) continue;
      ws.serializeAttachment({
        ...a,
        status: next.status,
        currentZoneId: next.currentZoneId,
        candidateSince: next.candidateSince,
      });
      this._sendZoneProgress(ws, next, now);
      if (prev.currentZoneId) affectedZones.add(prev.currentZoneId);
      if (next.currentZoneId) affectedZones.add(next.currentZoneId);
    }
    for (const zoneId of affectedZones) this._broadcastZoneState(zoneId);
    // Promote candidates to intent_ready may open or grow proposals.
    for (const zoneId of affectedZones) await this._syncProposalForZone(zoneId, now);
    await this._scheduleZoneAlarm();
  }

  async _scheduleZoneAlarm() {
    let earliest = null;
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || a.status !== PLAYER_STATUS.CANDIDATE) continue;
      if (a.candidateSince == null || !a.currentZoneId) continue;
      const zone = getZone(a.currentZoneId);
      if (!zone) continue;
      const deadline = a.candidateSince + zone.holdMs;
      if (earliest == null || deadline < earliest) earliest = deadline;
    }
    if (earliest != null) {
      // Add 5ms slack to avoid a busy retry exactly on the boundary.
      await this.state.storage.setAlarm(earliest + 5);
    } else {
      await this.state.storage.deleteAlarm();
    }
  }

  // ── Match proposal lifecycle (host-driven, no deadline) ────────────────────

  /* Sync the host-driven proposal for a single zone. Called on every event
   * that may add or remove an INTENT_READY player in the zone (moves, dwell
   * promotion via alarm, explicit leave, disconnect).
   *
   *   - Opens a new proposal if any INTENT_READY player is in the zone and
   *     none exists yet. First arrival becomes the host.
   *   - Updates members for an existing proposal. If the host walked out,
   *     transfers host to the next member. If the zone empties, drops the
   *     proposal silently (leavers already received zone_progress(null) so
   *     their modal closes on its own).
   *   - Pushes `match_proposal` to newcomers (so their modal opens) and
   *     `match_members_updated` to everyone currently in the lobby.
   */
  async _syncProposalForZone(zoneId, now) {
    const zone = getZone(zoneId);
    if (!zone) return;

    const memberSockets = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.sessionId
          && a.status === PLAYER_STATUS.INTENT_READY
          && a.currentZoneId === zoneId) {
        memberSockets.push({ ws, attach: a });
      }
    }
    // Deterministic seating order via the shared matcher comparator.
    memberSockets.sort((a, b) => compareReadyForSeat(
      { id: a.attach.sessionId, candidateSince: a.attach.candidateSince },
      { id: b.attach.sessionId, candidateSince: b.attach.candidateSince },
    ));

    // Enforce maxPlayers — earliest arrivals fill the seats. Anyone over
    // capacity stays INTENT_READY in the zone but is not broadcast as a
    // member; once a seated player leaves they slide in on the next sync.
    const seated = memberSockets.slice(0, zone.maxPlayers);

    const existing = [...this.proposals.values()].find((p) => p.zoneId === zoneId);

    if (seated.length === 0) {
      if (existing) this.proposals.delete(existing.matchId);
      return;
    }

    const memberInfo = seated.map(({ attach }) => ({
      id: attach.sessionId,
      name: attach.name,
      characterId: attach.characterId,
    }));
    const memberIds = new Set(memberInfo.map((m) => m.id));

    let proposal;
    if (!existing) {
      proposal = {
        matchId: newMatchId(),
        zoneId: zone.id,
        gameId: zone.gameId,
        hostId: memberInfo[0].id,
        lastMemberIds: new Set(),
        createdAt: now,
      };
      this.proposals.set(proposal.matchId, proposal);
    } else {
      proposal = existing;
      // Transfer host if the previous host left the zone.
      if (!memberIds.has(proposal.hostId)) {
        proposal.hostId = memberInfo[0].id;
      }
    }

    const proposalMsg = {
      t: 'match_proposal',
      d: {
        matchId: proposal.matchId,
        zoneId: zone.id,
        gameId: zone.gameId,
        title: zone.title,
        hostId: proposal.hostId,
        players: memberInfo,
        minPlayers: zone.minPlayers,
        maxPlayers: zone.maxPlayers,
      },
    };
    const updateMsg = {
      t: 'match_members_updated',
      d: {
        matchId: proposal.matchId,
        hostId: proposal.hostId,
        players: memberInfo,
        minPlayers: zone.minPlayers,
        maxPlayers: zone.maxPlayers,
      },
    };

    for (const { ws, attach } of seated) {
      if (proposal.lastMemberIds.has(attach.sessionId)) {
        this._send(ws, updateMsg);
      } else {
        this._send(ws, proposalMsg);
      }
    }

    // Defensive: anyone who was seated last sync but isn't anymore (rare —
    // requires sort order to shift, which shouldn't happen with stable sort)
    // must be told to close their stale modal.
    const dropped = [];
    for (const id of proposal.lastMemberIds) if (!memberIds.has(id)) dropped.push(id);
    if (dropped.length) {
      const cancelMsg = {
        t: 'match_cancelled',
        d: { matchId: proposal.matchId, reason: 'left' },
      };
      for (const ws of this.state.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a?.sessionId && dropped.includes(a.sessionId)) this._send(ws, cancelMsg);
      }
    }

    proposal.lastMemberIds = memberIds;
  }

  /* Host clicks "시작" — snapshot the current ready members and launch. */
  async _handleMatchStart(ws, attach, d) {
    if (!attach.sessionId) return;
    const matchId = typeof d?.matchId === 'string' ? d.matchId : null;
    if (!matchId) return;
    const proposal = this.proposals.get(matchId);
    if (!proposal) return;
    if (proposal.hostId !== attach.sessionId) return; // only host may start

    const zone = getZone(proposal.zoneId);
    if (!zone) return this._cancelProposal(proposal, 'invalid');

    // Collect with candidateSince so we can cap at maxPlayers fairly
    // (earliest arrivals get the seats). Comparator MUST match the one used
    // by `_syncProposalForZone` so the host's modal view and the launch set
    // are identical when candidateSince ties occur.
    const ready = [];
    for (const w of this.state.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a?.sessionId
          && a.status === PLAYER_STATUS.INTENT_READY
          && a.currentZoneId === proposal.zoneId) {
        ready.push({ id: a.sessionId, candidateSince: a.candidateSince });
      }
    }
    ready.sort(compareReadyForSeat);
    const seatedIds = ready.slice(0, zone.maxPlayers).map((r) => r.id);

    if (seatedIds.length < zone.minPlayers) {
      this._send(ws, {
        t: 'error',
        d: { code: 'MIN_PLAYERS', message: `최소 ${zone.minPlayers}명이 필요합니다.` },
      });
      return;
    }
    proposal.players = seatedIds;
    await this._launchProposal(proposal);
  }

  /* Player tapped "나가기" in the lobby. Treat the same as walking out:
   * status -> ROAM, zone state recomputed, proposal members re-synced.
   */
  async _handleMatchLeave(ws, attach, d) {
    if (!attach.sessionId) return;
    const now = Date.now();
    const prevZoneId = attach.currentZoneId ?? null;
    if (!prevZoneId) return;
    ws.serializeAttachment({
      ...attach,
      status: PLAYER_STATUS.ROAM,
      currentZoneId: null,
      candidateSince: null,
    });
    this._sendZoneProgress(
      ws,
      { status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null },
      now,
    );
    this._broadcastZoneState(prevZoneId);
    await this._syncProposalForZone(prevZoneId, now);
    await this._scheduleZoneAlarm();
  }

  _cancelProposal(proposal, reason) {
    if (!this.proposals.has(proposal.matchId)) return;
    const now = Date.now();
    const targetIds = Array.isArray(proposal.players) && proposal.players.length
      ? proposal.players
      : [...(proposal.lastMemberIds || [])];

    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a?.sessionId || !targetIds.includes(a.sessionId)) continue;

      // Player's recorded currentZoneId was frozen at propose time. Recompute
      // from their actual position so a player who walked out while proposed
      // doesn't get requeued in a zone they're no longer standing in.
      const zoneNow = findZoneAt(a.x ?? SPAWN_POINT.x, a.y ?? SPAWN_POINT.y);
      const cleared = {
        status: PLAYER_STATUS.ROAM,
        currentZoneId: null,
        candidateSince: null,
      };
      // applyZonePresence on a clean snapshot makes them CANDIDATE again with
      // a fresh dwell timer if still in some zone, otherwise leaves them ROAM.
      const next = applyZonePresence(cleared, zoneNow, now);

      ws.serializeAttachment({
        ...a,
        status: next.status,
        currentZoneId: next.currentZoneId,
        candidateSince: next.candidateSince,
      });
      this._send(ws, { t: 'match_cancelled', d: { matchId: proposal.matchId, reason } });
      this._sendZoneProgress(ws, next, now);
    }

    this.proposals.delete(proposal.matchId);
    this._broadcastZoneState(proposal.zoneId);
  }

  async _launchProposal(proposal) {
    if (!this.proposals.has(proposal.matchId)) return;
    if (!GAME_URLS[proposal.gameId]) {
      // Defensive — should never happen if zone catalog matches GAME_URLS.
      this._cancelProposal(proposal, 'invalid');
      return;
    }

    // Snapshot members with their game-side characterId so the URL the player
    // receives carries the correct kebab-case avatar id.
    const launchPlayers = [];
    const memberSockets = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a?.sessionId || !proposal.players.includes(a.sessionId)) continue;
      memberSockets.push({ ws, attach: a });
      launchPlayers.push({
        id: a.sessionId,
        name: a.name,
        characterId: a.characterId, // world id; room.js translates via pickGameCharacter
      });
    }

    // Seed the GameRoom DO with phase=playing + roster. The matchId itself
    // serves as the room code (wm-<uuid>) — opaque, no 4-digit collision risk.
    try {
      const id = this.env.GAME_ROOM.idFromName(proposal.matchId);
      const stub = this.env.GAME_ROOM.get(id);
      const res = await stub.fetch(new Request('https://world.local/world-launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: proposal.gameId,
          code: proposal.matchId,
          players: launchPlayers,
        }),
      }));
      if (!res.ok) throw new Error(`world-launch failed: ${res.status}`);
    } catch (err) {
      // GameRoom seeding failed — cancel cleanly so members aren't stuck.
      this._cancelProposal(proposal, 'invalid');
      return;
    }

    // Build the per-player game URL. Use a relative path so the browser stays
    // on the same origin as the world page.
    const gamePath = GAME_URLS[proposal.gameId];
    for (const { ws, attach } of memberSockets) {
      ws.serializeAttachment({
        ...attach,
        status: PLAYER_STATUS.IN_GAME,
        currentZoneId: null,
        candidateSince: null,
      });
      const gameCharacterId =
        toGameCharacterId(attach.characterId, proposal.gameId) || attach.characterId;
      const params = new URLSearchParams({
        code: proposal.matchId,
        playerId: attach.sessionId,
        name: attach.name || '',
        gameId: proposal.gameId,
        characterId: gameCharacterId || '',
        from: 'world',
        worldId: this.loungeId || 'lounge-1',
      });
      const url = `${gamePath}?${params.toString()}`;

      this._send(ws, {
        t: 'match_confirmed',
        d: {
          matchId: proposal.matchId,
          gameId: proposal.gameId,
          accepted: proposal.accepted,
          declined: proposal.declined,
        },
      });
      this._send(ws, {
        t: 'go_to_game',
        d: { matchId: proposal.matchId, gameId: proposal.gameId, url },
      });
    }

    this.proposals.delete(proposal.matchId);
    this._broadcastZoneState(proposal.zoneId);
  }

  _broadcastZoneState(zoneId) {
    const zone = getZone(zoneId);
    if (!zone) return;
    let count = 0;
    let ready = 0;
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || a.currentZoneId !== zoneId) continue;
      count += 1;
      if (a.status === PLAYER_STATUS.INTENT_READY) ready += 1;
    }
    this._broadcast({
      t: 'zone_state',
      d: { zoneId, count, ready, minPlayers: zone.minPlayers, maxPlayers: zone.maxPlayers },
    });
  }

  _sendZoneProgress(ws, snap, now) {
    if (!snap.currentZoneId || snap.candidateSince == null) {
      this._send(ws, { t: 'zone_progress', d: { zoneId: null } });
      return;
    }
    const zone = getZone(snap.currentZoneId);
    if (!zone) return;
    this._send(ws, {
      t: 'zone_progress',
      d: {
        zoneId: snap.currentZoneId,
        candidateSince: snap.candidateSince,
        holdMs: zone.holdMs,
        ready: snap.status === PLAYER_STATUS.INTENT_READY,
        serverNow: now,
      },
    });
  }

  async _handleChat(ws, attach, d) {
    if (!attach.sessionId) return;

    const now = Date.now();
    if (now - (attach.lastChatAt || 0) < CHAT_THROTTLE_MS) {
      return this._sendError(ws, 'RATE_LIMITED', '메시지를 너무 빠르게 보냈습니다.');
    }

    const raw = typeof d?.text === 'string' ? d.text : '';
    const text = raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_CHAT_LEN);
    if (!text) return;

    ws.serializeAttachment({ ...attach, lastChatAt: now });

    const entry = { id: attach.sessionId, name: attach.name, text, ts: now };
    await this._appendChatHistory(entry);

    // Echo to sender too so the bubble appears reliably even if local optimistic
    // render is skipped. Client de-dupes by id+ts if it ever needs to.
    this._broadcast({ t: 'chat', d: entry });
  }

  // Chat history — persisted in DO storage so it survives hibernation and is
  // replayed to clients on every join/reconnect via the welcome payload.
  async _loadChatHistory() {
    if (this._chatHistory) return this._chatHistory;
    const stored = await this.state.storage.get(CHAT_HISTORY_KEY);
    this._chatHistory = Array.isArray(stored) ? stored : [];
    return this._chatHistory;
  }

  async _appendChatHistory(entry) {
    await this._loadChatHistory();
    this._chatHistory.push(entry);
    const cutoff = Date.now() - CHAT_HISTORY_MS;
    // Prune entries older than the retention window. Cheap because new entries
    // are appended at the tail in time order.
    while (this._chatHistory.length && this._chatHistory[0].ts < cutoff) {
      this._chatHistory.shift();
    }
    await this.state.storage.put(CHAT_HISTORY_KEY, this._chatHistory);
  }

  async _recentChatHistory() {
    await this._loadChatHistory();
    const cutoff = Date.now() - CHAT_HISTORY_MS;
    return this._chatHistory.filter((m) => m.ts >= cutoff);
  }

  async _handleReaction(ws, attach, d) {
    if (!attach.sessionId) return;

    const now = Date.now();
    if (now - (attach.lastReactionAt || 0) < REACTION_THROTTLE_MS) return;

    const emoji = typeof d?.emoji === 'string' ? d.emoji : '';
    if (!VALID_REACTIONS.has(emoji)) return;

    ws.serializeAttachment({ ...attach, lastReactionAt: now });

    this._broadcast({
      t: 'reaction',
      d: { id: attach.sessionId, emoji, ts: now },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _collectPlayers() {
    const out = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || !a.sessionId) continue;
      out.push({
        id: a.sessionId,
        name: a.name,
        characterId: a.characterId,
        x: a.x ?? SPAWN_POINT.x,
        y: a.y ?? SPAWN_POINT.y,
        dir: a.dir ?? 'down',
        moving: !!a.moving,
        status: a.status ?? 'roam',
        currentZoneId: a.currentZoneId ?? null,
        candidateSince: a.candidateSince ?? null,
      });
    }
    return out;
  }

  _send(ws, msg) {
    try { ws.send(JSON.stringify({ ...msg, v: PROTOCOL_VERSION })); } catch { /* closed */ }
  }

  _sendError(ws, code, message) {
    this._send(ws, { t: 'error', d: { code, message } });
  }

  _broadcast(msg, except = null) {
    const text = JSON.stringify({ ...msg, v: PROTOCOL_VERSION });
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(text); } catch { /* closed */ }
    }
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* Returns a spawn position for a freshly-joining player.
 *   - entryFrom === 'game' : land at a random spot in the lobby gathering area
 *     (lower 2/3 of the canvas, away from booths). Gives a "you just landed
 *     back" feel and avoids piling all returning players on top of each other.
 *   - otherwise            : fixed SPAWN_POINT (first join, character change).
 */
function pickSpawn(entryFrom) {
  if (entryFrom === 'game') {
    return {
      x: 80 + Math.floor(Math.random() * 381), // [80, 460]
      y: 450 + Math.floor(Math.random() * 401), // [450, 850]
    };
  }
  return { x: SPAWN_POINT.x, y: SPAWN_POINT.y };
}
