/* GAME_ZONES — server-authoritative zone catalog for the world channel.
 *
 * minPlayers/maxPlayers are aligned with each prototype's actual seat count,
 * not the original brief (jump=8 was wrong; jump only seats 2).
 *
 *   jump-climber        : 1..2  (worker/src/room.js JUMP_SESSION_LIMITS.players)
 *   sseuk-sseuk         : 2..6  (registry recommendedPlayers)
 *   mallang-stairs      : 1..6  (time-limited relay race)
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
  { gameId: 'mallang-stairs',        title: '말랑 계단 레이스',   minPlayers: 1, maxPlayers: 6 },
  // 'machine-animal-runner' 는 광장 정면 부스에서 내려 '실험실'(🧪)로 이동했다.
  //   → registry.js 의 stage:'LAB' 로 노출, world/world.js 의 클라 전용 실험실
  //     부스가 목록을 렌더한다(매칭 없음, ?from=lab 솔로 진입). 협동은 ?coop= 직접 URL.
  // 정식 부스 3번째 슬롯은 mallang-stairs가 사용한다.
  // 실험실 LAB_BOOTH는 world/world.js에서 x:571,y:424로 이동해 겹치지 않는다.
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

// ── 실험실(🧪) 자동 페어링 풀 — 논리 zone (물리 부스 아님) ──────────────────────
// 실험실 패널의 '같이하기' 버튼이 lab_queue 로 진입시키는 게임별 매칭 풀.
// 부스처럼 위치(rect)·dwell(holdMs) 이 없고, 클라가 명시적으로 큐에 들어온다
// (world.js _handleLabQueue). 발사는 기존 월드 매칭 파이프라인을 그대로 재사용하므로
// 여기 gameId 는 반드시 room.js GAME_PATHS + world.js GAME_URLS 에 등록돼 있어야 한다.
//   현재 충족: machine-animal-runner (GameRoom 권위 협동방).
//   mallang-stairs는 MallangRelay 게임이다. 여기서는 lab_queue 자동 매칭에서만
//   제외하며, 정식 부스의 world-launch 파이프라인은 탈 수 있다.
const LAB_ZONE_PREFIX = 'lab:';
const LAB_MATCH_CATALOG = [
  { gameId: 'machine-animal-runner', title: '말랑프렌즈 러너', minPlayers: 2, maxPlayers: 2 },
];
const LAB_ZONES_BY_ID = new Map(LAB_MATCH_CATALOG.map((b) => {
  const id = LAB_ZONE_PREFIX + b.gameId;
  return [id, {
    id, gameId: b.gameId, title: b.title, rect: null,
    minPlayers: b.minPlayers, maxPlayers: b.maxPlayers, holdMs: 0,
  }];
}));

export function isLabZoneId(zoneId) {
  return typeof zoneId === 'string' && zoneId.startsWith(LAB_ZONE_PREFIX);
}

export function getLabZoneForGame(gameId) {
  return LAB_ZONES_BY_ID.get(LAB_ZONE_PREFIX + gameId) || null;
}

export function getZone(zoneId) {
  return ZONES_BY_ID.get(zoneId) || LAB_ZONES_BY_ID.get(zoneId) || null;
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
