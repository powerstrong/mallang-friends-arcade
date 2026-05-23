import { getWeekKey, getWeeklyLeaderboard } from './leaderboard.js';

export { GameRoom } from './room.js';
export { WorldChannel } from './world.js';

const LOUNGE_ID_PATTERN = /^lounge-[a-z0-9-]{1,32}$/;

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

    // POST /api/rooms - create a new room
    if (method === 'POST' && url.pathname === '/api/rooms') {
      const code = String(Math.floor(Math.random() * 9000) + 1000);

      // Instantiate the Durable Object for this room
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);

      // Prime the room with its code
      await stub.fetch(new Request(`${url.origin}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }));

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
};
