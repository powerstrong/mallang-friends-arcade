const arena = document.getElementById("arena");
const worldEl = document.getElementById("world");
const setupScreen = document.getElementById("setupScreen");
const playScreen = document.getElementById("playScreen");
const statusEl = document.getElementById("status");
const setupHintEl = document.getElementById("setupHint");
const startButton = document.getElementById("startGame");
const restartButton = document.getElementById("restart");
const backToSetupButton = document.getElementById("backToSetup");
const playTitleEl = document.getElementById("playTitle");
const spectatorBadgeEl = document.getElementById("spectatorBadge");
const restartFromResultsButton = document.getElementById("restartFromResults");
const exitAfterResultsButton = document.getElementById("exitAfterResults");
const playerConfigCards = Array.from(document.querySelectorAll(".player-config"));
const hudListEl = document.getElementById("hudList");
const resultsOverlay = document.getElementById("resultsOverlay");
const resultRows = Array.from(document.querySelectorAll("[data-result-slot]"));
const resultNameEls = [document.getElementById("resultName1"), document.getElementById("resultName2")];
const resultScoreEls = [document.getElementById("resultScore1"), document.getElementById("resultScore2")];
const resultLeadEl = document.getElementById("resultLead");
const characterIntroEl = document.getElementById("characterIntro");
const introCharImgEl = document.getElementById("introCharImg");
const introCharNameEl = document.getElementById("introCharName");
const introCharAbilityEl = document.getElementById("introCharAbility");
const chatOverlayEl = document.getElementById("chatOverlay");
const chatMessagesEl = document.getElementById("chatMessages");
const chatToggleBtn = document.getElementById("chatToggle");
const chatInputWrap = document.getElementById("chatInputWrap");
const chatInputEl = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSend");
const rivalGaugeEl = document.getElementById("rivalGauge");
const rivalMarkerMeEl = document.getElementById("rivalMarkerMe");
const rivalMarkerRivalEl = document.getElementById("rivalMarkerRival");
const gameBoot = window.GameBoot || null;
const isRoomSession = Boolean(gameBoot && gameBoot.isMultiplayer);

// URL 플래그: ?perf=1 → FPS/worst-frame 미터 노출, ?mute=1 → Web Audio 비활성
const PERF_PARAMS = new URLSearchParams(window.location.search);
const PERF_METER_ENABLED = PERF_PARAMS.get("perf") === "1";
const AUDIO_MUTED = PERF_PARAMS.get("mute") === "1";

let perfMeterEl = null;
let perfFrameCount = 0;
let perfLastReportMs = 0;
let perfWorstFrameMs = 0;
let perfLastFrameMs = 0;

function initPerfMeter() {
  if (!PERF_METER_ENABLED) return;
  perfMeterEl = document.createElement("div");
  // 모바일 상단은 play-topbar(fixed, z-index 20)가 덮고 있으므로 우하단 터치 영역 위에 표시.
  perfMeterEl.style.cssText =
    "position:fixed;bottom:calc(env(safe-area-inset-bottom, 0px) + 80px);right:8px;z-index:9999;background:rgba(0,0,0,0.78);color:#0f0;padding:6px 10px;font-family:monospace;font-size:12px;line-height:1.3;pointer-events:none;border-radius:6px;font-weight:700;text-shadow:0 1px 2px #000";
  perfMeterEl.textContent = "—";
  document.body.appendChild(perfMeterEl);
}

function tickPerfMeter(now) {
  if (!perfMeterEl) return;
  if (perfLastFrameMs > 0) {
    const dt = now - perfLastFrameMs;
    if (dt > perfWorstFrameMs) perfWorstFrameMs = dt;
  }
  perfLastFrameMs = now;
  perfFrameCount += 1;
  if (now - perfLastReportMs >= 500) {
    const fps = (perfFrameCount * 1000) / (now - perfLastReportMs);
    perfMeterEl.textContent = `${fps.toFixed(0)}fps  worst:${perfWorstFrameMs.toFixed(0)}ms  effs:${state.effects.length}`;
    perfFrameCount = 0;
    perfWorstFrameMs = 0;
    perfLastReportMs = now;
  }
}

function assetPath(fileName) {
  return `./assets/${encodeURIComponent(fileName)}`;
}

const CHARACTER_LIST = [
  {
    id: "mochi-rabbit",
    name: "모찌 토끼",
    abilityText: "통! 통! 한 번 더 높이 ⬆",
    assets: {
      preview: assetPath("토끼 메인 이미지.png"),
      jump_neutral: assetPath("토끼 점프 위로.png"),
      jump_left: assetPath("토끼 왼쪽 점프.png"),
      jump_right: assetPath("토끼 오른쪽 점프.png"),
      fall_neutral: assetPath("토끼 추락.png"),
    },
  },
  {
    id: "pudding-hamster",
    name: "푸딩 햄스터",
    abilityText: "쪼르르~ 옆으로 발 빠름 🌀",
    assets: {
      preview: assetPath("햄스터 메인 이미지.png"),
      jump_neutral: assetPath("햄스터 점프 위로.png"),
      jump_left: assetPath("햄스터 왼쪽.png"),
      jump_right: assetPath("햄스터 오른쪽.png"),
      fall_neutral: assetPath("햄스터 추락.png"),
    },
  },
  {
    id: "peach-chick",
    name: "말랑 병아리",
    abilityText: "사뿐... 가볍게 천천히 ☁",
    assets: {
      preview: assetPath("병아리 메인 이미지.png"),
      jump_neutral: assetPath("병아리 점프.png"),
      jump_left: assetPath("병아리 왼쪽 점프.png"),
      jump_right: assetPath("병아리 오른쪽 점프.png"),
      fall_neutral: assetPath("병아리 추락.png"),
    },
  },
  // ── 신규 캐릭터: 명시 선택 UI에 노출되지 않고 🎲 랜덤으로만 등장 ──
  {
    id: "latte-puppy",
    name: "라떼 강아지",
    abilityText: "셋 세고~ 두근! 슈퍼점프 ✨",
    secret: true,
    assets: {
      // 미리보기/결과화면용 메인 컷 (전신 풀 일러스트)
      preview: assetPath("라떼 메인 이미지.png"),
      jump_neutral: assetPath("라떼 점프 위로.png"),
      jump_left: assetPath("라떼 왼쪽 점프.png"),
      jump_right: assetPath("라떼 오른쪽 점프.png"),
      fall_neutral: assetPath("라떼 추락.png"),
    },
  },
  {
    id: "mint-kitten",
    name: "민트 고양이",
    abilityText: "별 한 입에 하늘까지 🌟",
    secret: true,
    assets: {
      preview: assetPath("고양이 메인이미지.png"),
      jump_neutral: assetPath("고양이 점프 위로.png"),
      jump_left: assetPath("고양이 왼쪽 점프.png"),
      jump_right: assetPath("고양이 오른쪽 점프.png"),
      fall_neutral: assetPath("고양이 추락.png"),
    },
  },
];

const CHARACTER_MAP = Object.fromEntries(CHARACTER_LIST.map((character) => [character.id, character]));
const PUBLIC_CHARACTER_LIST = CHARACTER_LIST.filter((c) => !c.secret);
const RANDOM_CHARACTER_OPTION = {
  id: "random",
  name: "랜덤",
  abilityText: "두근... 누가 나올까? 🎲",
  // 별도 메인 이미지를 두면 자동 사용 (없어도 emoji placeholder로 폴백)
  mainImage: assetPath("랜덤 메인 이미지.png"),
};

// 서버 worker/src/room.js의 JUMP_CHARACTER_ABILITIES와 같은 값. 클라 솔로 모드 + UI 표시용.
const CHARACTER_ABILITIES = {
  "mochi-rabbit":    { jumpMul: 1.06, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 0 },
  "pudding-hamster": { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.18, boostMul: 1.00, superJumpEvery: 0 },
  "peach-chick":     { jumpMul: 1.00, gravityMul: 0.85, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 0 },
  "latte-puppy":     { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 3 },
  "mint-kitten":     { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.50, superJumpEvery: 0 },
};

const DEFAULT_ABILITIES = CHARACTER_ABILITIES["mochi-rabbit"];

function getAbilities(characterId) {
  return CHARACTER_ABILITIES[characterId] || DEFAULT_ABILITIES;
}

function pickRandomCharacterId() {
  const pool = CHARACTER_LIST;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

// 랜덤 메인 이미지가 assets에 있는지 사전 검출 — 없으면 🎲 이모지로 폴백
let randomMainImageAvailable = false;
(function probeRandomImage() {
  const probe = new Image();
  probe.onload = () => {
    randomMainImageAvailable = true;
    if (typeof renderSetupUI === "function" && setupScreen.classList.contains("is-active")) {
      renderSetupUI();
    }
  };
  probe.onerror = () => { randomMainImageAvailable = false; };
  probe.src = RANDOM_CHARACTER_OPTION.mainImage;
})();

const PLATFORM_KINDS = ["leaf", "cloud", "cake"];
const BOOST_META = {
  rocket: { label: "UP", message: "로켓 부스트" },
  star: { label: "GO", message: "별 부스트" },
};

const PLATFORM_DECO_BY_MOTION = {
  drift: "orb",
  rotate: "spinner",
};

const settings = {
  worldWidth: 500,
  gravity: 0.42,
  moveSpeed: 4.8,
  normalJump: -11.8,
  boostJump: -16.8,
  springJump: -15.6,
  platformGap: 96,
  platformWidthMin: 84,
  platformWidthMax: 150,
  startLineY: 540,
  playerSpawnOffset: 52,
  safePlatformInset: 14,
  difficultyHeightRange: 2600,
  pathShiftMin: 180,
  pathShiftMax: 245,
  pathRequiredShiftMin: 40,
  pathRequiredShiftMax: 85,
  platformWidthMinLate: 74,
  platformWidthMaxLate: 122,
  monsterSize: 280,
  monsterSpeed: 1.05,
  monsterSpawnIntervalMinMs: 5000,
  monsterSpawnIntervalMaxMs: 9500,
  monsterFirstSpawnDelayMs: 3000,
  monsterTurnIntervalMinMs: 1400,
  monsterTurnIntervalMaxMs: 2800,
  monsterLifetimeMs: 9000,
};

// ── 높이 존 & 마일스톤 ──────────────────────────────────────
// climbed(m) 기준. 존 인덱스는 한 번 올라가면 유지(모노토닉) — 낙하할 때마다
// 배경이 되돌아오며 깜빡이는 것을 막는다. 마일스톤은 존 경계(150/350)와
// 겹치지 않게 골라 배너가 이중으로 뜨지 않도록 한다.
const ZONES = [
  { id: "sky", from: 0, banner: null },
  { id: "sunset", from: 150, banner: "🌇 노을 하늘 도착!" },
  { id: "space", from: 350, banner: "🌌 별빛 우주 도착!" },
];
const SPACE_ZONE_FROM = ZONES[2].from;
const MILESTONES = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000];
const PERSONAL_BEST_KEY = "mallang-jump.personalBest";

const PLAYER_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];
const NETWORK_TICK_MS = 33;
const NETWORK_PING_INTERVAL_MS = 2000;
const NETWORK_SNAPSHOT_LIMIT = 32;
const NETWORK_RTT_SAMPLE_LIMIT = 8;
const NETWORK_DEFAULT_ONE_WAY_MS = NETWORK_TICK_MS * 0.5;
const NETWORK_MIN_INTERPOLATION_MS = NETWORK_TICK_MS * 3;
const NETWORK_MAX_INTERPOLATION_MS = 200;
const NETWORK_BASE_INTERPOLATION_MS = NETWORK_TICK_MS * 3;
const NETWORK_REMOTE_FOLLOW_BASE = 0.28;
const NETWORK_REMOTE_SNAP_DISTANCE = 260;

const state = {
  running: false,
  rafId: 0,
  keys: new Set(),
  touchAssignments: new Map(),
  playerTouchDirections: [0, 0],
  playerCount: 1,
  cameraY: 0,
  arenaMetrics: {
    clientWidth: 0,
    clientHeight: 0,
    scale: 1,
    worldHeight: 0,
  },
  isSpectator: false,
  chatInputOpen: false,
  chatFocused: false,
  setup: [createDefaultSetup("mochi-rabbit"), createDefaultSetup("pudding-hamster")],
  players: [],
  platforms: [],
  boosts: [],
  monsters: [],
  nextMonsterSpawnAt: 0,
  effects: [],
  resultSubmitted: false,
  progress: {
    zoneIndex: 0,
    milestoneIdx: 0,
    recordShown: false,
  },
  audio: {
    ctx: null,
    unlocked: false,
  },
  network: {
    ws: null,
    joined: false,
    protocol: null,
    initialized: false,
    lastSeq: -1,
    elapsedMs: 0,
    elapsedSyncedAtMs: 0,
    snapshot: null,
    snapshots: [],
    rttSamples: [],
    rttMs: 0,
    jitterMs: 0,
    interpolationDelayMs: NETWORK_BASE_INTERPOLATION_MS + NETWORK_DEFAULT_ONE_WAY_MS,
    nextPingId: 1,
    pendingPings: new Map(),
    lastSentDirection: null,
    localPhysicsRemainderMs: 0,
    pickedBoostIds: new Set(),
    mySlot: null, // server 가 jump_joined 로 통보. friend-picked boost 판정용.
    inputIntervalId: 0,
    pingIntervalId: 0,
    renderFrameId: 0,
    lastFrameTime: 0,
    platformEls: new Map(),
    boostEls: new Map(),
    monsterEls: new Map(),
    playerEls: new Map(),
  },
};

const configRefs = playerConfigCards.map((card, slot) => ({
  slot,
  card,
  name: card.querySelector(`[data-player-name="${slot}"]`),
  ability: card.querySelector(`[data-player-ability="${slot}"]`),
  preview: card.querySelector(`[data-preview-slot="${slot}"]`),
  options: card.querySelector(`[data-character-options="${slot}"]`),
}));

function createDefaultSetup(characterId) {
  return {
    selectedId: characterId,
    characterId: characterId === "random" ? pickRandomCharacterId() : characterId,
  };
}

