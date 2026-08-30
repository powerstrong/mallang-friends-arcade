import { getWeekKey, getWeeklyLeaderboard, submitScore } from './leaderboard.js';

export { GameRoom } from './room.js';
export { WorldChannel } from './world.js';

const LOUNGE_ID_PATTERN = /^lounge-[a-z0-9-]{1,32}$/;

// 광장 접속·대화 로그 보관기간(일). 개인정보(닉네임·대화)이므로 무한 보관하지 않고
// 아래 scheduled(cron) 가 매일 이 기간보다 오래된 행을 삭제한다. 기간 조정은 이 값만.
const WORLD_LOG_RETENTION_DAYS = 90;

async function pruneWorldLogs(env) {
  if (!env?.DB) return;
  const cutoff = Date.now() - WORLD_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    await env.DB.prepare('DELETE FROM world_chat_log WHERE ts < ?').bind(cutoff).run();
    await env.DB.prepare('DELETE FROM world_sessions WHERE joined_at < ?').bind(cutoff).run();
    // runner_events 는 쓰는 게임이 사라졌지만(기계동물 러너 정리) 과거 행이 남아 있어
    // 보관기간 정리는 그대로 돈다. 테이블 자체를 없애려면 별도 마이그레이션이 필요하다.
    await env.DB.prepare('DELETE FROM runner_events WHERE ts < ?').bind(cutoff).run();
  } catch (err) {
    console.error('[cron] world log prune failed', err && err.stack ? err.stack : err);
  }
}

