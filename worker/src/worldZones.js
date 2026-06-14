/* GAME_ZONES — server-authoritative zone catalog for the world channel.
 *
 * minPlayers/maxPlayers are aligned with each prototype's actual seat count,
 * not the original brief (jump=8 was wrong; jump only seats 2).
 *
 *   jump-climber        : 1..2  (worker/src/room.js JUMP_SESSION_LIMITS.players)
 *   sseuk-sseuk         : 2..6  (registry recommendedPlayers)
 *
 * holdMs is the dwell time before a candidate becomes intent_ready.
 */

// 부스 카탈로그 — 게임을 광장에 노출하려면 여기 한 줄만 추가하면 된다.
// rect(픽셀 위치)는 BOOTH_LAYOUT 으로 인덱스 순서대로 자동 배치된다(직접 좌표 지정 불필요).
// holdMs 기본 3000ms. 클라이언트(world/world.js)는 서버가 보내는 이 zone 목록을 그대로
// 렌더하므로, 부스 추가 시 클라 좌표를 따로 맞출 필요가 없다.
// (단, 전용 부스 일러스트가 필요하면 world/assets/booth_<id>.png 추가 + world.js 매핑 보강.)
const BOOTH_CATALOG = [
  { gameId: 'jump-climber',          title: '말랑프렌즈 점프',     minPlayers: 1, maxPlayers: 2 },
  { gameId: 'sseuk-sseuk',           title: '말랑프렌즈 쓱쓱',     minPlayers: 2, maxPlayers: 6 },
  // 'machine-animal-runner' 는 광장 정면 부스에서 내려 '실험실'(🧪)로 이동했다.
  //   → registry.js 의 stage:'LAB' 로 노출, world/world.js 의 클라 전용 실험실
  //     부스가 목록을 렌더한다(매칭 없음, ?from=lab 솔로 진입). 협동은 ?coop= 직접 URL.
  // ⚠️ 부스가 3개 이상이 되면 상단 3열 그리드의 index 2(우측 상단) 슬롯을
  //    실험실 부스(world/world.js LAB_BOOTH, 좌표 x:571,y:200)가 점유 중이므로
  //    위치가 겹친다. 그때는 LAB_BOOTH 좌표를 옮길 것.
];

// Portrait(960x960) 광장 자동 레이아웃. 상단에 3열 그리드로 배치해 스폰 지점
// (SPAWN_POINT y=520)에서 충분히 떨어뜨린다. 부스가 3개를 넘으면 다음 행으로 내려간다.
// marginTop=200: object-fit:cover 가 가로 넓은 화면(Fold·가로모드)에서 위아래를
// ~130px 잘라내므로, 부스가 크롭 영역 바깥에 오도록 여유를 준다.
// cols=3, w=165, gapX=8, marginTop=200
const BOOTH_LAYOUT = { plazaWidth: 960, cols: 3, w: 165, h: 200, gapX: 8, gapY: 24, marginTop: 200 };

function boothRect(index) {
  const L = BOOTH_LAYOUT;
  const col = index % L.cols;
  const row = Math.floor(index / L.cols);
  const rowWidth = L.cols * L.w + (L.cols - 1) * L.gapX;
  const leftMargin = Math.round((L.plazaWidth - rowWidth) / 2);
  return {
    x: leftMargin + col * (L.w + L.gapX),
    y: L.marginTop + row * (L.h + L.gapY),
    w: L.w,
    h: L.h,
  };
}

export const GAME_ZONES = BOOTH_CATALOG.map((b, i) => ({
  id: b.gameId,
  gameId: b.gameId,
  title: b.title,
  rect: boothRect(i),
  minPlayers: b.minPlayers,
  maxPlayers: b.maxPlayers,
  holdMs: b.holdMs ?? 3000,
}));

const ZONES_BY_ID = new Map(GAME_ZONES.map((z) => [z.id, z]));

export function getZone(zoneId) {
  return ZONES_BY_ID.get(zoneId) || null;
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

export function findZoneAt(x, y) {
  for (const zone of GAME_ZONES) {
    if (pointInRect(x, y, zone.rect)) return zone;
  }
  return null;
}
