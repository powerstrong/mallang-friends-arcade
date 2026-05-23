/* Pure functions for world-channel matching.
 *
 * No I/O, no Date.now() — every entry point takes the values it needs so that
 * the unit tests can drive the state machine deterministically.
 */

export const PLAYER_STATUS = Object.freeze({
  ROAM: 'roam',
  CANDIDATE: 'candidate',
  INTENT_READY: 'intent_ready',
  PROPOSED: 'proposed',
  IN_GAME: 'in_game',
});

/* Update one player's zone-related status given their current position.
 * Returns the next player snapshot (does not mutate the input).
 *
 *   prev      : player snapshot { status, currentZoneId, candidateSince }
 *   zone      : zone the player is currently inside, or null. If holdMs is
 *               omitted, zone.holdMs is used.
 *   now       : monotonic timestamp in ms
 *   holdMs    : dwell time required to reach intent_ready (override)
 */
export function applyZonePresence(prev, zone, now, holdMs) {
  // proposed/in_game are managed by the match lifecycle (clearProposed,
  // markInGame, etc.). Movement alone never demotes them.
  if (prev.status === PLAYER_STATUS.PROPOSED || prev.status === PLAYER_STATUS.IN_GAME) {
    return prev;
  }

  if (!zone) {
    if (prev.status === PLAYER_STATUS.ROAM && prev.currentZoneId == null && prev.candidateSince == null) {
      return prev;
    }
    return { ...prev, status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null };
  }

  const dwell = holdMs != null ? holdMs : zone.holdMs;
  const sameZone = prev.currentZoneId === zone.id;
  // Heal stale state: if zone matches but status is roam, or candidateSince is
  // missing, treat as fresh entry rather than freezing in candidate forever.
  const stale = sameZone && (prev.status === PLAYER_STATUS.ROAM || prev.candidateSince == null);

  if (!sameZone || stale) {
    return {
      ...prev,
      status: PLAYER_STATUS.CANDIDATE,
      currentZoneId: zone.id,
      candidateSince: now,
    };
  }

  if (prev.status === PLAYER_STATUS.INTENT_READY) return prev;

  const elapsed = now - prev.candidateSince;
  if (elapsed >= dwell) {
    return { ...prev, status: PLAYER_STATUS.INTENT_READY };
  }
  return { ...prev, status: PLAYER_STATUS.CANDIDATE };
}

/* Transition helpers for the proposal lifecycle. Each returns a new player
 * snapshot. Callers wire these into the WorldChannel state.
 */
export function markProposed(prev) {
  return { ...prev, status: PLAYER_STATUS.PROPOSED };
}

export function markInGame(prev) {
  return { ...prev, status: PLAYER_STATUS.IN_GAME };
}

/* Used when a proposal is cancelled. If the player is still inside the zone,
 * we requeue them at `now` so they have to re-dwell holdMs from scratch.
 */
export function clearProposed(prev, zone, now) {
  if (zone && prev.currentZoneId === zone.id) {
    return { ...prev, status: PLAYER_STATUS.CANDIDATE, candidateSince: now };
  }
  return { ...prev, status: PLAYER_STATUS.ROAM, currentZoneId: null, candidateSince: null };
}

/* Deterministic seat ordering: earliest candidateSince wins; ties broken by
 * id so iteration order can't shuffle membership between two equivalent
 * resolutions. Exported so the runtime WorldChannel paths can use the SAME
 * comparator and the proposal view stays consistent with the launch set.
 */
export function compareReadyForSeat(a, b) {
  const sa = a.candidateSince ?? Number.MAX_SAFE_INTEGER;
  const sb = b.candidateSince ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  return String(a.id).localeCompare(String(b.id));
}

/* Pull a single match group out of the players currently intent_ready in a
 * zone. Returns null if not enough players, otherwise an object describing
 * the group (caller is responsible for transitioning the players to PROPOSED
 * and removing them from the queue).
 *
 *   players   : array of player snapshots (any status)
 *   zone      : zone definition with min/maxPlayers
 */
export function tryFormMatch(players, zone) {
  const ready = players
    .filter((p) => p.status === PLAYER_STATUS.INTENT_READY && p.currentZoneId === zone.id)
    .sort(compareReadyForSeat);

  if (ready.length < zone.minPlayers) return null;
  const take = Math.min(ready.length, zone.maxPlayers);
  return { zoneId: zone.id, gameId: zone.gameId, players: ready.slice(0, take).map((p) => p.id) };
}

/* Resolve a proposal at time `now`.
 *
 *   proposal  : { players, accepted, declined, deadline }
 *   now       : current time in ms
 *
 * Returns one of:
 *   { kind: 'pending' }
 *   { kind: 'launch', players: [...] }
 *   { kind: 'cancel', reason: 'declined'|'timeout'|'invalid' }
 *
 * Defensive contract:
 *   - empty `players` is invalid (vacuous launch is forbidden).
 *   - accepted/declined are filtered to actual proposal members; outsiders
 *     are ignored rather than triggering a cancel.
 *   - deadline takes precedence: once now >= deadline, only a fully-accepted
 *     proposal still launches; otherwise it times out.
 */
export function resolveProposal(proposal, now) {
  const members = new Set(proposal.players);
  if (members.size === 0) {
    return { kind: 'cancel', reason: 'invalid' };
  }

  const declined = (proposal.declined || []).filter((id) => members.has(id));
  if (declined.length > 0) {
    return { kind: 'cancel', reason: 'declined' };
  }

  const accepted = new Set((proposal.accepted || []).filter((id) => members.has(id)));
  const allAccepted = proposal.players.every((id) => accepted.has(id));

  if (allAccepted) {
    return { kind: 'launch', players: [...proposal.players] };
  }
  if (now >= proposal.deadline) {
    return { kind: 'cancel', reason: 'timeout' };
  }
  return { kind: 'pending' };
}