function applySetupChoice(setup, selectedId) {
  setup.selectedId = selectedId;
  setup.characterId = selectedId === "random" ? pickRandomCharacterId() : selectedId;
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureAudioUnlocked() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  if (!state.audio.ctx) {
    state.audio.ctx = new AudioCtx();
  }

  if (state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume().catch(() => {});
  }

  state.audio.unlocked = true;
  return state.audio.ctx;
}

function playTone({ type = "sine", frequency = 440, endFrequency = frequency, duration = 0.12, volume = 0.04 }) {
  if (AUDIO_MUTED) return;
  const ctx = ensureAudioUnlocked();
  if (!ctx) return;

  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), now + duration);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playJumpSound() {
  playTone({ type: "triangle", frequency: 420, endFrequency: 660, duration: 0.1, volume: 0.035 });
}

function playLandSound() {
  playTone({ type: "sine", frequency: 220, endFrequency: 140, duration: 0.09, volume: 0.03 });
}

function playBoostSound() {
  playTone({ type: "square", frequency: 540, endFrequency: 1080, duration: 0.16, volume: 0.04 });
  window.setTimeout(() => {
    playTone({ type: "triangle", frequency: 760, endFrequency: 520, duration: 0.14, volume: 0.028 });
  }, 36);
}

function playSpringSound() {
  // 달 트램펄린 "보잉~" — 낮은음에서 빠르게 치솟는 글리스
  playTone({ type: "sine", frequency: 240, endFrequency: 880, duration: 0.22, volume: 0.045 });
}

function playPoofSound() {
  // 깜빡 구름 "퐁" — 부드럽게 가라앉는 톤
  playTone({ type: "triangle", frequency: 500, endFrequency: 180, duration: 0.18, volume: 0.035 });
}

function playZoneSound() {
  playTone({ type: "triangle", frequency: 523, endFrequency: 784, duration: 0.18, volume: 0.04 });
  window.setTimeout(() => {
    playTone({ type: "triangle", frequency: 784, endFrequency: 1046, duration: 0.22, volume: 0.038 });
  }, 130);
}

function playMilestoneSound() {
  playTone({ type: "sine", frequency: 880, endFrequency: 1174, duration: 0.14, volume: 0.035 });
}

function playRecordSound() {
  [523, 659, 784, 1046].forEach((frequency, index) => {
    window.setTimeout(() => {
      playTone({ type: "triangle", frequency, duration: 0.15, volume: 0.04 });
    }, index * 110);
  });
}

// ── 높이 존 · 마일스톤 · 개인 최고 기록 ─────────────────────
const zoneSunsetEl = document.getElementById("zoneSunset");
const zoneSpaceEl = document.getElementById("zoneSpace");
const skyBannerEl = document.getElementById("skyBanner");
const setupBestEl = document.getElementById("setupBest");
const resultRecordEl = document.getElementById("resultRecord");

