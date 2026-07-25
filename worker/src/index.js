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
    await env.DB.prepare('DELETE FROM runner_events WHERE ts < ?').bind(cutoff).run();
  } catch (err) {
    console.error('[cron] world log prune failed', err && err.stack ? err.stack : err);
  }
}

// 러너 텔레메트리 배치 적재 한도 — 인증 없는 공개 엔드포인트라 남용 방어가 필수(codex 리뷰).
// IP 레이트리밋은 KV/DO 없이는 비용이 커서 미구현(광장 로깅과 동일한 수용 리스크) —
// 대신 본문 크기·이벤트 allowlist·ts/stage clamp·run_id 1회성으로 쓰기 비용을 제한한다.
const TELEMETRY_MAX_BODY = 32 * 1024; // Content-Length 사전 차단
const TELEMETRY_MAX_EVENTS = 60;
const TELEMETRY_MAX_PAYLOAD = 1024; // 이벤트당 payload JSON 문자열 최대 길이
const TELEMETRY_GAME_PATTERN = /^[a-z0-9-]{1,40}$/;
const TELEMETRY_RUN_PATTERN = /^[a-z0-9]{1,40}$/;
const TELEMETRY_EVENT_ALLOWLIST = new Set(['run_start', 'gate', 'death', 'run_end']);

async function ingestRunnerTelemetry(env, body) {
  if (!env?.DB) return { ok: false, status: 503 };
  const game = typeof body?.game === 'string' ? body.game : '';
  const runId = typeof body?.runId === 'string' ? body.runId : '';
  const stage = Number.isInteger(body?.stage) ? Math.max(0, Math.min(99, body.stage)) : 0;
  const events = Array.isArray(body?.events) ? body.events.slice(0, TELEMETRY_MAX_EVENTS) : [];
  if (!TELEMETRY_GAME_PATTERN.test(game) || !TELEMETRY_RUN_PATTERN.test(runId) || events.length === 0) {
    return { ok: false, status: 400 };
  }
  // run_id 는 1회성 — 같은 런 재전송(리플레이 스팸) 거부. 읽기 1회 비용으로 쓰기 남용을 줄인다.
  const dup = await env.DB.prepare('SELECT 1 FROM runner_events WHERE run_id = ? LIMIT 1')
    .bind(runId).first();
  if (dup) return { ok: false, status: 409 };
  const now = Date.now();
  const stmt = env.DB.prepare(
    'INSERT INTO runner_events (game, run_id, stage, ev, payload, ts) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const rows = [];
  for (const e of events) {
    const ev = typeof e?.ev === 'string' ? e.ev : '';
    if (!TELEMETRY_EVENT_ALLOWLIST.has(ev)) continue;
    let payload = '';
    try { payload = JSON.stringify(e.payload ?? {}).slice(0, TELEMETRY_MAX_PAYLOAD); } catch { payload = '{}'; }
    // 클라 ts 는 정렬용으로만 신뢰 — 미래/과거 ts 로 보관기간(cron, ts 기준)을 우회 못 하게 clamp.
    let ts = Number.isFinite(e?.ts) ? e.ts : now;
    if (ts > now + 5 * 60 * 1000 || ts < now - 24 * 60 * 60 * 1000) ts = now;
    rows.push(stmt.bind(game, runId, stage, ev, payload, ts));
  }
  if (rows.length === 0) return { ok: false, status: 400 };
  await env.DB.batch(rows);
  return { ok: true, status: 204 };
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

    // POST /api/telemetry/runner - 러너류 게임 플레이 텔레메트리 배치 적재.
    // 실패해도 클라는 무시하므로(파이어&포겟) 에러는 상태코드로만 답한다.
    if (method === 'POST' && url.pathname === '/api/telemetry/runner') {
      const clen = parseInt(request.headers.get('content-length') || '0', 10);
      if (clen > TELEMETRY_MAX_BODY) {
        return new Response(null, { status: 413, headers: CORS_HEADERS });
      }
      let body = null;
      try { body = await request.json(); } catch { /* malformed */ }
      if (!body) return corsResponse(JSON.stringify({ error: 'Bad Request' }), { status: 400 });
      try {
        const r = await ingestRunnerTelemetry(env, body);
        return new Response(null, { status: r.status, headers: CORS_HEADERS });
      } catch (err) {
        console.error('[telemetry] ingest failed', err && err.stack ? err.stack : err);
        return new Response(null, { status: 500, headers: CORS_HEADERS });
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