// 클라이언트가 직접 점수를 제출할 수 있는 게임(서버 권위가 없는 relay/솔로 게임).
// 서버 권위형 게임은 여기에 넣지 않는다 — GameRoom DO 가 직접 제출한다.
const CLIENT_SUBMIT_GAMES = new Set(['mallang-stairs']);
const SCORE_SUBMIT_MAX = 1_000_000;  // 제출 원값(층/점수) 각각의 상한 — 스푸핑 완화
// 층 순위를 우선하되 같은 층이면 점수로 가르기 위해, 저장 점수를 (층*BASE + 점수)
// 복합값으로 인코딩한다. 리더보드 보기(leaderboard/index.html)가 층을 다시 디코드한다.
const STAIRS_TIE_BASE = 100_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsResponse(body, init = {}) {
  const { status = 200, headers = {} } = init;
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET /api/leaderboard?game=:game
    if (method === 'GET' && url.pathname === '/api/leaderboard') {
      const game = url.searchParams.get('game');
      if (!game) {
        return corsResponse(JSON.stringify({ error: 'Missing game parameter' }), { status: 400 });
      }

      const entries = await getWeeklyLeaderboard(env.DB, game);
      return corsResponse(JSON.stringify({ game, week: getWeekKey(), entries }));
    }

    // POST /api/leaderboard - 클라이언트가 직접 점수를 제출한다.
    // 서버 권위형 게임(jump-climber/sseuk-sseuk 등)은 GameRoom DO 가 자체 제출하므로
    // 여기서는 허용하지 않는다(스푸핑·이중집계 방지). relay/솔로 게임처럼 서버가
    // 점수를 알 수 없는 게임만 화이트리스트로 열어 둔다.
    if (method === 'POST' && url.pathname === '/api/leaderboard') {
      const clen = parseInt(request.headers.get('content-length') || '0', 10);
      if (clen > 2048) {
        return corsResponse(JSON.stringify({ error: 'Payload too large' }), { status: 413 });
      }
      let body = null;
      try { body = await request.json(); } catch { /* malformed */ }
      if (!body) return corsResponse(JSON.stringify({ error: 'Bad Request' }), { status: 400 });

      const game = String(body.game || '');
      if (!CLIENT_SUBMIT_GAMES.has(game)) {
        return corsResponse(JSON.stringify({ error: 'Unsupported game' }), { status: 403 });
      }
      const playerName = String(body.name || '').trim().slice(0, 24);
      const score = Math.trunc(Number(body.score));
      if (!playerName || !Number.isFinite(score) || score < 0 || score > SCORE_SUBMIT_MAX) {
        return corsResponse(JSON.stringify({ error: 'Invalid submission' }), { status: 400 });
      }
      // 같은 층이면 점수로 순위를 가르도록 (층*BASE + 점수) 복합값으로 저장한다.
      const rawTiebreak = Math.trunc(Number(body.tiebreak) || 0);
      const tiebreak = Math.max(0, Math.min(STAIRS_TIE_BASE - 1, rawTiebreak));
      const storedScore = score * STAIRS_TIE_BASE + tiebreak;
      const characterId = body.characterId ? String(body.characterId).slice(0, 40) : null;
      const roomCode = body.roomCode ? String(body.roomCode).slice(0, 16) : null;
      try {
        const result = await submitScore(env.DB, { playerName, gameId: game, score: storedScore, roomCode, characterId });
        return corsResponse(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        console.error('[leaderboard] submit failed', err && err.stack ? err.stack : err);
        return corsResponse(JSON.stringify({ error: 'Server error' }), { status: 500 });
      }
    }

    // POST /api/rooms - create a new room.
    // 4자리 코드는 공유가 쉬운 대신 충돌 가능성이 있으므로, 비어 있는(활성 연결 없는)
    // 방을 확보할 때까지 최대 N회 재시도한다. (/init 가 활성 방이면 409 반환)
    if (method === 'POST' && url.pathname === '/api/rooms') {
      let code = null;
      let secured = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        const candidate = String(Math.floor(Math.random() * 9000) + 1000);
        const id = env.GAME_ROOM.idFromName(candidate);
        const stub = env.GAME_ROOM.get(id);
        const initRes = await stub.fetch(new Request(`${url.origin}/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: candidate }),
        }));
        if (initRes.status !== 409) { code = candidate; secured = true; break; }
      }
      if (!secured) {
        return corsResponse(JSON.stringify({ error: '방 생성이 혼잡합니다. 잠시 후 다시 시도해 주세요.' }), { status: 503 });
      }
      return corsResponse(JSON.stringify({ code }));
    }

    // GET /api/rooms/:code - WebSocket upgrade to GameRoom DO.
    // Code can be a 4-digit lobby code (1234) OR a world-launched opaque id
    // (wm-abc123...). Both route to the same GameRoom DO; the regex was
    // widened from \d+ to [\w-]+ to accommodate world instance ids.
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([\w-]{1,40})$/);
    if (method === 'GET' && roomMatch) {
      const code = roomMatch[1];
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);
      // Forward the request (including Upgrade header) to the DO
      return stub.fetch(request);
    }

    // GET /api/world/:loungeId - WebSocket upgrade to WorldChannel DO
    const worldMatch = url.pathname.match(/^\/api\/world\/([a-z0-9-]+)$/);
    if (method === 'GET' && worldMatch) {
      const loungeId = worldMatch[1];
      if (!LOUNGE_ID_PATTERN.test(loungeId)) {
        return corsResponse(JSON.stringify({ error: 'Invalid lounge id' }), { status: 400 });
      }

      if (request.headers.get('Upgrade') !== 'websocket') {
        return corsResponse(JSON.stringify({ error: 'WebSocket upgrade required' }), { status: 426 });
      }

      const id = env.WORLD_CHANNEL.idFromName(loungeId);
      const stub = env.WORLD_CHANNEL.get(id);

      // Prime the lounge with its id on first contact (idempotent)
      await stub.fetch(new Request(`${url.origin}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loungeId }),
      }));

      return stub.fetch(request);
    }

    // GET /api/world/:loungeId/state - read-only lounge snapshot for the
    // join screen ("지금 N명이 광장에 있어요"). No WS upgrade.
    const worldStateMatch = url.pathname.match(/^\/api\/world\/([a-z0-9-]+)\/state$/);
    if (method === 'GET' && worldStateMatch) {
      const loungeId = worldStateMatch[1];
      if (!LOUNGE_ID_PATTERN.test(loungeId)) {
        return corsResponse(JSON.stringify({ error: 'Invalid lounge id' }), { status: 400 });
      }
      const id = env.WORLD_CHANNEL.idFromName(loungeId);
      const stub = env.WORLD_CHANNEL.get(id);
      const res = await stub.fetch(new Request(`${url.origin}/state`, { method: 'GET' }));
      const body = await res.text();
      return corsResponse(body, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    return corsResponse(JSON.stringify({ error: 'Not Found' }), { status: 404 });
  },

  // Cron(wrangler.toml [triggers].crons) — 광장 로그 보관기간 정리.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pruneWorldLogs(env));
  },
};
