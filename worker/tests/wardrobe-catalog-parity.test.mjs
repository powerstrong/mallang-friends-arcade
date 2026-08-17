/* 카탈로그 클라/서버 미러 패리티 (AVATAR_DESIGN.md §11 — P3-2 조기 도입).
 *
 * 카탈로그는 shared/wardrobe_catalog.js ↔ worker/src/wardrobe.js 2벌 미러다.
 * 한쪽만 고치면 서버 sanitize 가 착장을 프리셋으로 치환해 "저장했는데 남에게
 * 기본 코디로 보임" 사고가 난다 — 아이템 추가가 잦아진 시점(fit 태그 도입)에
 * 파싱 비교로 강제한다. 서버는 검증 최소 필드(id·slot·fit)만 미러링하므로
 * 그 교집합 + 프리셋 + 팔레트 + catalogVersion 을 비교한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { WARDROBE } from '../src/wardrobe.js';

async function loadClientCatalog() {
  const path = fileURLToPath(new URL('../../shared/wardrobe_catalog.js', import.meta.url));
  const code = await readFile(path, 'utf8');
  const windowStub = {};
  new Function('window', code)(windowStub);
  return windowStub.WARDROBE;
}

test('클라/서버 카탈로그 미러 동기 — catalogVersion·팔레트·프리셋·아이템(id/slot/fit)', async () => {
  const client = await loadClientCatalog();

  assert.equal(client.catalogVersion, WARDROBE.catalogVersion, 'catalogVersion');
  assert.deepEqual([...client.hairPalettes], [...WARDROBE.hairPalettes], 'hairPalettes');

  assert.deepEqual(Object.keys(client.presets).sort(), Object.keys(WARDROBE.presets).sort(), '프리셋 id');
  for (const [id, server] of Object.entries(WARDROBE.presets)) {
    for (const k of ['outfit', 'top', 'bottom', 'hair', 'hairColor', 'hat', 'faceAcc']) {
      assert.equal(client.presets[id][k], server[k], `preset ${id}.${k}`);
    }
  }

  const strip = (items) => items
    .map((i) => ({ id: i.id, slot: i.slot, fit: i.fit || 'all' }))
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(strip([...client.items]), strip([...WARDROBE.items]), '아이템 id/slot/fit');
});
