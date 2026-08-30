/* 실험실 '같이하기' 게임 등록 패리티.
 *
 * 실험실 매칭 게임 하나를 띄우려면 서로 다른 파일 네 곳에 같은 gameId 가 있어야 한다:
 *   worldZones LAB_MATCH_CATALOG  — 매칭 큐(존)
 *   world.js   GAME_URLS          — 큐 진입 허용 + 발사 URL
 *   room.js    GAME_PATHS         — 방 시딩 허용
 *   registry.js labMatch:true     — 광장 실험실 카드의 '같이하기' 버튼
 *
 * 초이스 홀덤 첫 배포에서 GAME_URLS 하나를 빠뜨려 '같이하기' 버튼이 아무 반응도
 * 하지 않았다(서버가 BAD_REQUEST 로 조용히 거절). 사람이 네 곳을 기억하는 대신
 * 여기서 강제한다. GAME_URLS·GAME_PATHS 는 export 되지 않으므로 소스를 파싱한다
 * (wardrobe-catalog-parity 와 같은 방식).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { getLabZoneForGame } from '../src/worldZones.js';
import { SERVER_GAME_MODULES } from '../src/gameModules.js';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* `const NAME = Object.freeze({...})` / `const NAME = {...}` 의 키 목록을 뽑는다. */
async function objectKeys(relPath, constName) {
  const code = await read(relPath);
  const start = code.indexOf(`const ${constName} =`);
  assert.notEqual(start, -1, `${relPath} 에서 ${constName} 을 찾지 못했습니다.`);
  const open = code.indexOf('{', start);
  const close = code.indexOf('};', open);
  const body = code.slice(open, close + 1);
  return [...body.matchAll(/'([a-z0-9-]+)'\s*:/g)].map((m) => m[1]);
}

async function labMatchCatalog() {
  const code = await read('../src/worldZones.js');
  const start = code.indexOf('const LAB_MATCH_CATALOG =');
  assert.notEqual(start, -1);
  const open = code.indexOf('[', start);
  const close = code.indexOf('];', open);
  return [...code.slice(open, close).matchAll(/gameId:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

async function registry() {
  const code = await read('../../games/registry.js');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 5000 });
  return sandbox.window.GAME_REGISTRY;
}

test('실험실 매칭 게임은 네 곳에 모두 등록돼 있어야 한다', async () => {
  const catalog = await labMatchCatalog();
  assert.ok(catalog.length > 0, 'LAB_MATCH_CATALOG 가 비어 있습니다.');

  const gameUrls = await objectKeys('../src/world.js', 'GAME_URLS');
  const gamePaths = await objectKeys('../src/room.js', 'GAME_PATHS');
  const games = await registry();

  for (const gameId of catalog) {
    assert.ok(getLabZoneForGame(gameId), `${gameId}: lab 존이 만들어지지 않습니다.`);
    assert.ok(gameUrls.includes(gameId),
      `${gameId}: world.js GAME_URLS 누락 — '같이하기' 가 BAD_REQUEST 로 조용히 거절됩니다.`);
    assert.ok(gamePaths.includes(gameId),
      `${gameId}: room.js GAME_PATHS 누락 — 방 시딩이 400 으로 실패합니다.`);

    const entry = games.find((g) => g.id === gameId);
    assert.ok(entry, `${gameId}: games/registry.js 에 항목이 없습니다.`);
    assert.equal(entry.labMatch, true, `${gameId}: registry labMatch 가 true 가 아닙니다.`);
    assert.equal(entry.stage, 'LAB', `${gameId}: registry stage 가 'LAB' 이 아닙니다.`);
  }
});

test('실험실 매칭 게임의 발사 URL 은 registry path 와 같아야 한다', async () => {
  const catalog = await labMatchCatalog();
  const worldSrc = await read('../src/world.js');
  const games = await registry();
  for (const gameId of catalog) {
    const entry = games.find((g) => g.id === gameId);
    assert.ok(worldSrc.includes(`'${gameId}': '${entry.path}'`),
      `${gameId}: world.js 발사 경로가 registry path(${entry.path}) 와 다릅니다.`);
  }
});

test('서버 권위형 모듈 게임은 클라이언트가 존재해야 한다', async () => {
  const games = await registry();
  for (const gameId of SERVER_GAME_MODULES.keys()) {
    if (gameId.startsWith('example-')) continue;   // 레퍼런스 모듈은 템플릿을 클라로 쓴다
    const entry = games.find((g) => g.id === gameId);
    assert.ok(entry, `${gameId}: 서버 모듈은 있는데 registry 항목이 없습니다.`);
  }
});

test('초이스 홀덤 클라이언트는 config.js 를 읽어야 한다(WORKER_URL)', async () => {
  // config.js 가 없으면 window.WORKER_URL 이 비어 정적 호스트로 /api/rooms 를 때린다
  // → 방 만들기·WebSocket 이 둘 다 실패. 첫 배포에서 실제로 났던 사고다.
  const html = await read('../../games/choice-holdem/index.html');
  assert.ok(html.includes('/shared/config.js'), 'index.html 이 /shared/config.js 를 로드하지 않습니다.');
  assert.ok(
    html.indexOf('/shared/config.js') < html.indexOf('<script type="module">'),
    'config.js 는 모듈 스크립트보다 먼저 로드돼야 합니다.'
  );
});