function loadPersonalBest() {
  try {
    const value = Number(window.localStorage.getItem(PERSONAL_BEST_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch (error) {
    return 0;
  }
}

let personalBest = loadPersonalBest();

function savePersonalBest(value) {
  personalBest = value;
  try {
    window.localStorage.setItem(PERSONAL_BEST_KEY, String(value));
  } catch (error) {
    /* 사생활 보호 모드 등에서 저장 불가 — 세션 내 기록만 유지 */
  }
  refreshSetupBest();
}

function refreshSetupBest() {
  if (!setupBestEl) return;
  setupBestEl.classList.toggle("is-hidden", personalBest <= 0);
  if (personalBest > 0) {
    setupBestEl.textContent = `🏆 내 최고 기록 ${personalBest}m — 오늘은 넘어볼까요?`;
  }
}

// 배너 큐 — 존 진입과 마일스톤이 같은 순간 겹치면 순서대로 보여준다.
const bannerQueue = [];
let bannerTimerId = 0;

function showSkyBanner(text) {
  if (!skyBannerEl || !text) return;
  bannerQueue.push(text);
  if (!bannerTimerId) presentNextBanner();
}

function presentNextBanner() {
  const text = bannerQueue.shift();
  if (!text) {
    bannerTimerId = 0;
    skyBannerEl.classList.add("is-hidden");
    return;
  }
  skyBannerEl.textContent = text;
  skyBannerEl.classList.remove("is-hidden");
  // 연속 표시 시 pop 애니메이션 재시작
  skyBannerEl.style.animation = "none";
  void skyBannerEl.offsetWidth;
  skyBannerEl.style.animation = "";
  bannerTimerId = window.setTimeout(presentNextBanner, 1700);
}

function resetSkyBanner() {
  bannerQueue.length = 0;
  if (bannerTimerId) {
    window.clearTimeout(bannerTimerId);
    bannerTimerId = 0;
  }
  if (skyBannerEl) skyBannerEl.classList.add("is-hidden");
}

function zoneIndexForHeight(heightM) {
  for (let i = ZONES.length - 1; i >= 0; i -= 1) {
    if (heightM >= ZONES[i].from) return i;
  }
  return 0;
}

function applyZoneVisual(zoneIndex) {
  if (zoneSunsetEl) zoneSunsetEl.classList.toggle("is-visible", zoneIndex >= 1);
  if (zoneSpaceEl) zoneSpaceEl.classList.toggle("is-visible", zoneIndex >= 2);
}

function resetRunProgress() {
  state.progress.zoneIndex = 0;
  state.progress.milestoneIdx = 0;
  state.progress.recordShown = false;
  applyZoneVisual(0);
  resetSkyBanner();
}

function updateRunProgress(heightM) {
  if (!Number.isFinite(heightM) || heightM <= 0) return;

  const zoneIndex = zoneIndexForHeight(heightM);
  if (zoneIndex > state.progress.zoneIndex) {
    state.progress.zoneIndex = zoneIndex;
    applyZoneVisual(zoneIndex);
    showSkyBanner(ZONES[zoneIndex].banner);
    playZoneSound();
  }

  while (
    state.progress.milestoneIdx < MILESTONES.length &&
    heightM >= MILESTONES[state.progress.milestoneIdx]
  ) {
    const milestone = MILESTONES[state.progress.milestoneIdx];
    state.progress.milestoneIdx += 1;
    showSkyBanner(`⛳ ${milestone}m 돌파!`);
    playMilestoneSound();
  }

  if (!state.progress.recordShown && personalBest > 0 && heightM > personalBest) {
    state.progress.recordShown = true;
    showSkyBanner(`🎉 신기록 달성! (이전 ${personalBest}m)`);
    playRecordSound();
  }
}

// 결과 화면에 신기록/최고 기록 표시 + 저장. myScore = 이번 판 내 기록(m).
function applyRecordToResults(myScore) {
  if (!resultRecordEl) return;

  const score = Number.isFinite(myScore) ? Math.max(0, Math.round(myScore)) : 0;
  if (score <= 0) {
    resultRecordEl.classList.add("is-hidden");
    return;
  }

  const previous = personalBest;
  const isNew = score > previous;
  if (isNew) savePersonalBest(score);

  resultRecordEl.classList.remove("is-hidden");
  resultRecordEl.classList.toggle("is-new", isNew);
  resultRecordEl.textContent = isNew
    ? previous > 0
      ? `🎉 신기록! ${previous}m → ${score}m`
      : `🎉 첫 기록 ${score}m 달성!`
    : `🏆 내 최고 기록 ${personalBest}m (이번 판 ${score}m)`;
}

function slotLabel(slot) {
  return `${slot + 1}P`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function getAvatarLabel(name, fallback = "") {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || fallback;
}

function getCharacter(characterId) {
  return CHARACTER_MAP[characterId] || CHARACTER_LIST[0];
}

function getSpriteSrc(character, pose) {
  return character.assets[pose] || character.assets.jump_neutral;
}

// 인게임 아바타가 사용하는 4종 포즈 — 한 번에 모두 렌더링하고 is-active 클래스만 토글해
// src 교체 깜빡임을 제거한다 (모든 PNG는 미리 디코드된 채로 메모리에 상주).
const GAME_POSES = ["jump_neutral", "jump_left", "jump_right", "fall_neutral"];

function createAvatarMarkup(setup, label, compact = false, pose = "preview") {
  if (setup.characterId === "random") {
    const classes = ["avatar"];
    if (compact) classes.push("avatar--compact");
    if (!randomMainImageAvailable) classes.push("avatar--random");
    const inner = randomMainImageAvailable
      ? `<img class="avatar__sprite is-active" src="${RANDOM_CHARACTER_OPTION.mainImage}" alt="랜덤" draggable="false" decoding="async" />`
      : `<div class="avatar__random-mark" aria-hidden="true">🎲</div>`;
    return `
      <div class="${classes.join(" ")} is-rising">
        ${label ? `<span class="avatar__label">${escapeHtml(label)}</span>` : ""}
        <div class="avatar__character">${inner}</div>
      </div>
    `;
  }

  const character = getCharacter(setup.characterId);
  const classes = ["avatar", `avatar--${character.id}`];
  if (compact) classes.push("avatar--compact");

  // preview 모드(설정/인트로): 메인 이미지 한 장만
  // 인게임: 4종 포즈를 모두 렌더링하고 is-active 클래스로 표시 전환
  let inner;
  if (pose === "preview") {
    inner = `<img class="avatar__sprite is-active" src="${character.assets.preview}" alt="${character.name}" draggable="false" decoding="async" />`;
  } else {
    inner = GAME_POSES
      .map((p) =>
        `<img class="avatar__sprite ${p === pose ? "is-active" : ""}" data-pose="${p}" src="${character.assets[p]}" alt="" draggable="false" decoding="async" />`
      )
      .join("");
  }

  return `
    <div class="${classes.join(" ")} is-rising">
      ${label ? `<span class="avatar__label">${escapeHtml(label)}</span>` : ""}
      <div class="avatar__character">${inner}</div>
    </div>
  `;
}

// 4종 포즈 중 하나를 활성화 (다른 모든 .avatar__sprite는 비활성).
function setActiveAvatarPose(avatarEl, pose) {
  if (!avatarEl) return;
  const sprites = avatarEl.querySelectorAll(".avatar__sprite[data-pose]");
  sprites.forEach((el) => {
    el.classList.toggle("is-active", el.dataset.pose === pose);
  });
}

function createCharacterOptionMarkup(character, slot, active) {
  return `
    <button
      type="button"
      class="character-option ${active ? "is-active" : ""}"
      data-slot="${slot}"
      data-character-id="${character.id}"
    >
      ${createAvatarMarkup({ characterId: character.id }, "", true, "preview")}
      <span class="character-option__name">${character.name}</span>
    </button>
  `;
}

function addChatMessage(entry) {
  const color = PLAYER_COLORS[(entry.colorIndex || 0) % PLAYER_COLORS.length];
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const el = document.createElement("div");
  el.className = "chat-message";
  el.innerHTML = `
    <span class="chat-message__name" style="color:${color}">${escapeHtml(entry.name)}</span>
    <span class="chat-message__text">${escapeHtml(entry.text)}</span>
    <span class="chat-message__time">${timeStr}</span>
  `;
  chatMessagesEl.appendChild(el);

  while (chatMessagesEl.children.length > 8) {
    chatMessagesEl.removeChild(chatMessagesEl.firstChild);
  }

  setTimeout(() => {
    el.classList.add("is-fading");
    setTimeout(() => el.remove(), 650);
  }, 10000);
}

function sendChat() {
  const text = (chatInputEl.value || "").trim();
  if (!text) return;
  if (!state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) return;
  state.network.ws.send(JSON.stringify({ type: "chat", text }));
  chatInputEl.value = "";
}

function toggleChatInput(open) {
  state.chatInputOpen = open !== undefined ? open : !state.chatInputOpen;
  chatInputWrap.classList.toggle("is-open", state.chatInputOpen);
  chatToggleBtn.textContent = state.chatInputOpen ? "✕" : "💬";
  if (state.chatInputOpen) chatInputEl.focus();
}

function isTypingTarget(target) {
  return Boolean(
    target &&
    typeof target === "object" &&
    ("tagName" in target || "isContentEditable" in target) &&
    (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    )
  );
}

function showChatOverlay() {
  chatOverlayEl.classList.remove("is-hidden");
}

function setStatus(message) {
  statusEl.textContent = message;
}

function showScreen(screen) {
  const isSetup = screen === "setup";
  setupScreen.classList.toggle("is-active", isSetup);
  playScreen.classList.toggle("is-active", !isSetup);
  window.scrollTo(0, 0);
}

function buildRoomWebSocketUrl(code) {
  const base = (window.WORKER_URL || window.location.origin).replace(/^http/, "ws");
  return `${base}/api/rooms/${encodeURIComponent(code)}`;
}

function getPoseFromStateLike(player) {
  if (player.vy > 0.8) return "fall_neutral";
  if (player.vx < -0.35) return "jump_left";
  if (player.vx > 0.35) return "jump_right";
  return "jump_neutral";
}

function createPlatformMotion() {
  const roll = Math.random();
  if (roll < 0.18) {
    return {
      type: "drift",
      amplitude: random(18, 34),
      speed: random(0.45, 0.78),
      phase: random(0, Math.PI * 2),
      rotateAmplitude: random(2, 4),
    };
  }

  if (roll < 0.33) {
    return {
      type: "rotate",
      amplitude: 0,
      speed: random(0.5, 0.9),
      phase: random(0, Math.PI * 2),
      rotateAmplitude: random(5, 9),
    };
  }

  return {
    type: "static",
    amplitude: 0,
    speed: 0,
    phase: 0,
    rotateAmplitude: 0,
  };
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function getDifficultyProgress(y) {
  const climbed = Math.max(0, settings.startLineY - y);
  return clamp(climbed / settings.difficultyHeightRange, 0, 1);
}

function getPlatformProfile(y) {
  const progress = getDifficultyProgress(y);
  return {
    progress,
    widthMin: lerp(settings.platformWidthMin, settings.platformWidthMinLate, progress),
    widthMax: lerp(settings.platformWidthMax, settings.platformWidthMaxLate, progress),
    pathShift: lerp(settings.pathShiftMin, settings.pathShiftMax, progress),
    pathRequiredShift: lerp(settings.pathRequiredShiftMin, settings.pathRequiredShiftMax, progress),
  };
}

function getTopmostPlatform() {
  if (state.platforms.length === 0) return null;
  return state.platforms.reduce((top, platform) => (platform.y < top.y ? platform : top), state.platforms[0]);
}

function getArenaScale() {
  if (!arena?.clientWidth) return 1;
  return Math.min(1, arena.clientWidth / settings.worldWidth);
}

function applyArenaScale(force = false) {
  if (!arena || !worldEl) return state.arenaMetrics;
  const clientWidth = arena.clientWidth || 0;
  const clientHeight = arena.clientHeight || 0;
  const scale = clientWidth ? Math.min(1, clientWidth / settings.worldWidth) : 1;
  const worldHeight = Math.ceil(clientHeight / Math.max(scale, 0.0001));
  const metrics = state.arenaMetrics;

  if (
    !force &&
    metrics.clientWidth === clientWidth &&
    metrics.clientHeight === clientHeight &&
    metrics.scale === scale &&
    metrics.worldHeight === worldHeight
  ) {
    return metrics;
  }

  metrics.clientWidth = clientWidth;
  metrics.clientHeight = clientHeight;
  metrics.scale = scale;
  metrics.worldHeight = worldHeight;

  worldEl.style.width = `${settings.worldWidth}px`;
  worldEl.style.height = `${worldHeight}px`;
  worldEl.style.transform = `translateZ(0) scale(${scale})`;
  worldEl.style.transformOrigin = "top left";
  return metrics;
}

function formatWorldTranslate(x, y, extraTransform = "") {
  const tx = Number.isFinite(x) ? x.toFixed(2) : "0.00";
  const ty = Number.isFinite(y) ? y.toFixed(2) : "0.00";
  return `translate3d(${tx}px, ${ty}px, 0)${extraTransform}`;
}

function clearNetworkWorld() {
  state.network.platformEls.forEach((entry) => entry.el?.remove());
  state.network.boostEls.forEach((entry) => entry.el?.remove());
  state.network.monsterEls.forEach((entry) => entry.el?.remove());
  state.network.playerEls.forEach(({ el }) => el.remove());
  state.network.platformEls.clear();
  state.network.boostEls.clear();
  state.network.monsterEls.clear();
  state.network.playerEls.clear();
  state.network.joined = false;
  state.network.protocol = null;
  state.network.initialized = false;
  state.network.lastSeq = -1;
  state.network.elapsedMs = 0;
  state.network.elapsedSyncedAtMs = 0;
  state.network.snapshot = null;
  state.network.snapshots = [];
  state.network.rttSamples = [];
  state.network.rttMs = 0;
  state.network.jitterMs = 0;
  state.network.interpolationDelayMs = NETWORK_BASE_INTERPOLATION_MS + NETWORK_DEFAULT_ONE_WAY_MS;
  state.network.nextPingId = 1;
  state.network.pendingPings.clear();
  state.network.lastFrameTime = 0;
  state.network.lastSentDirection = null;
  state.network.localPhysicsRemainderMs = 0;
  state.network.pickedBoostIds.clear();
  state.network.mySlot = null; // 재연결 안전성 (Codex 리뷰)
  state.cameraY = 0;
  state.isSpectator = false;
  state.effects = [];
  if (spectatorBadgeEl) spectatorBadgeEl.classList.add("is-hidden");
  if (rivalGaugeEl) rivalGaugeEl.classList.add("is-hidden");
  // 채팅 오버레이는 startGame 단계에서 노출하므로 여기선 숨기지 않는다.
}

function stopNetworkInputLoop() {
  if (state.network.inputIntervalId) {
    clearInterval(state.network.inputIntervalId);
    state.network.inputIntervalId = 0;
  }
}

function stopNetworkPingLoop() {
  if (state.network.pingIntervalId) {
    clearInterval(state.network.pingIntervalId);
    state.network.pingIntervalId = 0;
  }
  state.network.pendingPings.clear();
}

function stopNetworkRenderLoop() {
  if (state.network.renderFrameId) {
    cancelAnimationFrame(state.network.renderFrameId);
    state.network.renderFrameId = 0;
  }
}

function stopSoloGame() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
}

function exitSession() {
  stopNetworkInputLoop();
  stopNetworkPingLoop();
  stopNetworkRenderLoop();
  if (state.network.ws) {
    try {
      state.network.ws.close();
    } catch {
      // ignore close errors
    }
    state.network.ws = null;
  }

  if (gameBoot) {
    gameBoot.exit();
    return;
  }

  window.location.href = "/";
}

function hideResultsOverlay() {
  resultsOverlay.classList.remove("is-active");
}

function submitRoundResult() {
  if (!gameBoot || !gameBoot.isMultiplayer || state.resultSubmitted || isRoomSession) return;

  const submittedScore = Math.max(...state.players.map((player) => player.bestHeight), 0);
  gameBoot.submitResult({ score: submittedScore });
  state.resultSubmitted = true;
}

function showResultsOverlay() {
  const rankedPlayers = [...state.players].sort((a, b) => b.bestHeight - a.bestHeight);
  const leadMessage =
    rankedPlayers.length > 1
      ? rankedPlayers[0].bestHeight === rankedPlayers[1].bestHeight
        ? "동점이에요. 한 판 더 해서 승부를 가려보세요."
        : `${slotLabel(rankedPlayers[0].slot)} 승리! ${rankedPlayers[0].bestHeight}m까지 올랐어요.`
      : `${slotLabel(rankedPlayers[0].slot)} 최고 기록 ${rankedPlayers[0].bestHeight}m`;

  resultLeadEl.textContent = isRoomSession
    ? `${leadMessage} 결과를 제출했고, 대기실로 돌아가면 스코어보드를 볼 수 있어요.`
    : leadMessage;

  for (let slot = 0; slot < 2; slot += 1) {
    const active = slot < state.playerCount;
    const player = state.players.find((entry) => entry.slot === slot);
    const characterName = getCharacter(state.setup[slot].characterId).name;

    resultRows[slot].classList.toggle("is-hidden", !active);
    if (!active) continue;

    resultNameEls[slot].textContent = `${slotLabel(slot)} · ${characterName}`;
    resultScoreEls[slot].textContent = `${player ? player.bestHeight : 0}m`;
  }

  const me = state.players.find((entry) => entry.slot === 0);
  applyRecordToResults(me ? me.bestHeight : Math.max(0, ...state.players.map((p) => p.bestHeight)));

  applyResultButtonLabels();
  resultsOverlay.classList.add("is-active");
}

function showNetworkResultsOverlay(results) {
  const bySlot = new Map(results.map((entry) => [entry.slot, entry]));
  const leader = results[0] || null;

  resultLeadEl.textContent = leader
    ? `${leader.name} 승리! ${leader.score}m 기록으로 대기실 스코어보드에도 반영됩니다.`
    : "라운드가 끝났습니다. 대기실로 돌아가 결과를 확인해 주세요.";

  for (let slot = 0; slot < 2; slot += 1) {
    const entry = bySlot.get(slot);
    resultRows[slot].classList.toggle("is-hidden", !entry);
    if (!entry) continue;
    resultNameEls[slot].textContent = `${slotLabel(slot)} · ${entry.name}`;
    resultScoreEls[slot].textContent = `${entry.score}m`;
  }

  const myEntry = results.find((entry) => entry.slot === state.network.mySlot);
  applyRecordToResults(myEntry ? myEntry.score : 0);

  applyResultButtonLabels();
  resultsOverlay.classList.add("is-active");
  // Codex 리뷰: 결과 오버레이 활성 시 라이벌 게이지 숨김 — z-index 명시
  // 안 된 오버레이 위로 게이지가 떠 있을 수 있음.
  if (rivalGaugeEl) rivalGaugeEl.classList.add("is-hidden");
}

// 결과 화면 버튼 레이블/표시 결정.
//   - 월드에서 들어왔으면 '한 판 더' 라는 선택지는 의미가 없으니 단일
//     '월드로 돌아가기' 만 노출한다.
//   - 그 외(솔로 또는 직접 진입)는 다시 시작 / 메인으로 나가기.
//   레거시 lobby(`?code=` 만 있고 `from=world` 가 없는 케이스)는 진입점이
//   사라졌으므로 별도 분기하지 않는다.
function applyResultButtonLabels() {
  const fromWorld = !!(gameBoot && gameBoot.from === 'world');
  if (fromWorld) {
    restartFromResultsButton.hidden = true;
    exitAfterResultsButton.textContent = '월드로 돌아가기';
    return;
  }
  restartFromResultsButton.hidden = false;
  restartFromResultsButton.textContent = '한 판 더 하기';
  exitAfterResultsButton.textContent = '메인으로 나가기';
}

let lastHudSignature = "";
function renderHudList(rows) {
  if (!hudListEl) return;
  // 매 프레임 호출되므로 시그니처 비교로 변경 없을 시 innerHTML 재구성을 건너뛴다.
  // (점수는 m 단위 정수, alive/이름은 자주 안 바뀜 → 실제 갱신은 드물다)
  let signature = "";
  for (const row of rows) {
    signature += `${row.name}${row.score}${row.alive ? 1 : 0}${row.isMe ? 1 : 0}`;
  }
  if (signature === lastHudSignature) return;
  lastHudSignature = signature;
  hudListEl.innerHTML = rows
    .map((row) => {
      const classes = ["hud-row"];
      if (!row.alive) classes.push("is-eliminated");
      const nameClass = row.isMe ? "hud-row__name hud-row__name--me" : "hud-row__name";
      const status = row.alive ? "생존" : (row.score > 0 ? "탈락" : "대기");
      return `
        <div class="${classes.join(" ")}">
          <span class="${nameClass}">${escapeHtml(row.name)}</span>
          <strong class="hud-row__best">${row.score}m</strong>
          <span class="hud-row__status">${status}</span>
        </div>
      `;
    })
    .join("");
}

function updateHudFromSnapshot(players) {
  if (!Array.isArray(players)) return;
  const myId = gameBoot?.playerId || null;
  const sorted = [...players].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  const rows = sorted.map((p) => ({
    name: p.name || `${(p.slot ?? 0) + 1}P`,
    score: Number.isFinite(p.bestHeight) ? p.bestHeight : 0,
    alive: Boolean(p.alive),
    isMe: myId ? p.id === myId : false,
  }));
  renderHudList(rows);
}

function syncEntityMap(map, items, createFn, updateFn) {
  const nextIds = new Set(items.map((item) => item.id));
  items.forEach((item) => {
    if (!map.has(item.id)) {
      map.set(item.id, createFn(item));
    }
    updateFn(map.get(item.id), item);
  });

  for (const [id, entry] of map.entries()) {
    if (nextIds.has(id)) continue;
    (entry.el || entry).remove();
    map.delete(id);
  }
}

function samplePlatformMotion(platform, timeSeconds) {
  const baseX = Number.isFinite(platform.baseX) ? platform.baseX : (Number.isFinite(platform.x) ? platform.x : 0);
  if (!platform.motion || platform.motion.type === "static") {
    return {
      x: baseX,
      rotation: 0,
    };
  }

  const wave = Math.sin(timeSeconds * platform.motion.speed + platform.motion.phase);
  return {
    x: baseX + (platform.motion.type === "drift" ? wave * platform.motion.amplitude : 0),
    rotation: wave * platform.motion.rotateAmplitude,
  };
}

function getNetworkOneWayDelayMs() {
  return state.network.rttMs > 0 ? state.network.rttMs * 0.5 : NETWORK_DEFAULT_ONE_WAY_MS;
}

function recalculateNetworkInterpolationDelay() {
  const adaptiveDelay =
    NETWORK_BASE_INTERPOLATION_MS +
    getNetworkOneWayDelayMs() +
    state.network.jitterMs * 2;
  state.network.interpolationDelayMs = clamp(
    adaptiveDelay,
    NETWORK_MIN_INTERPOLATION_MS,
    NETWORK_MAX_INTERPOLATION_MS
  );
}

function recordNetworkRttSample(rttMs) {
  if (!Number.isFinite(rttMs) || rttMs <= 0) return;
  state.network.rttSamples.push(rttMs);
  if (state.network.rttSamples.length > NETWORK_RTT_SAMPLE_LIMIT) {
    state.network.rttSamples.shift();
  }

  const sampleTotal = state.network.rttSamples.reduce((sum, sample) => sum + sample, 0);
  const averageRtt = sampleTotal / state.network.rttSamples.length;
  const averageDeviation =
    state.network.rttSamples.reduce((sum, sample) => sum + Math.abs(sample - averageRtt), 0) /
    state.network.rttSamples.length;

  state.network.rttMs = averageRtt;
  state.network.jitterMs = averageDeviation;
  recalculateNetworkInterpolationDelay();
}

function syncNetworkClock(snapshot, now = performance.now()) {
  if (!Number.isFinite(snapshot.elapsedMs)) return;
  const estimated = snapshot.elapsedMs + getNetworkOneWayDelayMs();
  if (!state.network.elapsedSyncedAtMs) {
    state.network.elapsedMs = estimated;
  } else {
    const current = getEstimatedNetworkElapsedMs(now);
    const delta = estimated - current;
    // 200ms 초과 불연속은 스냅, 소폭 지터는 EMA(30%) 블렌드
    state.network.elapsedMs = current + (Math.abs(delta) > 200 ? delta : delta * 0.3);
  }
  state.network.elapsedSyncedAtMs = now;
}

function getEstimatedNetworkElapsedMs(now = performance.now()) {
  if (!state.network.elapsedSyncedAtMs) {
    return state.network.elapsedMs;
  }

  return state.network.elapsedMs + Math.max(0, now - state.network.elapsedSyncedAtMs);
}

function getBufferedNetworkElapsedMs(now = performance.now()) {
  return Math.max(0, getEstimatedNetworkElapsedMs(now) - state.network.interpolationDelayMs);
}

function pushNetworkSnapshot(snapshot) {
  if (!Number.isFinite(snapshot.elapsedMs)) return;
  const normalizedSnapshot = {
    elapsedMs: snapshot.elapsedMs,
    cameraY: Number.isFinite(snapshot.cameraY) ? snapshot.cameraY : 0,
    players: (snapshot.players || []).map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      vx: player.vx || 0,
      vy: player.vy || 0,
      alive: player.alive,
      width: player.width,
      height: player.height,
    })),
  };

  const snapshots = state.network.snapshots;
  const lastSnapshot = snapshots[snapshots.length - 1];
  if (lastSnapshot && lastSnapshot.elapsedMs === normalizedSnapshot.elapsedMs) {
    snapshots[snapshots.length - 1] = normalizedSnapshot;
  } else {
    snapshots.push(normalizedSnapshot);
  }

  while (snapshots.length > NETWORK_SNAPSHOT_LIMIT) {
    snapshots.shift();
  }
}

function sampleBufferedNetworkState(now = performance.now()) {
  const snapshots = state.network.snapshots;
  if (snapshots.length === 0) return null;

  const targetElapsedMs = getBufferedNetworkElapsedMs(now);
  const firstSnapshot = snapshots[0];
  const latestSnapshot = snapshots[snapshots.length - 1];

  if (snapshots.length === 1 || targetElapsedMs <= firstSnapshot.elapsedMs) {
    return {
      elapsedMs: firstSnapshot.elapsedMs,
      cameraY: firstSnapshot.cameraY,
      playersById: new Map(firstSnapshot.players.map((player) => [player.id, player])),
    };
  }

  if (targetElapsedMs >= latestSnapshot.elapsedMs) {
    return {
      elapsedMs: latestSnapshot.elapsedMs,
      cameraY: latestSnapshot.cameraY,
      playersById: new Map(latestSnapshot.players.map((player) => [player.id, player])),
    };
  }

  let previousSnapshot = firstSnapshot;
  let nextSnapshot = latestSnapshot;
  for (let index = 1; index < snapshots.length; index += 1) {
    if (targetElapsedMs <= snapshots[index].elapsedMs) {
      previousSnapshot = snapshots[index - 1];
      nextSnapshot = snapshots[index];
      break;
    }
  }

  const spanMs = Math.max(1, nextSnapshot.elapsedMs - previousSnapshot.elapsedMs);
  const t = clamp((targetElapsedMs - previousSnapshot.elapsedMs) / spanMs, 0, 1);
  const previousPlayers = new Map(previousSnapshot.players.map((player) => [player.id, player]));
  const nextPlayers = new Map(nextSnapshot.players.map((player) => [player.id, player]));
  const playerIds = new Set([...previousPlayers.keys(), ...nextPlayers.keys()]);
  const playersById = new Map();

  playerIds.forEach((playerId) => {
    const previousPlayer = previousPlayers.get(playerId);
    const nextPlayer = nextPlayers.get(playerId);
    if (!previousPlayer && nextPlayer) {
      playersById.set(playerId, nextPlayer);
      return;
    }
    if (previousPlayer && !nextPlayer) {
      playersById.set(playerId, previousPlayer);
      return;
    }
    playersById.set(playerId, {
      ...nextPlayer,
      x: lerp(previousPlayer.x, nextPlayer.x, t),
      y: lerp(previousPlayer.y, nextPlayer.y, t),
      vx: lerp(previousPlayer.vx || 0, nextPlayer.vx || 0, t),
      vy: lerp(previousPlayer.vy || 0, nextPlayer.vy || 0, t),
    });
  });

  return {
    elapsedMs: lerp(previousSnapshot.elapsedMs, nextSnapshot.elapsedMs, t),
    cameraY: lerp(previousSnapshot.cameraY, nextSnapshot.cameraY, t),
    playersById,
  };
}

function renderNetworkPlatformEntry(entry, timeSeconds) {
  const { x, rotation } = samplePlatformMotion(entry, timeSeconds);
  entry.el.style.transform = formatWorldTranslate(
    x,
    entry.worldY - state.cameraY,
    ` rotate(${rotation.toFixed(2)}deg)`
  );
}

function renderNetworkBoostEntry(entry) {
  entry.el.style.transform = formatWorldTranslate(entry.worldX, entry.worldY - state.cameraY);
}

function initializeEntityMotion(entry, x, y, rotation = 0) {
  if (typeof entry.currentX !== "number") entry.currentX = x;
  if (typeof entry.currentY !== "number") entry.currentY = y;
  if (typeof entry.targetX !== "number") entry.targetX = x;
  if (typeof entry.targetY !== "number") entry.targetY = y;
  if (typeof entry.currentRotation !== "number") entry.currentRotation = rotation;
  if (typeof entry.targetRotation !== "number") entry.targetRotation = rotation;
}

function updateNetworkTargets(snapshot) {
  // arena 크기는 resize 핸들러 + startGame 진입 시에만 캐싱한다 (매 스냅샷 layout read 금지).
  const syncNow = performance.now();
  syncNetworkClock(snapshot, syncNow);
  state.network.snapshot = snapshot;
  pushNetworkSnapshot(snapshot);
  // cameraY는 renderNetworkFrame에서 로컬 플레이어 기준으로 갱신 — 여기서 덮지 않는다.

  if (Array.isArray(snapshot.platforms)) {
    syncEntityMap(
      state.network.platformEls,
      snapshot.platforms,
      (platform) => {
        const el = document.createElement("div");
        el.className = `platform platform--${platform.kind}`;
        el.style.width = `${platform.width}px`;
        const decoType = PLATFORM_DECO_BY_MOTION[platform.motion?.type] || "";
        if (decoType) {
          el.innerHTML = `<span class="platform-deco platform-deco--${decoType}"></span>`;
        }
        worldEl.appendChild(el);
        return {
          el,
          id: platform.id,
          baseX: Number.isFinite(platform.baseX) ? platform.baseX : (Number.isFinite(platform.x) ? platform.x : 0),
          worldY: platform.y,
          width: platform.width,
          height: platform.height || 18,
          motion: platform.motion || null,
        };
      },
      (entry, platform) => {
        const el = entry.el;
        el.className = `platform platform--${platform.kind}`;
        el.style.width = `${platform.width}px`;
        const decoType = PLATFORM_DECO_BY_MOTION[platform.motion?.type] || "";
        el.innerHTML = decoType ? `<span class="platform-deco platform-deco--${decoType}"></span>` : "";
        entry.id = platform.id;
        entry.baseX = Number.isFinite(platform.baseX) ? platform.baseX : (Number.isFinite(platform.x) ? platform.x : 0);
        entry.worldY = platform.y;
        entry.width = platform.width;
        entry.height = platform.height || 18;
        entry.motion = platform.motion || null;
        renderNetworkPlatformEntry(entry, getBufferedNetworkElapsedMs(syncNow) / 1000);
      }
    );
  }

  if (Array.isArray(snapshot.boosts)) {
    const mySlot = state.network.mySlot;
    const serverBoostMap = new Map(snapshot.boosts.map((boost) => [boost.id, boost]));
    // pickedBoostIds 정리: 서버에서 완전 사라졌거나 (모두 픽업), 서버가 내
    // pick 을 인정한 경우엔 local set 에서 제거. 그 외엔 유지 (낙관적 hide).
    state.network.pickedBoostIds.forEach((id) => {
      const b = serverBoostMap.get(id);
      if (!b) {
        state.network.pickedBoostIds.delete(id);
      } else if (mySlot != null && Array.isArray(b.pickedBySlots) && b.pickedBySlots.includes(mySlot)) {
        state.network.pickedBoostIds.delete(id);
      }
    });
    // 내가 (local 또는 서버 확인) 먹은 boost 는 렌더에서 제외. 친구만 먹은
    // boost 는 남겨두고 is-friend-picked 로 표시.
    const visibleBoosts = snapshot.boosts.filter((boost) => {
      if (state.network.pickedBoostIds.has(boost.id)) return false;
      if (mySlot != null && Array.isArray(boost.pickedBySlots) && boost.pickedBySlots.includes(mySlot)) return false;
      return true;
    });
    const isFriendPicked = (boost) => {
      if (mySlot == null || !Array.isArray(boost.pickedBySlots)) return false;
      return boost.pickedBySlots.some((s) => s !== mySlot);
    };
    syncEntityMap(
      state.network.boostEls,
      visibleBoosts,
      (boost) => {
        const el = document.createElement("div");
        el.className = `boost boost--${boost.kind}${isFriendPicked(boost) ? ' is-friend-picked' : ''}`;
        el.textContent = BOOST_META[boost.kind]?.label || "";
        worldEl.appendChild(el);
        return { el, id: boost.id, worldX: boost.x, worldY: boost.y, size: boost.size, kind: boost.kind };
      },
      (entry, boost) => {
        const el = entry.el;
        el.className = `boost boost--${boost.kind}${isFriendPicked(boost) ? ' is-friend-picked' : ''}`;
        el.textContent = BOOST_META[boost.kind]?.label || "";
        entry.id = boost.id;
        entry.worldX = boost.x;
        entry.worldY = boost.y;
        entry.size = boost.size;
        entry.kind = boost.kind;
        renderNetworkBoostEntry(entry);
      }
    );
  }

  if (Array.isArray(snapshot.monsters)) {
    const updateNow = performance.now();
    syncEntityMap(
      state.network.monsterEls,
      snapshot.monsters,
      (m) => {
        const el = document.createElement("div");
        el.className = `monster monster--${m.kind}`;
        worldEl.appendChild(el);
        return {
          el,
          id: m.id,
          prevX: m.x,
          prevY: m.y,
          worldX: m.x,
          worldY: m.y,
          size: m.size,
          kind: m.kind,
          vx: m.vx || 0,
          vy: m.vy || 0,
          lastUpdateMs: updateNow,
        };
      },
      (entry, m) => {
        entry.el.className = `monster monster--${m.kind}`;
        entry.id = m.id;
        entry.prevX = entry.worldX;
        entry.prevY = entry.worldY;
        entry.worldX = m.x;
        entry.worldY = m.y;
        entry.size = m.size;
        entry.kind = m.kind;
        entry.vx = m.vx || 0;
        entry.vy = m.vy || 0;
        entry.lastUpdateMs = updateNow;
      }
    );
  }

  syncEntityMap(
    state.network.playerEls,
    snapshot.players || [],
    (player) => {
      const el = document.createElement("div");
      el.className = "player";
      worldEl.appendChild(el);
      return { el, avatarEl: null, spriteEl: null, pose: null, characterId: null };
    },
    (entry, player) => {
      const previousLatest = entry.latest;
      const pose = getPoseFromStateLike(player);
      const isLocalPlayer = Boolean(gameBoot?.playerId) && player.id === gameBoot.playerId;
      const setupForRender = isLocalPlayer
        ? state.setup[0]
        : { ...createDefaultSetup(player.characterId), characterId: player.characterId };
      if (entry.characterId !== player.characterId || !entry.avatarEl) {
        entry.el.innerHTML = createAvatarMarkup(
          setupForRender,
          getAvatarLabel(player.name, `${player.slot + 1}P`),
          false,
          pose
        );
        entry.avatarEl = entry.el.querySelector(".avatar");
        entry.spriteEl = entry.el.querySelector(".avatar__sprite");
        entry.characterId = player.characterId;
        entry.pose = pose;
      } else if (entry.pose !== pose) {
        setActiveAvatarPose(entry.avatarEl, pose);
        entry.pose = pose;
      }

      initializeEntityMotion(entry, player.x, player.y);
      entry.id = player.id;
      entry.targetX = player.x;
      entry.targetY = player.y;
      entry.serverX = player.x;
      entry.serverY = player.y;
      entry.prevServerVy = entry.serverVy || 0;
      entry.serverVx = player.vx || 0;
      entry.serverVy = player.vy || 0;
      entry.el.classList.toggle("is-eliminated", !player.alive);
      if (entry.avatarEl) {
        entry.avatarEl.classList.toggle("is-left", player.vx < -0.35);
        entry.avatarEl.classList.toggle("is-right", player.vx > 0.35);
        entry.avatarEl.classList.toggle("is-falling", player.vy > 0.8);
        entry.avatarEl.classList.toggle("is-rising", player.vy <= 0.8);
      }
      entry.isLocalPlayer = isLocalPlayer;
      entry.alive = player.alive;
      entry.latest = player;
      if (isLocalPlayer) {
        ensureLocalNetworkPlayer(entry, player);
      }

      // bounceTag가 변하면 새 점프(착지/슈퍼/부스트)이므로 시각효과 트리거
      const bounceChanged =
        previousLatest && Number.isFinite(previousLatest.bounceTag) &&
        Number.isFinite(player.bounceTag) &&
        previousLatest.bounceTag !== player.bounceTag;

      if (!isLocalPlayer && bounceChanged && previousLatest.alive && player.alive) {
        const cx = player.x + player.width / 2;
        const cyMid = player.y + player.height / 2;
        const cyFoot = player.y + player.height;
        if (player.lastBounceKind === "boost") {
          spawnEffect("boost", cx, cyMid);
          spawnEffect("pickup", cx, player.y + 8);
          spawnEffect("burst", cx, cyMid);
          if (isLocalPlayer) playBoostSound();
          triggerNetworkBoostFx(entry, "boost");
        } else if (player.lastBounceKind === "super") {
          spawnEffect("boost", cx, cyMid);
          spawnEffect("burst", cx, cyMid);
          if (isLocalPlayer) playBoostSound();
          triggerNetworkBoostFx(entry, "super");
        } else {
          // 일반 착지
          spawnEffect("land", cx, cyFoot + 4);
          spawnEffect("jump", cx, cyFoot);
          if (isLocalPlayer) {
            playLandSound();
            playJumpSound();
          }
        }
      }
    }
  );

  updateHudFromSnapshot(snapshot.players || []);
  updateRivalGauge(snapshot);

  if (!snapshot.running && snapshot.waitingFor > 0) {
    setStatus(`친구 접속 대기 중... ${snapshot.expectedPlayers - snapshot.waitingFor}/${snapshot.expectedPlayers} 준비`);
  } else if (snapshot.running) {
    const aliveCount = (snapshot.players || []).filter((player) => player.alive).length;
    setStatus(aliveCount > 1 ? "같은 맵에서 함께 점프 중!" : "한 명만 남았습니다. 끝까지 올라가세요!");
    // 모든 플레이어 합류 완료 → 인트로 fade out 트리거
    if (onNetworkRunning) {
      const cb = onNetworkRunning;
      onNetworkRunning = null;
      cb();
    }
  }
}

/* 2P 라이벌 게이지 갱신. 1P/관전/snapshot 부족 시 숨김.
 * 마커 위치 = bestHeight / max(둘 다, 최소 10m) 비율. 죽으면 회색.
 * 게이지 자체는 절대 위치값을 만들지 않고 비례만 보여줘서 "30m 뒤처짐!"
 * 같은 절망감 대신 "쟤 어디 있나" 정도의 가벼운 시각 신호만 준다.
 */
function updateRivalGauge(snapshot) {
  if (!rivalGaugeEl || !isRoomSession) return;
  const mySlot = state.network.mySlot;
  const players = Array.isArray(snapshot?.players) ? snapshot.players : [];
  if (mySlot == null || state.isSpectator || players.length < 2) {
    rivalGaugeEl.classList.add("is-hidden");
    return;
  }
  const me = players.find((p) => p.slot === mySlot);
  const rival = players.find((p) => p.slot !== mySlot);
  if (!me || !rival) {
    rivalGaugeEl.classList.add("is-hidden");
    return;
  }
  rivalGaugeEl.classList.remove("is-hidden");

  const myH = Number.isFinite(me.bestHeight) ? Math.max(0, me.bestHeight) : 0;
  const rivalH = Number.isFinite(rival.bestHeight) ? Math.max(0, rival.bestHeight) : 0;
  // Codex 리뷰: 시작 직후 둘 다 0 이면 마커 겹쳐서 정보 없음. 둘 다 5m 미만이면
  // 잠시 숨김 — 첫 도약 끝나면 자연스럽게 노출.
  if (myH < 5 && rivalH < 5) {
    rivalGaugeEl.classList.add("is-hidden");
    return;
  }
  const maxH = Math.max(myH, rivalH, 10);
  // 마커가 트랙 위/아래 끝에서 반쯤 튀어나오지 않도록 0~92% 범위로 클램프.
  const toPct = (h) => Math.max(0, Math.min(92, (h / maxH) * 100));

  rivalMarkerMeEl.style.bottom = `${toPct(myH)}%`;
  rivalMarkerRivalEl.style.bottom = `${toPct(rivalH)}%`;
  rivalMarkerMeEl.classList.toggle("is-dead", me.alive === false);
  rivalMarkerRivalEl.classList.toggle("is-dead", rival.alive === false);
}

function applyJumpInitFrame(frame) {
  const wasJoined = state.network.joined;
  clearNetworkWorld();
  state.network.joined = wasJoined;
  state.network.protocol = frame.protocol || "jump/v1";
  state.network.initialized = true;
  state.network.lastSeq = Number.isFinite(frame.seq) ? frame.seq : 0;
  // Active players keep a local camera; spectators can follow the room camera.
  if (state.isSpectator && Number.isFinite(frame.cameraY)) {
    state.cameraY = frame.cameraY;
  }
  updateNetworkTargets(frame);
}

function applyJumpPatchFrame(frame) {
  if (!state.network.initialized) return;
  const nextSeq = Number.isFinite(frame.seq) ? frame.seq : state.network.lastSeq + 1;
  if (nextSeq <= state.network.lastSeq) return;
  state.network.protocol = frame.protocol || state.network.protocol;
  state.network.lastSeq = nextSeq;
  updateNetworkTargets(frame);
}

function applyLegacyJumpState(frame) {
  if (!state.network.initialized) {
    clearNetworkWorld();
    state.network.protocol = "jump_state_legacy";
    state.network.initialized = true;
  }
  updateNetworkTargets(frame);
}

function seedNetworkCameraFromLocalPlayer(player) {
  if (!player || !Number.isFinite(player.y)) return;
  const arenaH = state.arenaMetrics.clientHeight || 600;
  const cameraOffset = Math.min(arenaH * 0.5, 360);
  state.cameraY = Math.min(state.cameraY, player.y - cameraOffset);
}

function ensureLocalNetworkPlayer(entry, snapshotPlayer) {
  if (!isRoomSession || state.isSpectator || !entry || !snapshotPlayer) return null;

  let player = state.players[0] || null;
  if (!player || player.id !== snapshotPlayer.id) {
    player = {
      id: snapshotPlayer.id,
      slot: 0,
      x: Number.isFinite(snapshotPlayer.x) ? snapshotPlayer.x : 228,
      y: Number.isFinite(snapshotPlayer.y)
        ? snapshotPlayer.y
        : settings.startLineY - settings.playerSpawnOffset,
      width: Number.isFinite(snapshotPlayer.width) ? snapshotPlayer.width : 46,
      height: Number.isFinite(snapshotPlayer.height) ? snapshotPlayer.height : 46,
      vx: Number.isFinite(snapshotPlayer.vx) ? snapshotPlayer.vx : 0,
      vy: Number.isFinite(snapshotPlayer.vy) ? snapshotPlayer.vy : settings.normalJump,
      bestHeight: Number.isFinite(snapshotPlayer.bestHeight) ? snapshotPlayer.bestHeight : 0,
      alive: snapshotPlayer.alive !== false,
      jumpCount: Number.isFinite(snapshotPlayer.jumpCount) ? snapshotPlayer.jumpCount : 0,
      bounceTag: Number.isFinite(snapshotPlayer.bounceTag) ? snapshotPlayer.bounceTag : 0,
      lastBounceKind: snapshotPlayer.lastBounceKind || null,
      el: entry.el,
      avatarEl: entry.avatarEl,
      spriteEl: entry.spriteEl,
      pose: null,
    };
    state.players = [player];
    seedNetworkCameraFromLocalPlayer(player);
  }

  player.el = entry.el;
  player.avatarEl = entry.avatarEl;
  player.spriteEl = entry.spriteEl;
  player.width = Number.isFinite(snapshotPlayer.width) ? snapshotPlayer.width : player.width;
  player.height = Number.isFinite(snapshotPlayer.height) ? snapshotPlayer.height : player.height;
  entry.currentX = player.x;
  entry.currentY = player.y;
  entry.currentVy = player.vy;
  return player;
}

function syncNetworkCollisionWorld(now, motionTime) {
  state.platforms = Array.from(state.network.platformEls.values()).map((entry) => {
    const motion = samplePlatformMotion(entry, motionTime);
    return {
      id: entry.id,
      x: motion.x,
      y: entry.worldY,
      width: entry.width || 0,
      height: entry.height || 18,
      baseX: entry.baseX,
      rotation: motion.rotation,
      motion: entry.motion,
      el: entry.el,
    };
  });

  state.boosts = Array.from(state.network.boostEls.entries()).map(([id, entry]) => ({
    id,
    x: entry.worldX,
    y: entry.worldY,
    size: entry.size || 60,
    kind: entry.kind || "rocket",
    el: entry.el,
  }));

  state.monsters = Array.from(state.network.monsterEls.values()).map((entry) => {
    const t = entry.lastUpdateMs ? clamp((now - entry.lastUpdateMs) / NETWORK_TICK_MS, 0, 1) : 1;
    return {
      id: entry.id,
      x: lerp(entry.prevX, entry.worldX, t),
      y: lerp(entry.prevY, entry.worldY, t),
      size: entry.size || settings.monsterSize,
      kind: entry.kind,
      vx: entry.vx || 0,
      vy: entry.vy || 0,
      el: entry.el,
    };
  });
}

function updateLocalNetworkPhysics(dt, now, motionTime) {
  if (state.isSpectator || state.players.length === 0) return null;
  if (!state.arenaMetrics.clientHeight) {
    applyArenaScale(true);
    if (!state.arenaMetrics.clientHeight) return state.players[0] || null;
  }

  state.network.localPhysicsRemainderMs += Math.min(Math.max(dt, 0), 50);
  while (state.network.localPhysicsRemainderMs >= 16.67) {
    syncNetworkCollisionWorld(now, motionTime);
    updatePlayers();
    updateCamera();
    state.network.localPhysicsRemainderMs -= 16.67;
  }

  return state.players[0] || null;
}

function renderNetworkFrame(now) {
  if (!isRoomSession || !state.running) return;

  const dt = state.network.lastFrameTime ? now - state.network.lastFrameTime : 16.67;
  state.network.lastFrameTime = now;
  const bufferedState = sampleBufferedNetworkState(now);
  const motionTime = bufferedState
    ? bufferedState.elapsedMs / 1000
    : getBufferedNetworkElapsedMs(now) / 1000;
  const localPlayer = updateLocalNetworkPhysics(dt, now, motionTime);

  if (localPlayer && Number.isFinite(localPlayer.bestHeight)) {
    updateRunProgress(localPlayer.bestHeight);
  } else if (state.isSpectator) {
    // 관전자는 제일 높이 올라간 플레이어 기준으로 존 배경을 따라간다.
    let topHeight = 0;
    state.network.playerEls.forEach((entry) => {
      const h = entry.latest?.bestHeight;
      if (Number.isFinite(h) && h > topHeight) topHeight = h;
    });
    updateRunProgress(topHeight);
  }

  state.network.platformEls.forEach((entry) => {
    renderNetworkPlatformEntry(entry, motionTime);
  });

  state.network.boostEls.forEach((entry) => {
    renderNetworkBoostEntry(entry);
  });

  state.network.monsterEls.forEach((entry) => {
    const t = entry.lastUpdateMs
      ? clamp((now - entry.lastUpdateMs) / NETWORK_TICK_MS, 0, 1)
      : 1;
    const x = lerp(entry.prevX, entry.worldX, t);
    const y = lerp(entry.prevY, entry.worldY, t);
    entry.el.style.transform = formatWorldTranslate(x, y - state.cameraY);
  });

  let localPlayerEntry = null;
  state.network.playerEls.forEach((entry) => {
    if (entry.isLocalPlayer) {
      if (localPlayer && localPlayer.id === entry.id) {
        entry.currentX = localPlayer.x;
        entry.currentY = localPlayer.y;
        entry.currentVy = localPlayer.vy;
        entry.alive = localPlayer.alive;
        entry.latest = { ...(entry.latest || {}), ...localPlayer };
        entry.el.classList.toggle("is-eliminated", !localPlayer.alive);
        updatePlayerVisualState(localPlayer);
        localPlayerEntry = entry;
      } else {
        entry.currentX = entry.serverX;
        entry.currentY = entry.serverY;
        entry.currentVy = 0;
      }
    } else if (bufferedState?.playersById.has(entry.id)) {
      const sampledPlayer = bufferedState.playersById.get(entry.id);
      const dx = sampledPlayer.x - entry.currentX;
      const dy = sampledPlayer.y - entry.currentY;
      const shouldSnap =
        sampledPlayer.alive === false ||
        Math.hypot(dx, dy) > NETWORK_REMOTE_SNAP_DISTANCE;
      if (shouldSnap) {
        entry.currentX = sampledPlayer.x;
        entry.currentY = sampledPlayer.y;
      } else {
        const step = clamp(dt / 16.67, 0, 3);
        const follow = 1 - Math.pow(1 - NETWORK_REMOTE_FOLLOW_BASE, step);
        entry.currentX += dx * follow;
        entry.currentY += dy * follow;
      }
      entry.currentVy = sampledPlayer.vy || 0;
    } else {
      entry.currentX += (entry.serverX - entry.currentX) * 0.12;
      entry.currentY += (entry.serverY - entry.currentY) * 0.12;
    }

    entry.el.style.transform = formatWorldTranslate(entry.currentX, entry.currentY - state.cameraY);
  });

  if (state.isSpectator && bufferedState) {
    state.cameraY = bufferedState.cameraY;
  } else if (!state.isSpectator && localPlayer && !localPlayer.alive) {
    let topRemote = null;
    state.network.playerEls.forEach((entry) => {
      if (!entry.isLocalPlayer && entry.alive !== false) {
        if (!topRemote || entry.currentY < topRemote.currentY) topRemote = entry;
      }
    });
    if (topRemote) {
      const arenaH = state.arenaMetrics.clientHeight || 600;
      const cameraOffset = Math.min(arenaH * 0.5, 360);
      state.cameraY += (topRemote.currentY - cameraOffset - state.cameraY) * 0.08;
    }
  }

  state.effects.forEach((effect) => {
    effect.el.style.setProperty("--ty", `${effect.tyBase - state.cameraY}px`);
  });

  tickPerfMeter(now);
  state.network.renderFrameId = requestAnimationFrame(renderNetworkFrame);
}
function startNetworkRenderLoop() {
  stopNetworkRenderLoop();
  state.network.lastFrameTime = 0;
  state.network.renderFrameId = requestAnimationFrame(renderNetworkFrame);
}

function sendNetworkPing() {
  if (!state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) return;
  const pingId = state.network.nextPingId;
  state.network.nextPingId += 1;
  const sentAtMs = performance.now();
  state.network.pendingPings.set(pingId, sentAtMs);
  state.network.ws.send(JSON.stringify({ type: "ping", pingId, clientTimeMs: sentAtMs }));
}

function handleNetworkPong(msg) {
  const pingId = Number(msg.pingId);
  if (!Number.isFinite(pingId)) return;
  const sentAtMs = state.network.pendingPings.get(pingId);
  if (!Number.isFinite(sentAtMs)) return;
  state.network.pendingPings.delete(pingId);
  recordNetworkRttSample(performance.now() - sentAtMs);
}

function startNetworkPingLoop() {
  stopNetworkPingLoop();
  sendNetworkPing();
  state.network.pingIntervalId = window.setInterval(() => {
    sendNetworkPing();
  }, NETWORK_PING_INTERVAL_MS);
}

function sendNetworkInput(direction) {
  if (!state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) return;
  const player = state.players[0] || null;
  if (!player) {
    state.network.ws.send(JSON.stringify({ type: "player_input", direction }));
    return;
  }

  const pickedBoostIds = Array.from(state.network.pickedBoostIds);
  state.network.ws.send(JSON.stringify({
    type: "player_state",
    direction,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    width: player.width,
    height: player.height,
    bestHeight: player.bestHeight,
    alive: player.alive,
    jumpCount: player.jumpCount || 0,
    bounceTag: player.bounceTag || 0,
    lastBounceKind: player.lastBounceKind || null,
    cameraY: state.cameraY,
    pickedBoostIds,
  }));
}

function syncNetworkInput(force = false) {
  if (!isRoomSession || state.isSpectator) return;
  const direction = getPlayerDirection(0);
  if (!force && direction === state.network.lastSentDirection) return;
  state.network.lastSentDirection = direction;
  sendNetworkInput(direction);
}

function startNetworkInputLoop() {
  stopNetworkInputLoop();
  state.network.lastSentDirection = null;
  syncNetworkInput(true);
  state.network.inputIntervalId = window.setInterval(() => {
    syncNetworkInput(true);
  }, NETWORK_TICK_MS);
}

function handleNetworkMessage(msg) {
  switch (msg.type) {
    case "jump_init":
      applyJumpInitFrame(msg);
      break;
    case "jump_patch":
      applyJumpPatchFrame(msg);
      break;
    case "jump_state":
      applyLegacyJumpState(msg);
      break;
    case "pong":
      handleNetworkPong(msg);
      break;
    case "jump_joined":
      state.network.joined = true;
      state.network.mySlot = Number.isFinite(msg.slot) ? msg.slot : null;
      state.isSpectator = msg.role === "spectator";
      if (state.isSpectator) {
        stopNetworkInputLoop();
        setStatus("관전 중 — 채팅으로 응원해 주세요! 선수들이 열심히 올라가고 있어요.");
        if (spectatorBadgeEl) spectatorBadgeEl.classList.remove("is-hidden");
      } else if (spectatorBadgeEl) {
        spectatorBadgeEl.classList.add("is-hidden");
      }
      break;
    case "chat":
      addChatMessage(msg);
      break;
    case "scoreboard":
      state.running = false;
      stopNetworkInputLoop();
      stopNetworkRenderLoop();
      showNetworkResultsOverlay(msg.results || []);
      break;
    case "new_record":
      showNewRecordOverlay(msg, 'm');
      break;
    case "error":
      setStatus(msg.message || "방 플레이 연결 중 오류가 발생했습니다.");
      break;
    default:
      break;
  }
}

function showNewRecordOverlay(msg, unit) {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:10000',
    'display:flex;align-items:center;justify-content:center',
    'background:rgba(0,0,0,0.55);backdrop-filter:blur(4px)',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'background:linear-gradient(135deg,#ffde2e,#ffb800)',
    'padding:32px 36px;border-radius:24px;text-align:center',
    'box-shadow:0 20px 48px rgba(0,0,0,0.28)',
    'font-family:"Noto Sans KR",sans-serif',
    'animation:_nr_pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
  ].join(';');

  card.innerHTML = `
    <style>@keyframes _nr_pop{from{transform:scale(0.7);opacity:0}to{transform:scale(1);opacity:1}}</style>
    <div style="font-size:3.2rem;line-height:1">🏆</div>
    <div style="margin-top:10px;font-size:1.25rem;font-weight:800;color:#4e3400">이번 주 신기록!</div>
    <div style="margin:10px 0;font-size:2.6rem;font-weight:900;color:#182338">${msg.score}<span style="font-size:1.1rem">${unit}</span></div>
    ${msg.previousBest != null ? `<div style="font-size:0.88rem;color:rgba(78,52,0,0.72);font-weight:600">이전 기록: ${msg.previousBest}${unit}</div>` : ''}
    <div style="margin-top:14px;display:inline-block;background:#fff;padding:6px 18px;border-radius:12px;font-weight:800;color:#d97706">${msg.rank}위 달성!</div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.style.transition = 'opacity 0.4s';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 400);
  }, 3000);
}

function connectNetworkGame() {
  stopNetworkInputLoop();
  stopNetworkPingLoop();
  stopNetworkRenderLoop();
  if (state.network.ws) {
    try {
      state.network.ws.close();
    } catch {
      // ignore close errors
    }
    state.network.ws = null;
  }

  clearWorld();
  clearNetworkWorld();
  // arena 메트릭은 첫 snapshot 도착 시점에 이미 채워져 있어야 한다 (rAF에 의존하지 않음).
  applyArenaScale(true);

  const ws = new WebSocket(buildRoomWebSocketUrl(gameBoot.code));
  state.network.ws = ws;
  state.running = true;

  ws.addEventListener("open", () => {
    if (state.network.ws !== ws) return;
    ws.send(
      JSON.stringify({
        type: "join_game",
        code: gameBoot.code,
        name: gameBoot.name,
        playerId: gameBoot.playerId,
        gameId: gameBoot.gameId || "jump-climber",
        characterId: state.setup[0].characterId,
      })
    );
    startNetworkInputLoop();
    startNetworkPingLoop();
    startNetworkRenderLoop();
    showChatOverlay();
    setStatus("방에 합류했어요. 친구가 들어오면 같은 맵이 시작됩니다.");
  });

  ws.addEventListener("message", (event) => {
    if (state.network.ws !== ws) return;
    try {
      handleNetworkMessage(JSON.parse(event.data));
    } catch {
      // ignore malformed packets
    }
  });

  ws.addEventListener("close", () => {
    if (state.network.ws !== ws) return;
    state.network.ws = null;
    stopNetworkInputLoop();
    stopNetworkPingLoop();
    stopNetworkRenderLoop();
    if (state.running) {
      setStatus("방 연결이 끊어졌습니다. 다시 시작 버튼으로 재접속해 주세요.");
    }
  });
}

function getDisplayName(setup) {
  if (setup.selectedId === "random") return RANDOM_CHARACTER_OPTION.name;
  return getCharacter(setup.selectedId || setup.characterId).name;
}

function getDisplayAbility(setup) {
  if (setup.selectedId === "random") return RANDOM_CHARACTER_OPTION.abilityText;
  return getCharacter(setup.selectedId || setup.characterId).abilityText || "";
}

function renderSetupUI() {
  configRefs.forEach((ref, slot) => {
    const setup = state.setup[slot];
    const isActiveSlot = slot < state.playerCount;
    const previewId = setup.selectedId || setup.characterId;

    ref.card.classList.toggle("is-hidden", !isActiveSlot);
    ref.name.textContent = getDisplayName(setup);
    if (ref.ability) ref.ability.textContent = getDisplayAbility(setup);
    ref.preview.innerHTML = createAvatarMarkup({ characterId: previewId }, `${slot + 1}P`, false, "preview");

    const choices = [...PUBLIC_CHARACTER_LIST, RANDOM_CHARACTER_OPTION];
    ref.options.innerHTML = choices
      .map((item) => createCharacterOptionMarkup(item, slot, item.id === previewId))
      .join("");

    ref.options.querySelectorAll(".character-option").forEach((option) => {
      option.addEventListener("click", () => {
        applySetupChoice(state.setup[slot], option.dataset.characterId);
        renderSetupUI();
        updateHud();
        noteConfigChange();
      });
    });
  });

  updateHudVisibility();
}

function updateHudVisibility() {
  // hud-list는 동적 렌더이므로 별도 토글 불필요
}

function noteConfigChange() {
  setStatus(state.running ? "다시 시작하면 반영돼요." : "골랐으면 시작!");
}

// 모바일 1인 플레이가 메인 환경. 2P 모드는 더 이상 사용하지 않는다.

function releaseTouchForSlot(slot) {
  for (const [pointerId, assignedSlot] of state.touchAssignments.entries()) {
    if (assignedSlot === slot) {
      state.touchAssignments.delete(pointerId);
    }
  }
}

function getKeyboardDirection(slot) {
  let direction = 0;

  if (slot === 0) {
    if (state.keys.has("a") || state.keys.has("A")) direction -= 1;
    if (state.keys.has("d") || state.keys.has("D")) direction += 1;

    if (state.playerCount === 1) {
      if (state.keys.has("ArrowLeft")) direction -= 1;
      if (state.keys.has("ArrowRight")) direction += 1;
    }
  }

  if (slot === 1) {
    if (state.keys.has("ArrowLeft")) direction -= 1;
    if (state.keys.has("ArrowRight")) direction += 1;
  }

  return clamp(direction, -1, 1);
}

function getPlayerDirection(slot) {
  return clamp(getKeyboardDirection(slot) + state.playerTouchDirections[slot], -1, 1);
}

function createPlatform(y, isBase = false, anchorPlatform = null) {
  const profile = getPlatformProfile(y);
  const width = isBase
    ? 200
    : Math.round(random(profile.widthMin, profile.widthMax));

  let x;
  if (isBase) {
    x = (settings.worldWidth - width) / 2;
  } else {
    const reference = anchorPlatform || getTopmostPlatform();
    const referenceCenter = reference ? reference.x + reference.width / 2 : settings.worldWidth / 2;
    const centerBias = (settings.worldWidth / 2 - referenceCenter) * 0.12;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const signedShift = direction * random(profile.pathRequiredShift, profile.pathShift);
    const nextCenter = clamp(
      referenceCenter + centerBias + signedShift,
      width / 2 + settings.safePlatformInset,
      settings.worldWidth - width / 2 - settings.safePlatformInset
    );
    x = nextCenter - width / 2;
  }
  const kind = isBase ? "base" : PLATFORM_KINDS[Math.floor(random(0, PLATFORM_KINDS.length))];
  const motion = isBase
    ? { type: "static", amplitude: 0, speed: 0, phase: 0, rotateAmplitude: 0 }
    : createPlatformMotion();

  // 존별 기믹 플랫폼 (정지 플랫폼에만): 노을존 깜빡 구름(밟으면 1회 후 사라짐),
  // 우주존 달 트램펄린(더 높이 퐁). 솔로 전용 경로 — 2P 맵은 서버가 생성한다.
  const metersUp = (settings.startLineY - y) / 10;
  let gimmick = null;
  if (!isBase && motion.type === "static") {
    if (metersUp >= SPACE_ZONE_FROM && Math.random() < 0.18) gimmick = "spring";
    else if (metersUp >= ZONES[1].from && Math.random() < 0.2) gimmick = "crumble";
  }

  const el = document.createElement("div");
  el.className = gimmick ? `platform platform--${gimmick}` : `platform platform--${kind}`;
  el.style.width = `${width}px`;
  const decoType = PLATFORM_DECO_BY_MOTION[motion.type] || "";
  if (decoType) {
    el.innerHTML = `<span class="platform-deco platform-deco--${decoType}"></span>`;
  }
  worldEl.appendChild(el);

  const platform = {
    x,
    y,
    width,
    height: 18,
    el,
    baseX: x,
    rotation: 0,
    motion,
    gimmick,
  };

  // 우주존에서는 부스트가 조금 더 후하게 나온다 — 존마다 플레이 감각 차별화.
  // 기믹 플랫폼 위에는 부스트를 얹지 않는다 (연출 중첩 방지).
  const inSpaceZone = metersUp >= SPACE_ZONE_FROM;
  const boostChance = inSpaceZone ? 0.28 : 0.2;
  if (!isBase && !gimmick && motion.type === "static" && Math.random() < boostChance) {
    spawnBoost(platform);
  }

  return platform;
}

function spawnBoost(platform) {
  // 우주존에서는 별 부스트 비중이 높아진다 (연출용 — 효과는 동일)
  const starChance = (settings.startLineY - platform.y) / 10 >= SPACE_ZONE_FROM ? 0.75 : 0.5;
  const kind = Math.random() < starChance ? "star" : "rocket";
  const el = document.createElement("div");
  el.className = `boost boost--${kind}`;
  el.textContent = BOOST_META[kind].label;
  worldEl.appendChild(el);

  state.boosts.push({
    x: platform.x + platform.width / 2 - 30,
    y: platform.y - 68,
    size: 60,
    kind,
    el,
  });
}

// 몬스터: 가장자리에서 등장 → 랜덤 방향으로 떠돌이 → 수명/화면 밖에서 사라짐
function pickInitialMonsterAngle(direction) {
  const span = (Math.PI * 2) / 3;
  if (direction === 1) {
    return -span / 2 + Math.random() * span;
  }
  return Math.PI - span / 2 + Math.random() * span;
}

function spawnEdgeMonster() {
  const size = settings.monsterSize;
  const direction = Math.random() < 0.5 ? -1 : 1;
  const x = direction === 1 ? -size : settings.worldWidth;
  const arenaH = state.arenaMetrics.clientHeight || 600;
  const y = state.cameraY + (0.15 + Math.random() * 0.4) * arenaH;
  const kind = Math.random() < 0.55 ? "cloud_imp" : "fluff_ghost";
  const angle = pickInitialMonsterAngle(direction);
  const speed = settings.monsterSpeed;
  const el = document.createElement("div");
  el.className = `monster monster--${kind}`;
  worldEl.appendChild(el);
  const now = performance.now();
  state.monsters.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size,
    kind,
    el,
    spawnY: y,
    spawnTimeMs: now,
    nextTurnAt: now + random(settings.monsterTurnIntervalMinMs, settings.monsterTurnIntervalMaxMs),
  });
}

function updateMonsters() {
  const now = performance.now();
  const arenaH = state.arenaMetrics.clientHeight || 600;
  const speed = settings.monsterSpeed;
  state.monsters = state.monsters.filter((m) => {
    if (now >= m.nextTurnAt) {
      const angle = Math.random() * Math.PI * 2;
      m.vx = Math.cos(angle) * speed;
      m.vy = Math.sin(angle) * speed;
      m.nextTurnAt = now + random(settings.monsterTurnIntervalMinMs, settings.monsterTurnIntervalMaxMs);
    }

    m.x += m.vx;
    m.y += m.vy;

    const margin = settings.monsterSize * 1.3;
    const aged = (now - m.spawnTimeMs) > settings.monsterLifetimeMs;
    const offscreen = m.x < -margin || m.x > settings.worldWidth + margin;
    const fellBehind = m.y > state.cameraY + arenaH + 200;
    const tooHigh = m.y < state.cameraY - arenaH;
    if (aged || offscreen || fellBehind || tooHigh) {
      m.el.remove();
      return false;
    }
    return true;
  });

  if (state.players.some((p) => p.alive) && now >= state.nextMonsterSpawnAt) {
    spawnEdgeMonster();
    state.nextMonsterSpawnAt = now + random(settings.monsterSpawnIntervalMinMs, settings.monsterSpawnIntervalMaxMs);
  }
}

// 스파클 element pool — boost 픽업 1회당 6개 생성되므로 매번 createElement 비용 큼.
const sparklePool = [];
function spawnSparkles(worldCx, worldCy, kind) {
  for (let i = 0; i < 6; i += 1) {
    const sparkle = sparklePool.pop() || document.createElement("div");
    // 애니메이션 재시작 트릭: class 비웠다가 reflow 후 재적용
    sparkle.className = "";
    void sparkle.offsetWidth;
    sparkle.className = `boost-sparkle boost-sparkle--${kind}`;
    const offsetX = (Math.random() - 0.5) * 60;
    const offsetY = -10 - Math.random() * 50;
    sparkle.style.setProperty("--sparkle-x", `${offsetX}px`);
    sparkle.style.setProperty("--sparkle-y", `${offsetY}px`);
    sparkle.style.left = `${worldCx}px`;
    sparkle.style.top = `${worldCy}px`;
    sparkle.style.transform = `translate(-50%, -50%)`;
    worldEl.appendChild(sparkle);
    setTimeout(() => {
      sparkle.remove();
      sparklePool.push(sparkle);
    }, 700);
  }
}

function triggerNetworkBoostFx(entry, kind = "boost") {
  if (!entry || !entry.avatarEl) return;
  const fxClass = kind === "super" ? "is-super-boosting" : "is-boosting";
  entry.avatarEl.classList.add(fxClass);
  setTimeout(() => entry.avatarEl?.classList.remove(fxClass), 1100);

  arena.classList.add(kind === "super" ? "arena-flash--super" : "arena-flash--boost");
  setTimeout(() => {
    arena.classList.remove("arena-flash--boost", "arena-flash--super");
  }, 360);

  const latest = entry.latest;
  if (latest) {
    spawnSparkles(latest.x + latest.width / 2, latest.y + latest.height / 2, kind);
  }
}

// 부스트 픽업/슈퍼점프 시각효과 — 캐릭터 본체에 발광 + 화면 가장자리 플래시 + 스파클.
function triggerBoostFx(player, kind = "boost") {
  if (!player || !player.avatarEl) return;
  const avatar = player.avatarEl;
  const fxClass = kind === "super" ? "is-super-boosting" : "is-boosting";
  avatar.classList.add(fxClass);
  setTimeout(() => avatar.classList.remove(fxClass), 1100);

  arena.classList.add(kind === "super" ? "arena-flash--super" : "arena-flash--boost");
  setTimeout(() => {
    arena.classList.remove("arena-flash--boost", "arena-flash--super");
  }, 360);

  spawnSparkles(player.x + player.width / 2, player.y + player.height / 2, kind);
}

const EFFECT_SPECS = {
  land:   { w: 148, h: 72,  yOffsetMul: 0.56, lifeMs: 520 },
  burst:  { w: 184, h: 184, yOffsetMul: 0.5,  lifeMs: 620 },
  jump:   { w: 96,  h: 96,  yOffsetMul: 0.5,  lifeMs: 420 },
  boost:  { w: 96,  h: 96,  yOffsetMul: 0.5,  lifeMs: 420 },
  pickup: { w: 96,  h: 96,  yOffsetMul: 0.5,  lifeMs: 420 },
};

// 이펙트 element pool (kind별) — 매 점프마다 land+jump 이펙트 spawn하므로
// createElement/append/remove 비용이 모바일 lag의 핵심. pool로 createElement 비용 제거.
const effectPool = new Map();
function spawnEffect(kind, worldX, worldY) {
  const spec = EFFECT_SPECS[kind] || EFFECT_SPECS.jump;
  let pool = effectPool.get(kind);
  if (!pool) { pool = []; effectPool.set(kind, pool); }
  const el = pool.pop() || document.createElement("div");
  // 애니메이션 재시작 트릭: class 비웠다가 reflow 후 재적용 (CSS animation 한번만 재생)
  el.className = "";
  void el.offsetWidth;
  el.className = `effect effect--${kind}`;
  const tx = worldX - spec.w / 2;
  const tyBase = worldY - spec.h * spec.yOffsetMul;

  const effectObj = { el, tx, tyBase };
  state.effects.push(effectObj);

  el.style.setProperty("--tx", `${tx}px`);
  el.style.setProperty("--ty", `${tyBase - state.cameraY}px`);

  worldEl.appendChild(el);
  setTimeout(() => {
    el.remove();
    state.effects = state.effects.filter((e) => e !== effectObj);
    pool.push(el);
  }, spec.lifeMs);
}

function clearWorld() {
  cancelAnimationFrame(state.rafId);
  worldEl.innerHTML = "";
  state.players = [];
  state.platforms = [];
  state.boosts = [];
  state.monsters = [];
  state.effects = [];
  state.touchAssignments.clear();
  state.playerTouchDirections = [0, 0];
  state.arenaMetrics.clientWidth = 0;
  state.arenaMetrics.clientHeight = 0;
  state.arenaMetrics.scale = 1;
  state.arenaMetrics.worldHeight = 0;
  // HUD도 함께 비워야 dedup 시그니처 ""와 빈 rows 입력이 모순 없이 동작 (이전 HUD 잔존 방지).
  if (hudListEl) hudListEl.innerHTML = "";
  lastHudSignature = "";
}

function resetWorld() {
  clearWorld();

  const base = createPlatform(settings.startLineY, true);
  state.platforms.push(base);
  let lastPlatform = base;

  for (let i = 1; i < 32; i += 1) {
    const platform = createPlatform(settings.startLineY - i * settings.platformGap, false, lastPlatform);
    state.platforms.push(platform);
    lastPlatform = platform;
  }
}

function createPlayer(slot) {
  const positions = state.playerCount === 1 ? [228] : [155, 300];
  const el = document.createElement("div");
  el.className = "player";
  const localLabel = slot === 0
    ? getAvatarLabel(gameBoot?.name, `${slot + 1}P`)
    : `${slot + 1}P`;
  const abilities = getAbilities(state.setup[slot].characterId);
  el.innerHTML = createAvatarMarkup(state.setup[slot], localLabel, false, "jump_neutral");
  worldEl.appendChild(el);

  return {
    slot,
    x: positions[slot],
    y: settings.startLineY - settings.playerSpawnOffset - slot * 10,
    width: 46,
    height: 46,
    vx: 0,
    vy: settings.normalJump * abilities.jumpMul,
    bestHeight: 0,
    alive: true,
    jumpCount: 0,
    bounceTag: 0,
    lastBounceKind: null,
    el,
    avatarEl: el.querySelector(".avatar"),
    spriteEl: el.querySelector(".avatar__sprite"),
    pose: "jump_neutral",
  };
}

function updatePlatformMotionLocal() {
  const time = performance.now() / 1000;
  state.platforms.forEach((platform) => {
    const motion = samplePlatformMotion(platform, time);
    platform.x = motion.x;
    platform.rotation = motion.rotation;
  });
}

function ensurePlatformsAbove() {
  while (Math.min(...state.platforms.map((platform) => platform.y)) > state.cameraY - 1500) {
    const topmost = getTopmostPlatform();
    const newTop = topmost.y - settings.platformGap;
    const platform = createPlatform(newTop, false, topmost);
    state.platforms.push(platform);
  }

  const cleanupLimit = state.cameraY + state.arenaMetrics.clientHeight + 180;
  state.platforms = state.platforms.filter((platform) => {
    if (platform.y > cleanupLimit) {
      platform.el.remove();
      return false;
    }
    return true;
  });

  state.boosts = state.boosts.filter((boost) => {
    if (boost.y > cleanupLimit) {
      boost.el.remove();
      return false;
    }
    return true;
  });
  // 몬스터는 cross-screen 흐름이라 별도 cleanup 함수에서 처리 (updateMonsters)
}

function intersects(a, b) {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

function handleLanding(player, previousY) {
  if (!player.alive || player.vy <= 0) return;

  const feetNow = player.y + player.height;
  const feetBefore = previousY + player.height;

  for (const platform of state.platforms) {
    const inset = platform.width * 0.08;
    const hitX = platform.x + inset;
    const hitW = platform.width - inset * 2;
    const horizontalHit = player.x + player.width > hitX && player.x < hitX + hitW;
    const passedTop = feetBefore <= platform.y && feetNow >= platform.y;

    if (horizontalHit && passedTop) {
      const abilities = getAbilities(state.setup[player.slot].characterId);
      player.y = platform.y - player.height;
      player.jumpCount = (player.jumpCount || 0) + 1;
      const isSuperJump =
        abilities.superJumpEvery > 0 &&
        player.jumpCount % abilities.superJumpEvery === 0;
      const isSpring = platform.gimmick === "spring" && !isSuperJump;
      player.vy = isSuperJump
        ? settings.boostJump
        : isSpring
          ? settings.springJump * abilities.jumpMul
          : settings.normalJump * abilities.jumpMul;
      player.lastBounceKind = isSuperJump ? "super" : isSpring ? "boost" : "normal";
      player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
      const cx = player.x + player.width / 2;
      spawnEffect("land", cx, platform.y + 6);
      spawnEffect("jump", cx, platform.y);
      playLandSound();
      if (isSpring) {
        spawnEffect("burst", cx, player.y + player.height / 2);
        playSpringSound();
        triggerBoostFx(player, "boost");
      } else {
        playJumpSound();
      }
      if (isSuperJump) {
        spawnEffect("burst", cx, player.y + player.height / 2);
        triggerBoostFx(player, "super");
      }
      if (platform.gimmick === "crumble") {
        crumblePlatform(platform);
      }
      return;
    }
  }
}

// 깜빡 구름 — 한 번 밟히면 배열에서 즉시 제거(재착지 불가)하고 퐁 하고 사라진다.
// 이동은 inline transform이라 페이드는 opacity만 건드린다 (transform 충돌 방지).
function crumblePlatform(platform) {
  const index = state.platforms.indexOf(platform);
  if (index !== -1) state.platforms.splice(index, 1);
  platform.el.classList.add("is-poofing");
  spawnEffect("land", platform.x + platform.width / 2, platform.y);
  playPoofSound();
  window.setTimeout(() => platform.el.remove(), 420);
}

function handleBoostPickup(player) {
  if (!player.alive) return;

  const playerBox = { x: player.x, y: player.y, width: player.width, height: player.height };
  const abilities = getAbilities(state.setup[player.slot].characterId);

  state.boosts = state.boosts.filter((boost) => {
    const boostBox = { x: boost.x, y: boost.y, width: boost.size, height: boost.size };
    const picked = intersects(playerBox, boostBox);

    if (picked) {
      player.vy = settings.boostJump * abilities.boostMul;
      player.lastBounceKind = "boost";
      player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
      const bcx = boost.x + boost.size / 2;
      spawnEffect("boost", bcx, boost.y + boost.size / 2);
      spawnEffect("pickup", bcx, boost.y);
      spawnEffect("burst", bcx, boost.y + boost.size / 2);
      playBoostSound();
      triggerBoostFx(player, "boost");
      setStatus(`${slotLabel(player.slot)} ${BOOST_META[boost.kind].message}!`);
      if (isRoomSession && boost.id) {
        state.network.pickedBoostIds.add(boost.id);
        state.network.boostEls.delete(boost.id);
      }
      boost.el?.remove();
      return false;
    }

    return true;
  });
}

// 몬스터 hitbox: 가로 22% 인셋(본체 비율), 세로 22%~60% 구간. 위 안착, 아래 머리 박힘은
// vy=0으로 제자리 낙하, 옆은 수평 MTV. 시각 PNG의 본체 영역에 맞춤.
function resolveSoloMonsterCollisions(player, previousY) {
  if (!player.alive || state.monsters.length === 0) return;
  const sizeInsetX = settings.monsterSize * 0.22;
  const topInset = settings.monsterSize * 0.22;
  const bodyHeight = settings.monsterSize * 0.38;

  for (const m of state.monsters) {
    const hitX = m.x + sizeInsetX;
    const hitW = m.size - sizeInsetX * 2;
    const hitTop = m.y + topInset;
    const hitBottom = hitTop + bodyHeight;

    const horizontalHit = player.x + player.width > hitX && player.x < hitX + hitW;
    if (!horizontalHit) continue;

    // 위에서 떨어져 hitTop 통과 → 발판처럼 안착 + 점프
    if (player.vy > 0) {
      const feetNow = player.y + player.height;
      const feetBefore = previousY + player.height;
      if (feetBefore <= hitTop && feetNow >= hitTop) {
        const abilities = getAbilities(state.setup[player.slot].characterId);
        player.y = hitTop - player.height;
        player.jumpCount = (player.jumpCount || 0) + 1;
        const isSuperJump =
          abilities.superJumpEvery > 0 &&
          player.jumpCount % abilities.superJumpEvery === 0;
        player.vy = isSuperJump ? settings.boostJump : settings.normalJump * abilities.jumpMul;
        player.lastBounceKind = isSuperJump ? "super" : "normal";
        player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
        const cx = player.x + player.width / 2;
        spawnEffect("land", cx, hitTop + 6);
        spawnEffect("jump", cx, hitTop);
        playLandSound();
        playJumpSound();
        if (isSuperJump) {
          spawnEffect("burst", cx, player.y + player.height / 2);
          triggerBoostFx(player, "super");
        }
        continue;
      }
    }

    // 아래에서 머리 박힘 — 옆으로 밀지 않고 제자리에서 vy=0으로 떨어뜨림
    if (player.vy < 0) {
      const headNow = player.y;
      const headBefore = previousY;
      if (headBefore >= hitBottom && headNow <= hitBottom) {
        player.y = hitBottom;
        player.vy = 0;
        continue;
      }
    }

    // 옆 박힘 — MTV 수평 push
    const overlapY = Math.min(player.y + player.height, hitBottom) - Math.max(player.y, hitTop);
    if (overlapY <= 0) continue;
    const overlapX = Math.min(player.x + player.width, hitX + hitW) - Math.max(player.x, hitX);
    if (overlapX <= 0) continue;
    const playerCenter = player.x + player.width / 2;
    const monsterCenter = m.x + m.size / 2;
    if (playerCenter < monsterCenter) player.x -= overlapX;
    else player.x += overlapX;
    player.x = clamp(player.x, 0, settings.worldWidth - player.width);
  }
}

function updateBestHeight(player) {
  const climbed = Math.max(0, Math.round((settings.startLineY - player.y) / 10));
  player.bestHeight = Math.max(player.bestHeight, climbed);
}

function eliminatePlayer(player) {
  if (!player.alive) return;

  player.alive = false;
  player.vx = 0;
  player.vy = 0;
  player.el.classList.add("is-eliminated");
  releaseTouchForSlot(player.slot);
  state.playerTouchDirections[player.slot] = 0;

  const survivors = state.players.filter((entry) => entry.alive);
  if (survivors.length === 0) {
    endGame();
    return;
  }

  setStatus(`${slotLabel(player.slot)} 탈락! ${survivors.map((entry) => slotLabel(entry.slot)).join(" / ")} 계속 진행`);
}

function applyInput(player) {
  if (!player.alive) return;

  const abilities = getAbilities(state.setup[player.slot].characterId);
  const direction = getPlayerDirection(player.slot);
  player.vx = direction * settings.moveSpeed * abilities.moveMul;
  player.x += player.vx;
  player.x = clamp(player.x, 0, settings.worldWidth - player.width);
}

function updatePlayers() {
  state.players.forEach((player) => {
    if (!player.alive) return;

    const abilities = getAbilities(state.setup[player.slot].characterId);

    applyInput(player);
    const previousY = player.y;
    player.vy += settings.gravity * abilities.gravityMul;
    player.y += player.vy;

    handleLanding(player, previousY);
    handleBoostPickup(player);
    resolveSoloMonsterCollisions(player, previousY);
    updateBestHeight(player);

    const arenaH = state.arenaMetrics.clientHeight || 600;
    if (player.y > state.cameraY + arenaH + 140) {
      eliminatePlayer(player);
    }
  });
}

function updateCamera() {
  const alivePlayers = state.players.filter((player) => player.alive);
  if (alivePlayers.length === 0) return;

  const lowestVisiblePlayerY = Math.max(...alivePlayers.map((player) => player.y));
  // viewport 높이의 절반을 따라가되, PC가 너무 길어지지 않도록 360px에서 캡.
  // (이전 0.78은 PC에서 카메라가 너무 위 → 320 고정은 작은 모바일 가로에서 답답 → 균형점)
  const arenaH = state.arenaMetrics.clientHeight || 600;
  const cameraOffset = Math.min(arenaH * 0.5, 360);
  const target = Math.min(state.cameraY, lowestVisiblePlayerY - cameraOffset);
  state.cameraY += (target - state.cameraY) * 0.16;
}

function updatePlayerVisualState(player) {
  const avatar = player.avatarEl;
  if (!avatar) return;

  let pose = "jump_neutral";
  if (player.vy > 0.8) {
    pose = "fall_neutral";
  } else if (player.vx < -0.35) {
    pose = "jump_left";
  } else if (player.vx > 0.35) {
    pose = "jump_right";
  }

  if (player.pose !== pose) {
    player.pose = pose;
    setActiveAvatarPose(avatar, pose);
  }

  avatar.classList.toggle("is-left", player.vx < -0.35);
  avatar.classList.toggle("is-right", player.vx > 0.35);
  avatar.classList.toggle("is-falling", player.vy > 0.8);
  avatar.classList.toggle("is-rising", player.vy <= 0.8);
}

function render() {
  // applyArenaScale은 resize/startGame 시에만 호출 — 매 프레임 layout read 금지 (thrashing 방지)
  state.platforms.forEach((platform) => {
    platform.el.style.transform = formatWorldTranslate(
      platform.x,
      platform.y - state.cameraY,
      ` rotate(${(platform.rotation || 0).toFixed(2)}deg)`
    );
  });

  state.boosts.forEach((boost) => {
    boost.el.style.transform = formatWorldTranslate(boost.x, boost.y - state.cameraY);
  });

  state.monsters.forEach((m) => {
    m.el.style.transform = formatWorldTranslate(m.x, m.y - state.cameraY);
  });

  state.players.forEach((player) => {
    updatePlayerVisualState(player);
    player.el.style.transform = formatWorldTranslate(player.x, player.y - state.cameraY);
  });

  state.effects.forEach((effect) => {
    effect.el.style.setProperty("--ty", `${effect.tyBase - state.cameraY}px`);
  });
}

function updateHud() {
  const rows = [];
  for (let slot = 0; slot < state.playerCount; slot += 1) {
    const player = state.players.find((entry) => entry.slot === slot);
    const characterId = state.setup[slot]?.characterId;
    const charName = characterId ? getCharacter(characterId).name : `${slot + 1}P`;
    rows.push({
      name: charName,
      score: player ? player.bestHeight : 0,
      alive: player ? player.alive : true,
      isMe: slot === 0,
    });
  }
  renderHudList(rows);
}

function loop() {
  if (!state.running) return;

  ensurePlatformsAbove();
  updatePlatformMotionLocal();
  updateMonsters();
  updatePlayers();
  updateCamera();
  updateRunProgress(Math.max(0, ...state.players.map((player) => player.bestHeight)));
  render();
  updateHud();
  tickPerfMeter(performance.now());

  if (state.running) {
    state.rafId = requestAnimationFrame(loop);
  }
}

// 멀티 플레이 시 다른 플레이어 합류를 대기할 콜백 — updateNetworkTargets에서 running=true가 들어오면 호출.
let onNetworkRunning = null;

function presentCharacterIntro({ minMs = 2250, waitFor = null, maxMs = 12000 } = {}) {
  return new Promise((resolve) => {
    if (!characterIntroEl) { resolve(); return; }
    const setup = state.setup[0];
    const character = getCharacter(setup.characterId);
    introCharImgEl.src = getSpriteSrc(character, "preview");
    introCharImgEl.alt = character.name;
    introCharNameEl.textContent = character.name;
    introCharAbilityEl.textContent = character.abilityText || "";

    characterIntroEl.classList.remove("is-hidden", "is-fading");
    void characterIntroEl.offsetWidth;
    characterIntroEl.classList.add("is-active");

    playBoostSound();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      characterIntroEl.classList.add("is-fading");
      setTimeout(() => {
        characterIntroEl.classList.remove("is-active", "is-fading");
        characterIntroEl.classList.add("is-hidden");
        resolve();
      }, 320);
    };

    const minTimer = new Promise((r) => setTimeout(r, minMs));
    if (waitFor) {
      // 다른 플레이어가 모두 합류해 게임이 시작될 때까지 + 최소 표시 시간 만족 시 종료
      const safety = new Promise((r) => setTimeout(r, maxMs));
      Promise.all([minTimer, Promise.race([waitFor, safety])]).then(finish);
    } else {
      minTimer.then(finish);
    }
  });
}

function startGame() {
  ensureAudioUnlocked();
  state.setup.forEach((s) => {
    if (s.selectedId === "random") {
      s.characterId = pickRandomCharacterId();
    }
  });

  hideResultsOverlay();
  resetRunProgress();
  showScreen("play");
  requestAnimationFrame(() => applyArenaScale(true));
  showChatOverlay();

  if (isRoomSession) {
    // 방 플레이: 인트로 띄운 채로 ws 합류 → 모두 합류해 game.running=true가 되면 진입.
    // 안전 장치: maxMs 안에 안 되면 그냥 인트로 닫고 진입.
    const readyPromise = new Promise((resolve) => { onNetworkRunning = resolve; });
    connectNetworkGame();
    presentCharacterIntro({ minMs: 2250, waitFor: readyPromise, maxMs: 15000 });
  } else {
    presentCharacterIntro({ minMs: 2250 }).then(runSoloGame);
  }
}

function runSoloGame() {
  resetWorld();
  state.cameraY = 0;
  state.running = true;
  state.players = [];
  state.keys.clear();
  state.resultSubmitted = false;
  state.nextMonsterSpawnAt = performance.now() + settings.monsterFirstSpawnDelayMs;

  for (let slot = 0; slot < state.playerCount; slot += 1) {
    state.players.push(createPlayer(slot));
  }

  updateHud();
  applyArenaScale(true);
  render();
  setStatus("화면 좌우를 눌러 점프!");
  state.rafId = requestAnimationFrame(loop);
}

function endGame() {
  if (isRoomSession) return;

  state.running = false;
  cancelAnimationFrame(state.rafId);
  updateHud();
  submitRoundResult();
  showResultsOverlay();

  const summary = state.players
    .map((player) => `${slotLabel(player.slot)} ${player.bestHeight}m`)
    .join(" / ");
  setStatus(`게임 종료! 최고 기록 ${summary}`);
}

function configureSessionMode() {
  if (!isRoomSession) {
    exitAfterResultsButton.textContent = isRoomSession ? "광장으로 가기" : "메인으로 나가기";
    backToSetupButton.textContent = "설정";
    restartButton.hidden = false;
    restartButton.textContent = "재시작";
    return;
  }

  state.playerCount = 1;
  setupHintEl.innerHTML =
    "같은 맵에서 동시에 점프! 화면 좌우 터치로 움직여요. <strong>🎲 랜덤</strong>은 숨겨진 친구도 추첨!";

  startButton.textContent = "방 합류";
  restartButton.hidden = true;
  backToSetupButton.textContent = "대기실";
}

function updatePointerDirection(slot, clientX) {
  const bounds = arena.getBoundingClientRect();
  const midpoint = bounds.left + bounds.width / 2;
  state.playerTouchDirections[slot] = clientX < midpoint ? -1 : 1;
}

function findFreeTouchSlot() {
  const activeSlots = new Set(state.touchAssignments.values());
  for (let slot = 0; slot < state.playerCount; slot += 1) {
    if (!activeSlots.has(slot)) return slot;
  }
  return null;
}

function handlePointerDown(event) {
  ensureAudioUnlocked();
  if (!state.running || state.chatFocused || resultsOverlay.classList.contains("is-active")) return;
  const activeSlots = new Set(state.touchAssignments.values());
  const slot = state.playerCount === 1 ? (activeSlots.has(0) ? null : 0) : findFreeTouchSlot();
  if (slot == null) return;

  event.preventDefault();
  state.touchAssignments.set(event.pointerId, slot);
  updatePointerDirection(slot, event.clientX);

  if (arena.setPointerCapture) {
    arena.setPointerCapture(event.pointerId);
  }

  syncNetworkInput();
}

function handlePointerMove(event) {
  if (!state.touchAssignments.has(event.pointerId)) return;

  event.preventDefault();
  updatePointerDirection(state.touchAssignments.get(event.pointerId), event.clientX);
  syncNetworkInput();
}

function clearPointer(event) {
  if (!state.touchAssignments.has(event.pointerId)) return;

  const slot = state.touchAssignments.get(event.pointerId);
  state.touchAssignments.delete(event.pointerId);
  state.playerTouchDirections[slot] = 0;

  if (arena.releasePointerCapture) {
    arena.releasePointerCapture(event.pointerId);
  }

  syncNetworkInput();
}

function bindSetupEvents() {
  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", () => {
    if (isRoomSession) {
      exitSession();
      return;
    }
    startGame();
  });
  backToSetupButton.addEventListener("click", () => {
    if (isRoomSession) {
      exitSession();
      return;
    }
    hideResultsOverlay();
    stopSoloGame();
    showScreen("setup");
    setStatus("설정을 바꾼 뒤 다시 시작해 보세요.");
  });
  restartFromResultsButton.addEventListener("click", () => {
    if (isRoomSession) {
      exitSession();
      return;
    }

    startGame();
  });
  exitAfterResultsButton.addEventListener("click", exitSession);

  resultsOverlay.addEventListener("pointerdown", (e) => e.stopPropagation());
  chatOverlayEl.addEventListener("pointerdown", (e) => e.stopPropagation());

  arena.addEventListener("pointerdown", handlePointerDown);
  arena.addEventListener("pointermove", handlePointerMove);
  arena.addEventListener("pointerup", clearPointer);
  arena.addEventListener("pointercancel", clearPointer);

  // 모바일 길게 누름 시 다운로드/공유/인쇄 컨텍스트 메뉴 차단 (채팅 입력은 영향 없음)
  const blockContextMenu = (event) => {
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
  };
  arena.addEventListener("contextmenu", blockContextMenu);
  setupScreen.addEventListener("contextmenu", blockContextMenu);
}

function bindKeyboardEvents() {
  window.addEventListener("keydown", (event) => {
    ensureAudioUnlocked();
    const trackedKeys = ["a", "A", "d", "D", "ArrowLeft", "ArrowRight"];
    if (!trackedKeys.includes(event.key)) return;
    if (state.chatFocused || isTypingTarget(event.target)) return;

    event.preventDefault();
    state.keys.add(event.key);
    syncNetworkInput();
  });

  window.addEventListener("keyup", (event) => {
    const trackedKeys = ["a", "A", "d", "D", "ArrowLeft", "ArrowRight"];
    if (!trackedKeys.includes(event.key)) return;
    if (state.chatFocused || isTypingTarget(event.target)) return;
    state.keys.delete(event.key);
    syncNetworkInput();
  });

  window.addEventListener("blur", () => {
    state.keys.clear();
    state.touchAssignments.clear();
    state.playerTouchDirections = [0, 0];
    syncNetworkInput(true);
  });
}

function bindChatEvents() {
  chatToggleBtn.addEventListener("click", () => toggleChatInput());

  chatSendBtn.addEventListener("click", sendChat);

  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChat();
    }
    if (e.key === "Escape") {
      toggleChatInput(false);
      chatInputEl.blur();
    }
  });

  chatInputEl.addEventListener("focus", () => {
    state.chatFocused = true;
    state.keys.clear();
    syncNetworkInput(true);
  });

  chatInputEl.addEventListener("blur", () => {
    state.chatFocused = false;
  });
}

configureSessionMode();
initPerfMeter();
bindSetupEvents();
bindKeyboardEvents();
bindChatEvents();
refreshSetupBest();
window.addEventListener("resize", () => applyArenaScale(true));
// HUD/topbar 높이 변화 등 window resize 없이 .arena 크기가 바뀌는 경우도 캐시 무효화.
if (typeof ResizeObserver !== "undefined" && arena) {
  const arenaResizeObserver = new ResizeObserver(() => applyArenaScale(true));
  arenaResizeObserver.observe(arena);
}
renderSetupUI();
updateHud();
showScreen("setup");
setStatus(isRoomSession ? "캐릭터 고르고 방 합류!" : "캐릭터 고르고 시작!");
