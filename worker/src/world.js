/* WorldChannel — Durable Object backing the public 2D lounge.
 *
 * WebSocket upgrade (Hibernation API), join/heartbeat/disconnect bookkeeping,
 * server-authoritative roster, position broadcast, chat/reactions, zone
 * state machine, host-driven match proposals, and GameRoom launch.
 *
 * The world state lives only in DO memory. Nothing here writes to D1.
 */

import { GAME_ZONES, getZone, findZoneAt } from './worldZones.js';
import { CHARACTERS, isValidCharacterId, randomCharacterId } from './characters.js';
import { applyZonePresence, compareReadyForSeat, PLAYER_STATUS } from './matcher.js';
import { toGameCharacterId } from './characters.js';

// Mirrors GAME_PATHS in worker/src/room.js — keep these aligned so a new
// game added to the registry needs no world-side change unless we want a zone.
const GAME_URLS = Object.freeze({
  'jump-climber': '/games/jump-climber/index.html',
  'sseuk-sseuk': '/games/sseuk-sseuk/index.html',
  'machine-animal-runner': '/games/machine-animal-runner/index.html',
});

const PROTOCOL_VERSION = 1;
const MAX_NAME_LEN = 16;
const HEARTBEAT_TIMEOUT_MS = 30_000;

const WORLD_BOUNDS = { width: 960, height: 960 };
const SPAWN_POINT = { x: 480, y: 520 };

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
    // Active match proposals. Memory-only — tied to live WebSocket sessions
    // which can't survive hibernation anyway. Host decides when to start; no
    // server-side deadline.
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

    // GET /state — anonymous lounge snapshot (online + per-zone counts) used
    // by the join panel to show "지금 N명이 광장에 있어요" before WS upgrade.
    if (url.pathname.endsWith('/state')) {
      let online = 0;
      const zoneCounts = new Map();
      for (const ws of this.state.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (!a?.sessionId) continue;
        online += 1;
        if (a.currentZoneId) {
          zoneCounts.set(a.currentZoneId, (zoneCounts.get(a.currentZoneId) || 0) + 1);
        }
      }
      const zones = [];
      for (const [zoneId, count] of zoneCounts) zones.push({ zoneId, count });
      return new Response(JSON.stringify({ online, zones }), {
        headers: { 'Content-Type': 'application/json' },
      });
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
    // 과도하게 큰 프레임은 parse 전에 차단 (DO isolate 보호 — GameRoom 과 동일 정책).
    const rawLen = typeof raw === 'string' ? raw.length : (raw && raw.byteLength) || 0;
    if (rawLen > 65536) return this._sendError(ws, 'TOO_LARGE', 'message too large');
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

    // 전역 try/catch — 핸들러 안에서 예외가 throw 되면 async 가 silently
    // 삼켜져 클라가 welcome/error 둘 다 못 받고 무한 로딩에 빠진다. 어떤
    // 경우든 SERVER_ERROR 로 응답해 클라가 picker 로 복원하도록 보장.
    try {
      switch (t) {
        case 'join_world':
          return await this._handleJoin(ws, attach, d);
        case 'move':
          return await this._handleMove(ws, attach, d);
        case 'chat':
          return await this._handleChat(ws, attach, d);
        case 'reaction':
          return await this._handleReaction(ws, attach, d);
        case 'match_start':
          return await this._handleMatchStart(ws, attach, d);
        case 'match_leave':
          return await this._handleMatchLeave(ws, attach, d);
        case 'pong':
          ws.serializeAttachment({ ...attach, lastHeartbeat: Date.now() });
          return;
        default:
          return this._sendError(ws, 'UNKNOWN_TYPE', `unknown message type: ${String(t)}`);
      }
    } catch (err) {
      // Cloudflare worker logs (wrangler tail) 에서 추적 가능.
      console.error('[world] handler threw for type', t, err && err.stack ? err.stack : err);
      try {
        this._sendError(ws, 'SERVER_ERROR', '서버에서 처리 중 오류가 발생했어요.');
      } catch { /* socket closed — nothing to do */ }
    }
  }

  async webSocketClose(ws) {
    const attach = ws.deserializeAttachment() || {};
    if (!attach.sessionId) return;

    this._broadcast({ t: 'player_left', d: { id: attach.sessionId } }, ws);

    this._track(this._logSessionLeft(attach.sessionId)); // 퇴장 시각 기록

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

  // ── Access / chat logging to D1 (관리자 통계) ────────────────────────────────
  // 광장 접속·대화를 D1 에 영구 적재. 라이브 WS 경로를 막지 않도록 호출부에서
  // _track() 으로 fire-and-forget 하고, 여기선 절대 throw 하지 않는다(leaderboard
  // 제출과 동일 관례). DB 바인딩이 없으면(로컬 등) 조용히 무시. 보관기간 정리는
  // index.js 의 scheduled(cron) 가 담당한다.

  // 백그라운드 쓰기 추적 — waitUntil 가능하면 DO 가 곧장 idle 돼도 안 끊기게.
  _track(promise) {
    const p = Promise.resolve(promise).catch((err) =>
      console.error('[world] log write failed', err && err.stack ? err.stack : err));
    if (this.state && typeof this.state.waitUntil === 'function') {
      try { this.state.waitUntil(p); } catch { /* ignore */ }
    }
  }

  async _logSessionJoin(me) {
    if (!this.env?.DB || !me?.id) return;
    await this.env.DB.prepare(
      `INSERT INTO world_sessions (session_id, lounge_id, name, character_id, joined_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(me.id, this.loungeId, me.name, me.characterId || null, Date.now()).run();
  }

  async _logSessionLeft(sessionId) {
    if (!this.env?.DB || !sessionId) return;
    await this.env.DB.prepare(
      `UPDATE world_sessions SET left_at = ?
       WHERE session_id = ? AND left_at IS NULL`
    ).bind(Date.now(), sessionId).run();
  }

  async _logChat(entry, zoneId) {
    if (!this.env?.DB || !entry?.text) return;
    await this.env.DB.prepare(
      `INSERT INTO world_chat_log (session_id, lounge_id, name, text, zone_id, ts)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(entry.id || null, this.loungeId, entry.name, entry.text, zoneId || null, entry.ts).run();
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

    this._track(this._logSessionJoin(me)); // 접속 기록(관리자 통계)
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

    // 발사 중인 proposal 은 멤버 변화에 반응하지 않는다 — launch race 방지.
    // (라운치가 끝나면 proposal 은 _launchProposal 끝에서 삭제됨)
    if (existing && existing.phase === 'launching') return;

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

  /* Any seated READY member clicks "시작" — first-wins. The first click claims
   * the proposal by setting phase='launching' BEFORE any await; concurrent
   * clicks see the phase and return silently (their modal is already locked
   * by the match_starting broadcast).
   *
   * Note: hostId is now presentation-only (leader badge). Power to start is
   * granted to every current seated member — the social model is "READY 자체가
   * 동의" 로 해석.
   */
  async _handleMatchStart(ws, attach, d) {
    if (!attach.sessionId) return;
    const matchId = typeof d?.matchId === 'string' ? d.matchId : null;
    if (!matchId) return this._sendError(ws, 'BAD_REQUEST', '잘못된 요청입니다.');
    const proposal = this.proposals.get(matchId);
    if (!proposal) return this._sendError(ws, 'NO_PROPOSAL', '매칭이 만료되었습니다. 잠시 후 다시 시도해주세요.');

    // First-wins lock: 이미 발사 중이면 늦은 클릭은 silent ok. 클라 모달은
    // 이미 match_starting 으로 잠겨있으니 다시 알릴 필요 없다.
    if (proposal.phase === 'launching') return;

    // seated 멤버만 시작 가능. stale UI 로 over-cap 대기자가 누르는 경우 차단.
    if (!proposal.lastMemberIds || !proposal.lastMemberIds.has(attach.sessionId)) {
      return this._sendError(ws, 'NOT_MEMBER', '매칭 멤버가 아닙니다.');
    }

    const zone = getZone(proposal.zoneId);
    if (!zone) return this._cancelProposal(proposal, 'invalid');

    // ★ first-wins claim — 반드시 첫 await 전에 세팅.
    // 이걸 await 뒤에 두면 동시 두 클릭이 둘 다 진입해서 같은 proposal 을
    // 두 번 처리하게 된다 (Codex 가 지적한 핵심 race).
    proposal.phase = 'launching';
    proposal.startedBy = attach.sessionId;

    // 모든 seated 멤버에게 즉시 잠금 신호. 클라는 모든 버튼을 disable 하고
    // "OOO님이 시작합니다!" 표시.
    this._broadcastMatchStarting(proposal, attach);

    // seated 재계산 — INTENT_READY 멤버만 카운트. Comparator는 _syncProposalForZone
    // 과 동일해야 view 와 launch 집합이 일치한다.
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
      // 락 해제 — 다른 멤버 모달도 풀어줘야 한다.
      proposal.phase = null;
      proposal.startedBy = null;
      this._broadcastMatchUnstarting(proposal);
      this._sendError(ws, 'MIN_PLAYERS', `최소 ${zone.minPlayers}명이 필요합니다.`);
      return;
    }
    proposal.players = seatedIds;
    await this._launchProposal(proposal);
  }

  /* Tell every currently-seated member that someone clicked 시작. Clients
   * lock their modal until either go_to_game (success) or match_unstarting
   * (server backed out after min-recheck) arrives.
   */
  _broadcastMatchStarting(proposal, starterAttach) {
    const msg = {
      t: 'match_starting',
      d: {
        matchId: proposal.matchId,
        startedBy: {
          id: starterAttach.sessionId,
          name: starterAttach.name,
          characterId: starterAttach.characterId,
        },
      },
    };
    for (const w of this.state.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a?.sessionId && proposal.lastMemberIds && proposal.lastMemberIds.has(a.sessionId)) {
        this._send(w, msg);
      }
    }
  }

  /* Release the modal lock when the launch is aborted post-claim (e.g. a
   * member dropped INTENT_READY between the claim and the seated recheck).
   */
  _broadcastMatchUnstarting(proposal) {
    const msg = { t: 'match_unstarting', d: { matchId: proposal.matchId } };
    for (const w of this.state.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a?.sessionId && proposal.lastMemberIds && proposal.lastMemberIds.has(a.sessionId)) {
        this._send(w, msg);
      }
    }
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
      proposal.phase = null;
      proposal.startedBy = null;
      this._broadcastMatchUnstarting(proposal);
      this._cancelProposal(proposal, 'invalid');
      return;
    }

    // Codex review: 이 함수 어디서든 throw 가 새면 proposal 이 phase='launching'
    // 으로 좀비가 되어 후속 클릭이 영원히 차단된다. 전체를 try/catch 로 감싸서
    // 어떤 실패도 잠금 복구 + cancel 로 끝나게 한다.
    try {
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

      return this._finishLaunch(proposal, memberSockets);
    } catch (err) {
      // 어떤 예외든 잠금 복구 + cancel. 좀비 proposal 방지.
      proposal.phase = null;
      proposal.startedBy = null;
      this._broadcastMatchUnstarting(proposal);
      this._cancelProposal(proposal, 'invalid');
      return;
    }
  }

  /* Finalize the launch: flip every member to IN_GAME, push match_confirmed +
   * go_to_game. Split out of _launchProposal so the outer try/catch covers it.
   */
  _finishLaunch(proposal, memberSockets) {

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

    this._track(this._logChat(entry, attach.currentZoneId ?? null)); // 대화 기록
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
