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
  // proposed/in_game are owned by the world-channel match lifecycle — movement
  // alone never demotes them.
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
