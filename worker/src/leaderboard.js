export function getWeekKey(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);

  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function submitScore(db, { playerName, gameId, score, roomCode, characterId }) {
  const weekKey = getWeekKey();
  const normalizedScore = Math.trunc(Number(score));

  if (!playerName || !gameId || !Number.isFinite(normalizedScore)) {
    throw new Error('playerName, gameId, and score are required');
  }

  const existing = await db.prepare(`
    SELECT MAX(score) AS best_score
    FROM scores
    WHERE player_name = ? AND game_id = ? AND week_key = ?
  `).bind(playerName, gameId, weekKey).first();

  const previousBest = existing?.best_score == null ? null : Number(existing.best_score);

  await db.prepare(`
    INSERT INTO scores (player_name, game_id, score, week_key, room_code, character_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(playerName, gameId, normalizedScore, weekKey, roomCode || null, characterId || null).run();

  const rankRow = await db.prepare(`
    SELECT COUNT(*) + 1 AS player_rank
    FROM (
      SELECT player_name, MAX(score) AS best_score
      FROM scores
      WHERE game_id = ? AND week_key = ?
      GROUP BY player_name
      HAVING MAX(score) > ?
    )
  `).bind(gameId, weekKey, normalizedScore).first();

  return {
    isNewRecord: previousBest == null || normalizedScore > previousBest,
    previousBest,
    rank: Number(rankRow?.player_rank || 1),
  };
}

export async function getWeeklyLeaderboard(db, gameId) {
  const weekKey = getWeekKey();
  // character_id = 그 주 최고 기록을 낸 판의 캐릭터 (동점이면 최신 판 기준)
  const { results } = await db.prepare(`
    SELECT
      player_name,
      MAX(score) AS best_score,
      COUNT(*) AS games_played,
      (
        SELECT s2.character_id FROM scores s2
        WHERE s2.player_name = s1.player_name
          AND s2.game_id = s1.game_id
          AND s2.week_key = s1.week_key
        ORDER BY s2.score DESC, s2.id DESC
        LIMIT 1
      ) AS character_id
    FROM scores s1
    WHERE game_id = ? AND week_key = ?
    GROUP BY player_name
    ORDER BY best_score DESC, player_name ASC
    LIMIT 20
  `).bind(gameId, weekKey).all();

  return results || [];
}
