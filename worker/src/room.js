import {
  SS_KEYWORD_POOL,
  SS_KEYWORDS_BY_DIFFICULTY,
  SS_DIFFICULTY_BY_ROUND,
  SS_DURATION_BY_DIFFICULTY,
  SS_GUESSER_MULTIPLIER_BY_DIFFICULTY,
  SS_DRAWER_MULTIPLIER_BY_DIFFICULTY,
} from './ss_keywords.js';
import { submitScore } from './leaderboard.js';
import { pickGameCharacter } from './characters.js';
import { SERVER_GAME_MODULES } from './gameModules.js';

const COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

// Keep in sync with /games/registry.js (browser can't import that file here)
const GAME_PATHS = {
  'jump-climber': '/games/jump-climber/index.html',
  'sseuk-sseuk': '/games/sseuk-sseuk/index.html',
  'mallang-stairs': '/games/mallang-stairs/index.html',
  'machine-animal-runner': '/games/machine-animal-runner/index.html',
  'choice-holdem': '/games/choice-holdem/index.html',
};

const SS_VALID_CHARS = ['mochi-rabbit', 'pudding-hamster', 'peach-chick', 'latte-puppy', 'mint-kitten'];
const SS_TOTAL_ROUNDS = 5;
const SS_VOLUNTEER_TIMEOUT_MS = 5600;   // 출제자 모집 대기 — 기존 8000의 70% (대기 단축)
const SS_ROUND_DURATION_DEFAULT_MS = 75000; // 난이도 정보가 없을 때만 사용되는 안전망
const SS_BONUS_AFTER_FIRST_MS = 10000;
const SS_HINT_LENGTH_AT_MS    = 20000;
const SS_HINT_LETTER_AT_MS    = 40000;
const SS_LOTTERY_ANIM_MS      = 2500;

const SS_STROKE_POINTS_CAP     = 500;   // 단일 스트로크 최대 포인트 수
const SS_STROKES_PER_ROUND_CAP = 200;   // 라운드당 최대 스트로크 수

// 정답에 가까운 단어를 가리킬 때 쓰는 "거의 다 왔어요!" 임계 — 정답 길이 - 1 일치.
const SS_PROXIMITY_NEAR_DIFF   = 1;

function randomHex(len) {
  const bytes = new Uint8Array(len / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

const JUMP_GAME_SETTINGS = {
  worldWidth: 500,
  arenaHeight: 640,
  gravity: 0.42,
  moveSpeed: 4.8,
  normalJump: -11.8,
  boostJump: -16.8,
  platformGap: 96,
  platformWidthMin: 84,
  platformWidthMax: 150,
  startLineY: 540,
  playerSpawnOffset: 52,
  tickMs: 33,
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
  monsterBobAmplitude: 14,
  monsterTurnIntervalMinMs: 1400,
  monsterTurnIntervalMaxMs: 2800,
  monsterLifetimeMs: 9000,
  // 게임성 v2 — 후반 난이도 램프 (클라 settings와 동일 값 유지)
  monsterSpawnIntervalMinLateMs: 3200,
  monsterSpawnIntervalMaxLateMs: 6200,
  monsterRampHeightM: 400,
};

const PLATFORM_KINDS = ['leaf', 'cloud', 'cake'];

// 모든 캐릭터 ID와 특성. 신규 2종(latte-puppy, mint-kitten)은 클라 UI에선 랜덤으로만 등장.
const JUMP_CHARACTERS = [
  'mochi-rabbit',
  'pudding-hamster',
  'peach-chick',
  'latte-puppy',
  'mint-kitten',
];

// 클라 games/jump-climber/game.js CHARACTER_ABILITIES와 같은 값 유지.
// gravityMul은 하강(vy>0)에만 적용 — 점프 높이는 jumpMul만 좌우한다.
// 병아리 jumpMul 1.025 = 점프 높이 +5% (높이는 속도 제곱에 비례).
const JUMP_CHARACTER_ABILITIES = {
  'mochi-rabbit':    { jumpMul: 1.06,  gravityMul: 1.00, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 0 },
  'pudding-hamster': { jumpMul: 1.03,  gravityMul: 1.00, moveMul: 1.22, boostMul: 1.00, superJumpEvery: 0 },
  'peach-chick':     { jumpMul: 1.025, gravityMul: 0.80, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 0 },
  'latte-puppy':     { jumpMul: 1.00,  gravityMul: 1.00, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 4 },
  'mint-kitten':     { jumpMul: 1.00,  gravityMul: 1.00, moveMul: 1.00, boostMul: 1.40, superJumpEvery: 0 },
};

const JUMP_DEFAULT_ABILITIES = JUMP_CHARACTER_ABILITIES['mochi-rabbit'];

function getJumpAbilities(characterId) {
  return JUMP_CHARACTER_ABILITIES[characterId] || JUMP_DEFAULT_ABILITIES;
}

function sanitizeJumpCharacterId(characterId, fallback = 'mochi-rabbit') {
  return JUMP_CHARACTERS.includes(characterId) ? characterId : fallback;
}

const JUMP_PROTOCOL_VERSION = 'jump/v1';
const JUMP_BASE_STEP_MS = 1000 / 60;
const JUMP_SESSION_LIMITS = {
  players: 2,
  spectators: 2,
};
const JUMP_PATCH_RATES = {
  playerMs: JUMP_GAME_SETTINGS.tickMs,
  spectatorMs: 100,
};

function getJumpSubstepCount() {
  return Math.max(1, Math.round(JUMP_GAME_SETTINGS.tickMs / JUMP_BASE_STEP_MS));
}

function getJumpSubstepMs() {
  return JUMP_GAME_SETTINGS.tickMs / getJumpSubstepCount();
}

function getJumpStepScale(stepMs) {
  return stepMs / JUMP_BASE_STEP_MS;
}

function getJumpSpectatorPatchEvery() {
  return Math.max(1, Math.round(JUMP_PATCH_RATES.spectatorMs / JUMP_PATCH_RATES.playerMs));
}

function getStepBlend(baseFactor, stepMs, fullStepMs = JUMP_GAME_SETTINGS.tickMs) {
  const clamped = clamp(baseFactor, 0, 1);
  return 1 - Math.pow(1 - clamped, stepMs / fullStepMs);
}

function createPlatformMotion() {
  const roll = Math.random();
  if (roll < 0.18) {
    return {
      type: 'drift',
      amplitude: randomBetween(18, 34),
      speed: randomBetween(0.45, 0.78),
      phase: randomBetween(0, Math.PI * 2),
      rotateAmplitude: randomBetween(2, 4),
    };
  }

  if (roll < 0.33) {
    return {
      type: 'rotate',
      amplitude: 0,
      speed: randomBetween(0.5, 0.9),
      phase: randomBetween(0, Math.PI * 2),
      rotateAmplitude: randomBetween(5, 9),
    };
  }

  return {
    type: 'static',
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
  const climbed = Math.max(0, JUMP_GAME_SETTINGS.startLineY - y);
  return clamp(climbed / JUMP_GAME_SETTINGS.difficultyHeightRange, 0, 1);
}

function getPlatformProfile(y) {
  const progress = getDifficultyProgress(y);
  return {
    progress,
    widthMin: lerp(JUMP_GAME_SETTINGS.platformWidthMin, JUMP_GAME_SETTINGS.platformWidthMinLate, progress),
    widthMax: lerp(JUMP_GAME_SETTINGS.platformWidthMax, JUMP_GAME_SETTINGS.platformWidthMaxLate, progress),
    pathShift: lerp(JUMP_GAME_SETTINGS.pathShiftMin, JUMP_GAME_SETTINGS.pathShiftMax, progress),
    pathRequiredShift: lerp(JUMP_GAME_SETTINGS.pathRequiredShiftMin, JUMP_GAME_SETTINGS.pathRequiredShiftMax, progress),
  };
}

// ── 릴레이 룸 ────────────────────────────────────────────────────────────────
// 서버 권위 없음. 같은 방(roomCode) + 같은 gameId 의 relay 세션끼리 메시지를 그대로
// 중계만 한다. 게임 로직은 전적으로 클라이언트에 있다. 기여자는 서버 코드를 작성하지
// 않고 shared/relay.js + 이 중계 경로만으로 실시간 멀티 게임을 만들 수 있다.
const RELAY_MAX_PAYLOAD_BYTES = 8192;  // 단일 relay payload 직렬화 길이 상한 (UTF-8 바이트)
const RELAY_RATE_LIMIT = 40;           // 연결당 초당 메시지 상한
const RELAY_RATE_WINDOW_MS = 1000;
const RELAY_MAX_FRAME_CHARS = 65536;   // parse 전 raw 프레임 길이 상한 (DO isolate 보호)
// 내장 권위형 게임 id — 릴레이로 합류 불가 (전용 서버 로직 보호).
const RESERVED_GAME_IDS = new Set(['jump-climber', 'mallang-quiz-battle', 'sseuk-sseuk']);
// 서버 권위형 모듈이 쓰는 storage 키 접두사 — 방 재사용 시 이 접두사만 통째로 지우면 된다.
const MODULE_STORAGE_PREFIX = 'mod:';

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.jumpGame = null;
    this.jumpLoop = null;
    this.sseukGame = null;
    this.relayRates = new Map();   // 릴레이/모듈 inbound rate limit: ws -> { windowStart, count }
    this.moduleGames = new Map();  // 서버 권위형 모듈 게임 상태: gameId -> state object
  }

  // Returns [{ws, player}] for all connected, registered players
  _getSessions() {
    return this.state.getWebSockets()
      .map(ws => ({ ws, player: ws.deserializeAttachment() }))
      .filter(({ player }) => player != null);
  }

  _getLobbySessions() {
    return this._getSessions().filter(({ player }) => player.role !== 'game');
  }

  _getGameSessions(gameId) {
    return this._getSessions().filter(({ player }) => player.role === 'game' && player.gameId === gameId);
  }

  _getJumpSessions({ spectators = null } = {}) {
    return this._getGameSessions('jump-climber').filter(({ player }) => {
      if (spectators == null) return true;
      return Boolean(player.isSpectator) === spectators;
    });
  }

  _broadcastAll(msg) {
    const text = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(text); } catch { /* ignore closed */ }
    }
  }

  _broadcastExcept(msg, excludeWs) {
    const text = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === excludeWs) continue;
      try { ws.send(text); } catch { /* ignore closed */ }
    }
  }

  _broadcastGame(msg, gameId = 'jump-climber', { spectators = null } = {}) {
    const text = JSON.stringify(msg);
    for (const { ws, player } of this._getGameSessions(gameId)) {
      if (spectators != null && Boolean(player.isSpectator) !== spectators) continue;
      try { ws.send(text); } catch { /* ignore closed */ }
    }
  }

  // ── 릴레이 룸 (서버 권위 없음 — 같은 방·게임 세션끼리 메시지 중계만) ──────────────
  // 로스터 순서는 입장 순서(joinSeq 오름차순)로 고정한다. getWebSockets() 자체는
  // 순서 보장이 없어(하이버네이션/재연결 시 뒤섞임) roster[0] 로 방장을 뽑는
  // 릴레이 게임(계단 레이스 등)에서 인원이 합류할 때마다 방장이 뒤바뀌는 문제가
  // 있었다. joinSeq 로 정렬하면 "먼저 들어온 사람이 방장"이 안정적으로 유지된다.
  _relayRoster(gameId) {
    return this._getGameSessions(gameId)
      .filter(({ player }) => player.mode === 'relay')
      .sort((a, b) => {
        const sa = a.player.joinSeq ?? Number.MAX_SAFE_INTEGER;
        const sb = b.player.joinSeq ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        return String(a.player.id).localeCompare(String(b.player.id));
      })
      .map(({ player }) => ({
        id: player.id,
        name: player.name,
        characterId: player.characterId || null,
      }));
  }

  _broadcastRelayPresence(gameId) {
    const text = JSON.stringify({ type: 'relay_presence', players: this._relayRoster(gameId) });
    for (const { ws, player } of this._getGameSessions(gameId)) {
      if (player.mode !== 'relay') continue;  // relay presence 는 relay 세션에만
      try { ws.send(text); } catch { /* ignore closed */ }
    }
  }

  async _handleRelayJoinGame(ws, msg) {
    const gameId = typeof msg.gameId === 'string' ? msg.gameId : '';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(gameId)) {
      ws.send(JSON.stringify({ type: 'error', message: '릴레이: 잘못된 gameId 입니다.' }));
      return;
    }
    // 내장 권위형 게임은 릴레이로 합류할 수 없다 (jump/quiz/sseuk 전용 로직 보호).
    if (RESERVED_GAME_IDS.has(gameId)) {
      ws.send(JSON.stringify({ type: 'error', message: '릴레이: 예약된 게임 id 라 사용할 수 없습니다.' }));
      return;
    }
    // 서버 권위형 모듈 게임 id 도 릴레이로 쓸 수 없다 (격리). 보통 위 라우팅에서 걸러지지만 방어.
    if (SERVER_GAME_MODULES.has(gameId)) {
      ws.send(JSON.stringify({ type: 'error', message: '릴레이: 서버 모듈 게임 id 는 릴레이로 사용할 수 없습니다.' }));
      return;
    }
    const prev = ws.deserializeAttachment() || {};
    // playerId 는 서버가 'join' 단계에서 부여한 prev.id 만 신뢰 (클라 사칭/rate-limit 우회 방지).
    const id = prev.id || randomHex(6);
    const name = String(msg.name || prev.name || '플레이어').slice(0, 32);
    const characterId = typeof msg.characterId === 'string' ? msg.characterId.slice(0, 40) : null;
    // 같은 게임에 이미 relay 로 합류한 연결이면 presence 재브로드캐스트 생략 (스팸 방지).
    const already = prev.role === 'game' && prev.mode === 'relay' && prev.gameId === gameId;
    // 입장 순서 도장 — 최초 relay 합류 시각을 보존해 로스터 정렬(방장 선정)을 안정화한다.
    // 재합류(같은 ws 재전송)면 기존 seq 를 유지해 순서가 튀지 않게 한다.
    const joinSeq = Number.isFinite(prev.joinSeq) ? prev.joinSeq : Date.now();
    ws.serializeAttachment({ id, name, role: 'game', gameId, mode: 'relay', characterId, joinSeq });
    ws.send(JSON.stringify({ type: 'relay_joined', playerId: id, players: this._relayRoster(gameId) }));
    if (!already) this._broadcastRelayPresence(gameId);
  }

  _handleRelayMessage(ws, player, msg) {
    if (!player || player.mode !== 'relay') return;
    // rate limit 은 연결(ws) 단위 — 클라가 id 를 바꿔 우회 못 함. in-memory(hibernation 시 리셋).
    const now = Date.now();
    let rec = this.relayRates.get(ws);
    if (!rec || now - rec.windowStart >= RELAY_RATE_WINDOW_MS) {
      rec = { windowStart: now, count: 0 };
      this.relayRates.set(ws, rec);
    }
    rec.count += 1;
    if (rec.count > RELAY_RATE_LIMIT) return;  // 초과분은 조용히 드롭
    // payload 크기 상한 — UTF-8 바이트 기준.
    let payloadText;
    try { payloadText = JSON.stringify(msg.payload ?? null); } catch { return; }
    if (new TextEncoder().encode(payloadText).length > RELAY_MAX_PAYLOAD_BYTES) return;
    const out = JSON.stringify({ type: 'relay', from: player.id, payload: msg.payload ?? null, ts: now });
    for (const { ws: otherWs, player: other } of this._getGameSessions(player.gameId)) {
      if (other.mode !== 'relay') continue;          // 권위형 세션에는 절대 중계하지 않음
      if (otherWs === ws && !msg.echo) continue;      // 기본은 송신자 제외 (echo:true 면 포함)
      try { otherWs.send(out); } catch { /* ignore closed */ }
    }
  }

  // ── 서버 권위형 게임 모듈 (gameModules.js 에 등록된 신규 게임 라우팅) ──────────────
  _moduleCtx(gameId) {
    if (!this.moduleGames.has(gameId)) this.moduleGames.set(gameId, {});
    // 모듈이 쓰는 storage 키는 전부 'mod:<gameId>:' 아래로 모은다. 그래야 방 코드가 재사용될 때
    // 코어가 이전 방의 모듈 상태(판·좌석 토큰)를 남김없이 지울 수 있다(_resetRoomState).
    const prefix = `${MODULE_STORAGE_PREFIX}${gameId}:`;
    const storage = {
      get: (key) => this.state.storage.get(prefix + key),
      put: (key, value) => this.state.storage.put(prefix + key, value),
      delete: (key) => this.state.storage.delete(prefix + key),
    };
    return {
      gameId,
      state: this.moduleGames.get(gameId),
      storage,
      sessions: () => this._getGameSessions(gameId).filter(({ player }) => player.mode === 'module'),
      roster: () => this._getGameSessions(gameId)
        .filter(({ player }) => player.mode === 'module')
        .map(({ player }) => ({ id: player.id, name: player.name })),
      broadcast: (m) => {
        const text = JSON.stringify(m);
        for (const { ws, player } of this._getGameSessions(gameId)) {
          if (player.mode !== 'module') continue;
          try { ws.send(text); } catch { /* ignore closed */ }
        }
      },
      sendTo: (target, m) => {
        // 같은 게임의 module 세션에만 전송 (ctx API 계약 안전성).
        const p = target.deserializeAttachment();
        if (!p || p.gameId !== gameId || p.mode !== 'module') return;
        try { target.send(JSON.stringify(m)); } catch { /* ignore closed */ }
      },
    };
  }

  async _handleModuleJoinGame(ws, msg) {
    const gameId = msg.gameId;
    const mod = SERVER_GAME_MODULES.get(gameId);
    if (!mod) {
      ws.send(JSON.stringify({ type: 'error', message: '알 수 없는 서버 게임 모듈입니다.' }));
      return;
    }
    const prev = ws.deserializeAttachment() || {};
    const id = prev.id || randomHex(6);  // 서버가 'join' 에서 부여한 id 만 신뢰 (사칭 방지)
    const name = String(msg.name || prev.name || '플레이어').slice(0, 32);
    const already = prev.role === 'game' && prev.mode === 'module' && prev.gameId === gameId;
    ws.serializeAttachment({ id, name, role: 'game', gameId, mode: 'module' });
    if (already) {
      // 재합류 스팸 방지 — onJoin 재호출/브로드캐스트 없이 가벼운 ack 만.
      ws.send(JSON.stringify({ type: 'mod', event: 're-joined', you: id }));
      return;
    }
    const ctx = this._moduleCtx(gameId);
    try { await mod.onJoin?.(ctx, ws, msg); } catch { /* 모듈 오류 격리 — 코어에 전파 금지 */ }
  }

  async _handleModuleMessage(ws, player, msg) {
    const mod = SERVER_GAME_MODULES.get(player.gameId);
    if (!mod) return;
    // inbound 캡 — 릴레이와 동일(연결 단위 rate limit + payload UTF-8 바이트 상한).
    const now = Date.now();
    let rec = this.relayRates.get(ws);
    if (!rec || now - rec.windowStart >= RELAY_RATE_WINDOW_MS) {
      rec = { windowStart: now, count: 0 };
      this.relayRates.set(ws, rec);
    }
    rec.count += 1;
    if (rec.count > RELAY_RATE_LIMIT) return;
    let payloadText;
    try { payloadText = JSON.stringify(msg.payload ?? null); } catch { return; }
    if (new TextEncoder().encode(payloadText).length > RELAY_MAX_PAYLOAD_BYTES) return;
    const ctx = this._moduleCtx(player.gameId);
    try { await mod.onMessage?.(ctx, ws, msg.payload ?? null); } catch { /* 모듈 오류 격리 */ }
  }

  async _submitScoresToLeaderboard(gameId, players) {
    try {
      if (!this.env?.DB || !Array.isArray(players) || players.length === 0) return;

      const roomCode = (await this.state.storage.get('roomCode')) || null;
      const sessions = this._getGameSessions(gameId);

      for (const { id, name, score, characterId } of players) {
        try {
          const { isNewRecord, previousBest, rank } = await submitScore(this.env.DB, {
            playerName: name,
            gameId,
            score,
            roomCode,
            characterId: characterId || null,
          });

          if (!isNewRecord) continue;

          const session = sessions.find(({ player }) => player.id === id);
          if (!session) continue;

          try {
            session.ws.send(JSON.stringify({ type: 'new_record', score, previousBest, rank }));
          } catch { /* ignore closed */ }
        } catch { /* ignore leaderboard submission failure */ }
      }
    } catch { /* never throw from leaderboard submission */ }
  }

  _buildGameVotes(sessions) {
    const result = {};
    for (const { player } of sessions) {
      if (player.gameVote) {
        if (!result[player.gameVote]) result[player.gameVote] = [];
        result[player.gameVote].push(player.name);
      }
    }
    return result;
  }

  _buildRankedScores(scores) {
    return Object.values(scores)
      .sort((a, b) => b.score - a.score)
      .map((entry, i) => ({ ...entry, rank: i + 1 }));
  }

  _createJumpPlayer(rosterPlayer, slot, totalPlayers, previous = null) {
    const positions = totalPlayers === 1 ? [228] : [155, 300];
    const characterId = sanitizeJumpCharacterId(previous?.characterId || 'mochi-rabbit');
    const abilities = getJumpAbilities(characterId);
    return {
      id: rosterPlayer.id,
      name: rosterPlayer.name,
      slot,
      colorIndex: rosterPlayer.colorIndex,
      characterId,
      connected: previous?.connected || false,
      inputDirection: 0,
      x: positions[slot] ?? 228,
      y: JUMP_GAME_SETTINGS.startLineY - JUMP_GAME_SETTINGS.playerSpawnOffset - slot * 10,
      width: 46,
      height: 46,
      vx: 0,
      vy: JUMP_GAME_SETTINGS.normalJump * abilities.jumpMul,
      bestHeight: 0,
      alive: true,
      jumpCount: 0,
      bounceTag: 0,        // 클라 픽업/슈퍼점프 이펙트 트리거 (단조 증가, wraparound 256)
      lastBounceKind: null, // 'normal' | 'super' | 'boost'
    };
  }

  _getTopmostJumpPlatform() {
    if (!this.jumpGame || this.jumpGame.platforms.length === 0) return null;
    return this.jumpGame.platforms.reduce(
      (top, platform) => (platform.y < top.y ? platform : top),
      this.jumpGame.platforms[0]
    );
  }

  // 발판 종류 비율 — 후반으로 갈수록 1회용 케이크 비중↑, 안전한 나뭇잎 비중↓.
  // (클라 pickPlatformKind와 같은 값 유지. 케이크/구름 행동 자체는 클라 로컬 판정)
  _pickJumpPlatformKind(progress) {
    const cakeShare = 0.2 + 0.15 * progress;
    const roll = Math.random();
    if (roll < cakeShare) return 'cake';
    if (roll < cakeShare + 0.35) return 'cloud';
    return 'leaf';
  }

  _createJumpPlatform(game, y, isBase = false, anchorPlatform = null) {
    const profile = getPlatformProfile(y);
    const width = isBase
      ? 200
      : Math.round(randomBetween(profile.widthMin, profile.widthMax));

    let x;
    if (isBase) {
      x = (JUMP_GAME_SETTINGS.worldWidth - width) / 2;
    } else {
      const reference = anchorPlatform || this._getTopmostJumpPlatform();
      const referenceCenter = reference ? reference.x + reference.width / 2 : JUMP_GAME_SETTINGS.worldWidth / 2;
      const centerBias = (JUMP_GAME_SETTINGS.worldWidth / 2 - referenceCenter) * 0.12;
      const direction = Math.random() < 0.5 ? -1 : 1;
      const signedShift = direction * randomBetween(profile.pathRequiredShift, profile.pathShift);
      const nextCenter = clamp(
        referenceCenter + centerBias + signedShift,
        width / 2 + JUMP_GAME_SETTINGS.safePlatformInset,
        JUMP_GAME_SETTINGS.worldWidth - width / 2 - JUMP_GAME_SETTINGS.safePlatformInset
      );
      x = nextCenter - width / 2;
    }
    const kind = isBase ? 'base' : this._pickJumpPlatformKind(profile.progress);
    const motion = isBase
      ? { type: 'static', amplitude: 0, speed: 0, phase: 0, rotateAmplitude: 0 }
      : createPlatformMotion();
    const platform = {
      id: `platform-${game.nextPlatformId++}`,
      x,
      y,
      width,
      height: 18,
      kind,
      baseX: x,
      rotation: 0,
      motion,
    };

    if (!isBase && motion.type === 'static' && Math.random() < 0.2) {
      this._spawnJumpBoost(game, platform);
    }

    return platform;
  }

  _spawnJumpBoost(game, platform) {
    // 2P 세션에서만 방해 아이템(storm) 등장 — 먹으면 상대 화면에 먹구름.
    // 1P 솔로(서버 미사용)·1인 방에선 기존 rocket/star만.
    const allowStorm = (game.expectedPlayers || 1) > 1;
    const kind = allowStorm && Math.random() < 0.25
      ? 'storm'
      : (Math.random() < 0.5 ? 'rocket' : 'star');
    game.boosts.push({
      id: `boost-${game.nextBoostId++}`,
      x: platform.x + platform.width / 2 - 30,
      y: platform.y - 68,
      size: 60,
      kind,
      // 어떤 slot 들이 이미 먹었는지. 2P 에선 한 명이 먹어도 다른 사람은
      // 또 먹을 수 있다 (snowball 완화). 모든 expected slot 이 채워지면
      // 서버에서 완전 삭제. 1P 에선 expectedPlayers=1 이라 첫 픽업에 사라짐.
      pickedBySlots: [],
    });
  }

  _ensureJumpGame(roster) {
    if (this.jumpGame) return this.jumpGame;

    const participants = roster
      .slice(0, JUMP_SESSION_LIMITS.players)
      .map((player, slot) => ({ ...player, slot }));
    this.jumpGame = {
      roster: participants,
      expectedPlayers: participants.length,
      players: {},
      platforms: [],
      boosts: [],
      monsters: [],
      cameraY: 0,
      elapsedMs: 0,
      nextPlatformId: 1,
      nextBoostId: 1,
      nextMonsterId: 1,
      nextMonsterSpawnAtMs: JUMP_GAME_SETTINGS.monsterFirstSpawnDelayMs,
      messageSeq: 0,
      running: false,
      worldDirty: true,
      cheerCount: 0,
    };

    participants.forEach((player, slot) => {
      this.jumpGame.players[player.id] = this._createJumpPlayer(player, slot, participants.length);
    });

    this._resetJumpGameWorld();
    return this.jumpGame;
  }

  _resetJumpGameWorld() {
    if (!this.jumpGame) return;

    const previousPlayers = this.jumpGame.players || {};
    const roster = this.jumpGame.roster;
    this.jumpGame.platforms = [];
    this.jumpGame.boosts = [];
    this.jumpGame.monsters = [];
    this.jumpGame.cameraY = 0;
    this.jumpGame.nextPlatformId = 1;
    this.jumpGame.nextBoostId = 1;
    this.jumpGame.nextMonsterId = 1;
    this.jumpGame.nextMonsterSpawnAtMs = JUMP_GAME_SETTINGS.monsterFirstSpawnDelayMs;
    this.jumpGame.elapsedMs = 0;
    this.jumpGame.messageSeq = 0;
    this.jumpGame.players = {};
    this.jumpGame.running = false;
    this.jumpGame.worldDirty = true;
    this.jumpGame.cheerCount = 0;

    roster.forEach((player, slot) => {
      this.jumpGame.players[player.id] = this._createJumpPlayer(
        player,
        slot,
        roster.length,
        previousPlayers[player.id]
      );
    });

    const base = this._createJumpPlatform(this.jumpGame, JUMP_GAME_SETTINGS.startLineY, true);
    this.jumpGame.platforms.push(base);
    let lastPlatform = base;

    for (let i = 1; i < 32; i += 1) {
      const platform = this._createJumpPlatform(
        this.jumpGame,
        JUMP_GAME_SETTINGS.startLineY - i * JUMP_GAME_SETTINGS.platformGap,
        false,
        lastPlatform
      );
      this.jumpGame.platforms.push(platform);
      lastPlatform = platform;
    }
  }

  _serializeJumpPlatform(platform) {
    return {
      id: platform.id,
      kind: platform.kind,
      width: platform.width,
      height: platform.height,
      y: platform.y,
      baseX: platform.baseX,
      motion: platform.motion ? { ...platform.motion } : null,
    };
  }

  _serializeJumpBoost(boost) {
    return { ...boost };
  }

  _serializeJumpMonster(monster) {
    return {
      id: monster.id,
      kind: monster.kind,
      x: monster.x,
      y: monster.y,
      size: monster.size,
      vx: monster.vx,
      vy: monster.vy,
    };
  }

  _buildJumpStateMessage(type, { includeWorld = false } = {}) {
    if (!this.jumpGame) return null;
    const shouldIncludeWorld = type === 'jump_init' || includeWorld;

    const message = {
      type,
      protocol: JUMP_PROTOCOL_VERSION,
      mode: type === 'jump_init' ? 'full' : 'patch',
      seq: this.jumpGame.messageSeq,
      running: this.jumpGame.running,
      waitingFor: Math.max(0, this.jumpGame.expectedPlayers - this._getJumpSessions({ spectators: false }).length),
      expectedPlayers: this.jumpGame.expectedPlayers,
      cameraY: this.jumpGame.cameraY,
      elapsedMs: this.jumpGame.elapsedMs,
      players: this.jumpGame.roster.map(({ id }) => ({ ...this.jumpGame.players[id] })),
      monsters: this.jumpGame.monsters.map((m) => this._serializeJumpMonster(m)),
    };

    if (shouldIncludeWorld) {
      message.platforms = this.jumpGame.platforms.map((platform) => this._serializeJumpPlatform(platform));
      message.boosts = this.jumpGame.boosts.map((boost) => this._serializeJumpBoost(boost));
    }

    return message;
  }

  _updateJumpPlatformMotion() {
    if (!this.jumpGame) return;
    const time = this.jumpGame.elapsedMs / 1000;

    this.jumpGame.platforms.forEach((platform) => {
      if (!platform.motion || platform.motion.type === 'static') {
        platform.x = platform.baseX;
        platform.rotation = 0;
        return;
      }

      const wave = Math.sin(time * platform.motion.speed + platform.motion.phase);
      platform.x = platform.baseX + (platform.motion.type === 'drift' ? wave * platform.motion.amplitude : 0);
      platform.rotation = wave * platform.motion.rotateAmplitude;
    });
  }

  _sendJumpInit(ws) {
    const init = this._buildJumpStateMessage('jump_init');
    if (!init) return;
    ws.send(JSON.stringify(init));
  }

  _broadcastJumpPatch({ forceSpectators = false } = {}) {
    if (!this.jumpGame) return;
    const includeWorld = Boolean(this.jumpGame.worldDirty);
    this.jumpGame.messageSeq += 1;
    const patch = this._buildJumpStateMessage('jump_patch', { includeWorld });
    if (!patch) return;
    this._broadcastGame(patch, 'jump-climber', { spectators: false });
    const shouldBroadcastToSpectators =
      forceSpectators ||
      !this.jumpGame.running ||
      includeWorld ||
      this.jumpGame.messageSeq % getJumpSpectatorPatchEvery() === 0;
    if (shouldBroadcastToSpectators) {
      this._broadcastGame(patch, 'jump-climber', { spectators: true });
    }
    this.jumpGame.worldDirty = false;
  }

  _startJumpLoop() {
    if (this.jumpLoop) clearInterval(this.jumpLoop);
    this.jumpLoop = setInterval(() => {
      this._tickJumpGame().catch(() => {});
    }, JUMP_GAME_SETTINGS.tickMs);
  }

  _stopJumpLoop() {
    if (this.jumpLoop) {
      clearInterval(this.jumpLoop);
      this.jumpLoop = null;
    }
  }

  _ensureJumpPlatformsAbove() {
    if (!this.jumpGame) return;
    let worldChanged = false;
    const previousPlatformCount = this.jumpGame.platforms.length;
    const previousBoostCount = this.jumpGame.boosts.length;
    const previousMonsterCount = this.jumpGame.monsters.length;

    while (Math.min(...this.jumpGame.platforms.map((platform) => platform.y)) > this.jumpGame.cameraY - 1500) {
      const topmost = this._getTopmostJumpPlatform();
      const newTop = topmost.y - JUMP_GAME_SETTINGS.platformGap;
      const platform = this._createJumpPlatform(this.jumpGame, newTop, false, topmost);
      this.jumpGame.platforms.push(platform);
      worldChanged = true;
    }

    const alivePlayers = Object.values(this.jumpGame.players || {}).filter((p) => p.alive);
    const lowestAliveY = alivePlayers.length > 0
      ? Math.max(...alivePlayers.map((p) => p.y))
      : this.jumpGame.cameraY;
    const cleanupLimit = lowestAliveY + JUMP_GAME_SETTINGS.arenaHeight + 180;
    this.jumpGame.platforms = this.jumpGame.platforms.filter((platform) => platform.y <= cleanupLimit);
    this.jumpGame.boosts = this.jumpGame.boosts.filter((boost) => boost.y <= cleanupLimit);
    // 몬스터는 cross-screen 흐름이라 _tickJumpMonsters에서 자체 cleanup

    if (
      worldChanged ||
      this.jumpGame.platforms.length !== previousPlatformCount ||
      this.jumpGame.boosts.length !== previousBoostCount ||
      this.jumpGame.monsters.length !== previousMonsterCount
    ) {
      this.jumpGame.worldDirty = true;
    }
  }

  _handleJumpLanding(player, previousY) {
    if (!this.jumpGame || !player.alive || player.vy <= 0) return;

    const feetNow = player.y + player.height;
    const feetBefore = previousY + player.height;

    for (const platform of this.jumpGame.platforms) {
      // 발판 PNG는 좌우에 투명 여백이 있어서 시각보다 hitbox가 더 넓음. 8% 인셋.
      const inset = platform.width * 0.08;
      const hitX = platform.x + inset;
      const hitW = platform.width - inset * 2;
      const horizontalHit = player.x + player.width > hitX && player.x < hitX + hitW;
      const passedTop = feetBefore <= platform.y && feetNow >= platform.y;

      if (horizontalHit && passedTop) {
        const abilities = getJumpAbilities(player.characterId);
        player.y = platform.y - player.height;
        player.jumpCount = (player.jumpCount || 0) + 1;
        const isSuperJump =
          abilities.superJumpEvery > 0 &&
          player.jumpCount % abilities.superJumpEvery === 0;
        player.vy = isSuperJump
          ? JUMP_GAME_SETTINGS.boostJump
          : JUMP_GAME_SETTINGS.normalJump * abilities.jumpMul;
        player.lastBounceKind = isSuperJump ? 'super' : 'normal';
        player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
        return;
      }
    }
  }

  _handleJumpBoostPickup(player) {
    if (!this.jumpGame || !player.alive) return;
    let pickedBoost = false;

    this.jumpGame.boosts = this.jumpGame.boosts.filter((boost) => {
      const intersects = !(
        player.x + player.width < boost.x ||
        player.x > boost.x + boost.size ||
        player.y + player.height < boost.y ||
        player.y > boost.y + boost.size
      );

      if (intersects) {
        const abilities = getJumpAbilities(player.characterId);
        player.vy = JUMP_GAME_SETTINGS.boostJump * abilities.boostMul;
        player.lastBounceKind = 'boost';
        player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
        pickedBoost = true;
        return false;
      }

      return true;
    });

    if (pickedBoost) {
      this.jumpGame.worldDirty = true;
    }
  }

  // ── 몬스터: 가장자리 바깥에서 등장 → 랜덤 방향으로 떠돌이 → 수명 끝나거나 화면 밖으로 사라짐 ──
  _initialMonsterAngle(direction) {
    // direction=1 (왼→오): -π/3 ~ π/3 사이 (오른쪽 반구)
    // direction=-1 (오→왼): 2π/3 ~ 4π/3 사이 (왼쪽 반구)
    const span = (Math.PI * 2) / 3;
    if (direction === 1) {
      return -span / 2 + Math.random() * span;
    }
    return Math.PI - span / 2 + Math.random() * span;
  }

  _spawnEdgeMonster(game) {
    const size = JUMP_GAME_SETTINGS.monsterSize;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const x = direction === 1 ? -size : JUMP_GAME_SETTINGS.worldWidth;
    const y = game.cameraY + (0.15 + Math.random() * 0.4) * JUMP_GAME_SETTINGS.arenaHeight;
    const kind = Math.random() < 0.55 ? 'cloud_imp' : 'fluff_ghost';
    const angle = this._initialMonsterAngle(direction);
    const speed = JUMP_GAME_SETTINGS.monsterSpeed;
    game.monsters.push({
      id: `monster-${game.nextMonsterId++}`,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      kind,
      spawnY: y,
      spawnTimeMs: game.elapsedMs,
      nextTurnAtMs: game.elapsedMs + randomBetween(
        JUMP_GAME_SETTINGS.monsterTurnIntervalMinMs,
        JUMP_GAME_SETTINGS.monsterTurnIntervalMaxMs
      ),
    });
    game.worldDirty = true;
  }

  _tickJumpMonsters(stepMs) {
    if (!this.jumpGame) return;
    const game = this.jumpGame;
    const stepScale = getJumpStepScale(stepMs);
    const speed = JUMP_GAME_SETTINGS.monsterSpeed;

    const before = game.monsters.length;
    game.monsters = game.monsters.filter((m) => {
      // 일정 간격마다 랜덤 방향 재선정 (8방향 비편향 랜덤)
      if (game.elapsedMs >= m.nextTurnAtMs) {
        const angle = Math.random() * Math.PI * 2;
        m.vx = Math.cos(angle) * speed;
        m.vy = Math.sin(angle) * speed;
        m.nextTurnAtMs = game.elapsedMs + randomBetween(
          JUMP_GAME_SETTINGS.monsterTurnIntervalMinMs,
          JUMP_GAME_SETTINGS.monsterTurnIntervalMaxMs
        );
      }

      m.x += m.vx * stepScale;
      m.y += m.vy * stepScale;

      const margin = JUMP_GAME_SETTINGS.monsterSize * 1.3;
      const aged = (game.elapsedMs - m.spawnTimeMs) > JUMP_GAME_SETTINGS.monsterLifetimeMs;
      const offscreen = m.x < -margin || m.x > JUMP_GAME_SETTINGS.worldWidth + margin;
      const fellBehind = m.y > game.cameraY + JUMP_GAME_SETTINGS.arenaHeight + 200;
      const tooHigh = m.y < game.cameraY - JUMP_GAME_SETTINGS.arenaHeight;
      return !(aged || offscreen || fellBehind || tooHigh);
    });
    if (game.monsters.length !== before) game.worldDirty = true;

    if (game.elapsedMs >= game.nextMonsterSpawnAtMs) {
      this._spawnEdgeMonster(game);
      // 고도에 비례해 스폰 간격 단축 — 후반 긴장감 (클라 updateMonsters와 동일 램프)
      const heightM = Math.max(0, (JUMP_GAME_SETTINGS.startLineY - 320 - game.cameraY) / 10);
      const ramp = clamp(heightM / JUMP_GAME_SETTINGS.monsterRampHeightM, 0, 1);
      game.nextMonsterSpawnAtMs = game.elapsedMs + randomBetween(
        lerp(JUMP_GAME_SETTINGS.monsterSpawnIntervalMinMs, JUMP_GAME_SETTINGS.monsterSpawnIntervalMinLateMs, ramp),
        lerp(JUMP_GAME_SETTINGS.monsterSpawnIntervalMaxMs, JUMP_GAME_SETTINGS.monsterSpawnIntervalMaxLateMs, ramp)
      );
    }
  }

  _resolveMonsterCollisions(player, previousY) {
    if (!this.jumpGame || !player.alive || this.jumpGame.monsters.length === 0) return;

    // 몬스터 hitbox 모델 (PNG 외곽 투명 영역 고려해 시각 본체에 맞춤):
    //  - 가로 22% 인셋 (약 280 - 124 = 156px 너비, 본체 비율)
    //  - 세로는 22%~60% 구간 (약 106px 높이)
    //  - 위에서 발이 hitTop 통과 → 발판처럼 안착 + 점프 회복
    //  - 아래에서 머리 박힘 → 수평 push 없이 vy=0 (제자리 낙하)
    //  - 옆 박힘 → 수평 MTV
    const sizeInsetX = JUMP_GAME_SETTINGS.monsterSize * 0.22;
    const topInset = JUMP_GAME_SETTINGS.monsterSize * 0.22;
    const bodyHeight = JUMP_GAME_SETTINGS.monsterSize * 0.38;

    for (const m of this.jumpGame.monsters) {
      const hitX = m.x + sizeInsetX;
      const hitW = m.size - sizeInsetX * 2;
      const hitTop = m.y + topInset;
      const hitBottom = hitTop + bodyHeight;

      const horizontalHit = player.x + player.width > hitX && player.x < hitX + hitW;
      if (!horizontalHit) continue;

      // 위에서 떨어져 hitTop 통과 → 발판처럼 안착 + 일반 점프
      if (player.vy > 0) {
        const feetNow = player.y + player.height;
        const feetBefore = previousY + player.height;
        if (feetBefore <= hitTop && feetNow >= hitTop) {
          const abilities = getJumpAbilities(player.characterId);
          player.y = hitTop - player.height;
          player.jumpCount = (player.jumpCount || 0) + 1;
          const isSuperJump =
            abilities.superJumpEvery > 0 &&
            player.jumpCount % abilities.superJumpEvery === 0;
          player.vy = isSuperJump
            ? JUMP_GAME_SETTINGS.boostJump
            : JUMP_GAME_SETTINGS.normalJump * abilities.jumpMul;
          player.lastBounceKind = isSuperJump ? 'super' : 'normal';
          player.bounceTag = ((player.bounceTag || 0) + 1) & 0xff;
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
      player.x = clamp(player.x, 0, JUMP_GAME_SETTINGS.worldWidth - player.width);
    }
  }

  _updateJumpCamera(stepMs = JUMP_GAME_SETTINGS.tickMs) {
    if (!this.jumpGame) return;
    const alivePlayers = Object.values(this.jumpGame.players).filter((player) => player.alive);
    if (alivePlayers.length === 0) return;

    const lowestVisiblePlayerY = Math.max(...alivePlayers.map((player) => player.y));
    const target = Math.min(this.jumpGame.cameraY, lowestVisiblePlayerY - 320);
    this.jumpGame.cameraY += (target - this.jumpGame.cameraY) * getStepBlend(0.16, stepMs);
  }

  _tickJumpPlayer(player, stepScale) {
    if (!this.jumpGame || !player.alive) return;

    const abilities = getJumpAbilities(player.characterId);

    player.vx = player.inputDirection * JUMP_GAME_SETTINGS.moveSpeed * abilities.moveMul;
    player.x += player.vx * stepScale;
    player.x = clamp(player.x, 0, JUMP_GAME_SETTINGS.worldWidth - player.width);

    const previousY = player.y;
    // gravityMul(병아리 사뿐 하강)은 내려갈 때만 — 상승은 기본 중력이라 점프 높이 불변
    player.vy += JUMP_GAME_SETTINGS.gravity * (player.vy > 0 ? abilities.gravityMul : 1) * stepScale;
    player.y += player.vy * stepScale;

    this._handleJumpLanding(player, previousY);
    this._handleJumpBoostPickup(player);
    this._resolveMonsterCollisions(player, previousY);

    const climbed = Math.max(0, Math.round((JUMP_GAME_SETTINGS.startLineY - player.y) / 10));
    player.bestHeight = Math.max(player.bestHeight, climbed);

    if (player.y > this.jumpGame.cameraY + JUMP_GAME_SETTINGS.arenaHeight + 140) {
      player.alive = false;
      player.vx = 0;
      player.vy = 0;
    }
  }

  async _finishJumpGame() {
    if (!this.jumpGame) return;

    this.jumpGame.running = false;
    this._stopJumpLoop();

    const scores = {};
    this.jumpGame.roster.forEach(({ id }) => {
      const player = this.jumpGame.players[id];
      scores[id] = {
        name: player.name,
        score: player.bestHeight,
        colorIndex: player.colorIndex,
        slot: player.slot,
        characterId: player.characterId,
      };
    });

    await this.state.storage.put('scores', scores);
    await this.state.storage.put('phase', 'results');
    this._submitScoresToLeaderboard('jump-climber', Object.entries(scores).map(([id, s]) => ({ id, name: s.name, score: s.score, characterId: s.characterId })));

    const ranked = this._buildRankedScores(scores);
    this._broadcastGame({
      type: 'scoreboard',
      results: ranked,
      submitted: ranked.length,
      total: this.jumpGame.expectedPlayers,
      final: true,
    }, 'jump-climber');
  }

  async _tickJumpGame() {
    if (!this.jumpGame || !this.jumpGame.running) return;

    this._ensureJumpPlatformsAbove();
    const players = Object.values(this.jumpGame.players);
    const substepMs = getJumpSubstepMs();
    const substepCount = getJumpSubstepCount();

    for (let step = 0; step < substepCount; step += 1) {
      this.jumpGame.elapsedMs += substepMs;
      this._updateJumpPlatformMotion();
      this._tickJumpMonsters(substepMs);

      if (players.every((player) => !player.alive)) {
        break;
      }
    }

    this._broadcastJumpPatch();

    if (players.every((player) => !player.alive)) {
      await this._finishJumpGame();
    }
  }

  async _handleJoinGame(ws, msg) {
    if (msg.gameId === 'sseuk-sseuk') {
      return await this._handleSseukJoinGame(ws, msg);
    }

    // 서버 권위형 모듈 게임 — 등록된 gameId 면 (클라가 claim 한 mode 와 무관하게) 모듈로
    // 라우팅. relay 검사보다 먼저 둬서 모듈 id 를 relay 로 가로채는 것을 차단한다.
    if (SERVER_GAME_MODULES.has(msg.gameId)) {
      return await this._handleModuleJoinGame(ws, msg);
    }

    // 릴레이 게임 — 서버 권위 없이 같은 방·게임 세션끼리 메시지 중계만. 기여자 게임은
    // 클라이언트가 mode:'relay' 로 합류한다 (내장 게임 id 는 위에서 이미 처리됨).
    if (msg.mode === 'relay') {
      return await this._handleRelayJoinGame(ws, msg);
    }

    const currentGame = (await this.state.storage.get('currentGame')) || null;
    const phase = (await this.state.storage.get('phase')) || 'lobby';
    const fullRoster = (await this.state.storage.get('gameRoster')) || [];
    const playerRoster = fullRoster.slice(0, JUMP_SESSION_LIMITS.players);

    if (currentGame !== 'jump-climber' || msg.gameId !== 'jump-climber' || phase !== 'playing') {
      ws.send(JSON.stringify({ type: 'error', message: '지금은 말랑프렌즈 점프 실시간 방에 합류할 수 없습니다.' }));
      return;
    }

    const rosterPlayer = fullRoster.find((p) => p.id === msg.playerId) || null;
    if (!rosterPlayer) {
      ws.send(JSON.stringify({ type: 'error', message: '방 플레이어 정보가 맞지 않습니다. 대기실에서 다시 시작해 주세요.' }));
      return;
    }

    const game = this._ensureJumpGame(playerRoster);
    const isSpectator = !playerRoster.some((p) => p.id === msg.playerId);

    if (isSpectator) {
      const activeSpectators = this._getJumpSessions({ spectators: true })
        .filter(({ ws: sessionWs }) => sessionWs !== ws);
      if (activeSpectators.length >= JUMP_SESSION_LIMITS.spectators) {
        ws.send(JSON.stringify({ type: 'error', message: '관전 자리가 꽉 찼습니다. 최대 2명까지 관전 가능합니다.' }));
        return;
      }

      ws.serializeAttachment({
        ...rosterPlayer,
        role: 'game',
        gameId: 'jump-climber',
        isSpectator: true,
      });
      ws.send(JSON.stringify({ type: 'jump_joined', role: 'spectator' }));
      this._sendJumpInit(ws);
      return;
    }

    const player = game.players[rosterPlayer.id];
    player.connected = true;
    player.inputDirection = 0;
    player.characterId = sanitizeJumpCharacterId(msg.characterId || player.characterId, player.characterId || 'mochi-rabbit');
    // 게임 시작 전이면 새 캐릭터 능력에 맞게 초기 vy를 재계산 (createJumpPlayer는 default로 계산).
    if (!game.running) {
      const abilities = getJumpAbilities(player.characterId);
      player.vy = JUMP_GAME_SETTINGS.normalJump * abilities.jumpMul;
      player.jumpCount = 0;
    }

    ws.serializeAttachment({
      ...rosterPlayer,
      role: 'game',
      gameId: 'jump-climber',
      slot: player.slot,
      characterId: player.characterId,
      isSpectator: false,
    });

    ws.send(JSON.stringify({ type: 'jump_joined', role: 'player', slot: player.slot }));

    const connectedPlayers = this._getJumpSessions({ spectators: false }).length;
    if (connectedPlayers >= game.expectedPlayers && !game.running) {
      game.running = true;
      this._startJumpLoop();
    }

    this._sendJumpInit(ws);
    this._broadcastJumpPatch();
  }

  // ── 쓱쓱 (Phase A: 라운드 머신 + 토큰 가드 + 라이프사이클 정리) ──
  // Phase B에서 캔버스/스트로크, Phase C에서 정식 키워드 풀/시간 힌트, Phase D에서 정답 판정/근접 힌트 추가.

  _initSseukGame(roster) {
    if (this.sseukGame) return;
    // 캐릭터는 랜덤 셔플 배정 (첫 5명 중복 없음). 클라가 보내준 characterId는
    // 이번 게임에서는 무시 — UI에서도 선택을 제공하지 않는다.
    const shuffled = [...SS_VALID_CHARS].sort(() => Math.random() - 0.5);
    this.sseukGame = {
      phase: 'waiting',
      currentRoundIdx: 0,
      totalRounds: SS_TOTAL_ROUNDS,
      players: roster.map((p, i) => ({
        id: p.id,
        name: p.name,
        colorIndex: i % COLORS.length,
        characterId: shuffled[i % shuffled.length],
        connected: false,
        ready: false,
        score: 0,
      })),
      drawerHistory: [],          // 각 라운드별 drawerId. 가중치 산정에 사용.
      stats: {},                  // playerId → 칭호(어워드) 산정용 누적 통계.
      usedKeywords: [],
      currentRound: null,         // { drawerId, keyword, syllableCount, startedAt, volunteers, firstCorrectAt, correctOrder, strokes }
      tokens: { volunteer: 0, round: 0, bonus: 0, hint: 0 },
      timers: { volunteer: null, round: null, bonus: null, hint: [] },
    };
  }

  // 칭호 산정용 플레이어 누적 통계 (게임 1판 동안 유지).
  _ssStat(id) {
    if (!this.sseukGame.stats) this.sseukGame.stats = {};
    if (!this.sseukGame.stats[id]) {
      this.sseukGame.stats[id] = {
        firstCorrect: 0,    // 1등 정답 횟수
        correct: 0,         // 총 정답 횟수
        bestMs: null,       // 가장 빠른 정답 (라운드 시작 후 ms)
        guesses: 0,         // 추측 시도 횟수
        volunteers: 0,      // 출제 자원 횟수
        drawerRounds: 0,    // 출제자로 뛴 라운드 수
        drawerRateSum: 0,   // 출제 라운드 정답률(q) 합 — 평균용
      };
    }
    return this.sseukGame.stats[id];
  }

  _clearSseukTimers() {
    if (!this.sseukGame) return;
    const t = this.sseukGame.timers;
    if (t.volunteer) { clearTimeout(t.volunteer); t.volunteer = null; }
    if (t.round)     { clearTimeout(t.round);     t.round = null; }
    if (t.bonus)     { clearTimeout(t.bonus);     t.bonus = null; }
    if (t.hint && t.hint.length) { for (const h of t.hint) clearTimeout(h); t.hint = []; }
    // Invalidate all in-flight callbacks.
    this.sseukGame.tokens.volunteer++;
    this.sseukGame.tokens.round++;
    this.sseukGame.tokens.bonus++;
    this.sseukGame.tokens.hint++;
  }

  async _handleSseukJoinGame(ws, msg) {
    const fullRoster = (await this.state.storage.get('gameRoster')) || [];
    const rosterPlayer = fullRoster.find(p => p.id === msg.playerId);
    if (!rosterPlayer) {
      ws.send(JSON.stringify({ type: 'error', message: '방 플레이어 정보가 맞지 않습니다.' }));
      return;
    }

    this._initSseukGame(fullRoster);

    const ssPlayer = this.sseukGame.players.find(p => p.id === msg.playerId);
    if (ssPlayer) {
      ssPlayer.connected = true;
      // 랜덤 배정 정책 — 클라의 characterId는 무시 (서버 측 shuffle 결과 유지).
    }

    ws.serializeAttachment({ ...rosterPlayer, role: 'game', gameId: 'sseuk-sseuk', isSpectator: false });

    // Build a phase-aware snapshot (mid-game rejoin support).
    const snapshot = {
      type: 'SS_JOINED',
      players: this.sseukGame.players,
      phase: this.sseukGame.phase,
      currentRoundIdx: this.sseukGame.currentRoundIdx,
      totalRounds: this.sseukGame.totalRounds,
      me: msg.playerId,
    };
    if (this.sseukGame.currentRound && this.sseukGame.phase !== 'waiting') {
      const r = this.sseukGame.currentRound;
      const isDrawer = r.drawerId === msg.playerId;
      const lengthRevealed = !!r.hintRevealed?.length;
      snapshot.round = {
        drawerId: r.drawerId,
        // syllableCount: 출제자 또는 length 힌트가 이미 공개된 경우에만 송신.
        syllableCount: (isDrawer || lengthRevealed) ? r.syllableCount : null,
        keyword: isDrawer ? r.keyword : null,
        difficulty: r.difficulty || null,
        timeLeftMs: this._sseukTimeLeftMs(),
        // 진행바 fill 비율 계산용 — 재접속 시 timeLeftMs/totalMs 로 시작
        // 위치를 맞춘다. bonus phase 면 보너스 총 시간이 totalMs.
        totalMs: this.sseukGame.phase === 'bonus'
          ? SS_BONUS_AFTER_FIRST_MS
          : (r.roundDurationMs || SS_ROUND_DURATION_DEFAULT_MS),
        // 미니 리더보드 복원용 — 이미 정답 맞힌 사람 + 그 순위.
        correctOrder: (r.correctOrder || []).map((entry, i) => {
          const p = this.sseukGame.players.find(x => x.id === entry.id);
          return { id: entry.id, name: p?.name || '?', rank: i + 1 };
        }),
        volunteersDeadlineAt: r.volunteersDeadlineAt || null,
        // letter 힌트도 이미 공개됐으면 함께 복원.
        revealedLetter: (r.hintRevealed?.letterIdx != null && !isDrawer)
          ? { position: r.hintRevealed.letterIdx, value: [...r.keyword][r.hintRevealed.letterIdx] }
          : null,
        // drawing 또는 bonus phase 면 지금까지 그려진 스트로크 전체를 함께 보낸다.
        // 재접속 사용자가 빈 캔버스를 보고 혼란스럽지 않도록.
        strokes: (this.sseukGame.phase === 'drawing' || this.sseukGame.phase === 'bonus')
          ? (r.strokes || [])
          : [],
      };
    }
    ws.send(JSON.stringify(snapshot));
    this._broadcastGame({ type: 'SS_PLAYER_UPDATE', players: this.sseukGame.players }, 'sseuk-sseuk');
  }

  _sseukTimeLeftMs() {
    const r = this.sseukGame?.currentRound;
    if (!r || !r.startedAt) return 0;
    if (this.sseukGame.phase === 'bonus' && r.firstCorrectAt) {
      return Math.max(0, SS_BONUS_AFTER_FIRST_MS - (Date.now() - r.firstCorrectAt));
    }
    if (this.sseukGame.phase === 'drawing') {
      const dur = r.roundDurationMs || SS_ROUND_DURATION_DEFAULT_MS;
      return Math.max(0, dur - (Date.now() - r.startedAt));
    }
    return 0;
  }

  async _handleSseukSelectCharacter(player, msg) {
    if (!this.sseukGame) return;
    if (this.sseukGame.phase !== 'waiting') return;
    const characterId = SS_VALID_CHARS.includes(msg.characterId) ? msg.characterId : 'mochi-rabbit';
    const p = this.sseukGame.players.find(x => x.id === player.id);
    if (!p) return;
    p.characterId = characterId;
    this._broadcastGame({ type: 'SS_PLAYER_UPDATE', players: this.sseukGame.players }, 'sseuk-sseuk');
  }

  async _handleSseukReady(player, msg) {
    if (!this.sseukGame || this.sseukGame.phase !== 'waiting') return;
    const p = this.sseukGame.players.find(x => x.id === player.id);
    if (!p) return;
    p.ready = msg.ready !== false;
    this._broadcastGame({ type: 'SS_PLAYER_UPDATE', players: this.sseukGame.players }, 'sseuk-sseuk');

    const connected = this.sseukGame.players.filter(p => p.connected);
    const allReady = connected.length >= 2 && connected.every(p => p.ready);
    if (allReady) await this._startSseukCountdown();
  }

  async _startSseukCountdown() {
    if (!this.sseukGame) return;
    this.sseukGame.phase = 'countdown';
    for (const seconds of [3, 2, 1]) {
      if (!this.sseukGame) return;
      this._broadcastGame({ type: 'SS_COUNTDOWN', seconds }, 'sseuk-sseuk');
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!this.sseukGame) return;
    this._startSseukRound();
  }

  _startSseukRound() {
    if (!this.sseukGame) return;
    // Reset per-round mutable state.
    this.sseukGame.phase = 'volunteering';
    const deadlineAt = Date.now() + SS_VOLUNTEER_TIMEOUT_MS;
    const difficulty = SS_DIFFICULTY_BY_ROUND[this.sseukGame.currentRoundIdx] || 'medium';
    const roundDurationMs = SS_DURATION_BY_DIFFICULTY[difficulty] || SS_ROUND_DURATION_DEFAULT_MS;
    this.sseukGame.currentRound = {
      drawerId: null,
      keyword: null,
      syllableCount: 0,
      startedAt: null,
      volunteers: [],
      volunteersDeadlineAt: deadlineAt,
      firstCorrectAt: null,
      correctOrder: [],
      strokes: [],
      difficulty,
      roundDurationMs,
    };
    this._broadcastGame({
      type: 'SS_VOLUNTEER_OPEN',
      roundIdx: this.sseukGame.currentRoundIdx,
      totalRounds: this.sseukGame.totalRounds,
      difficulty,
      deadlineAt,
    }, 'sseuk-sseuk');

    const token = ++this.sseukGame.tokens.volunteer;
    this.sseukGame.timers.volunteer = setTimeout(() => {
      if (!this.sseukGame || this.sseukGame.tokens.volunteer !== token) return;
      this._resolveDrawer().catch(() => {});
    }, SS_VOLUNTEER_TIMEOUT_MS);
  }

  async _handleSseukVolunteer(player, _msg) {
    if (!this.sseukGame || this.sseukGame.phase !== 'volunteering') return;
    const r = this.sseukGame.currentRound;
    if (!r) return;
    if (!r.volunteers.includes(player.id)) {
      r.volunteers.push(player.id);
      this._ssStat(player.id).volunteers += 1;
    }
    this._broadcastGame({
      type: 'SS_VOLUNTEER_UPDATE',
      volunteers: r.volunteers,
    }, 'sseuk-sseuk');

    // 연결된 전원이 손들었으면 8초 안 기다리고 즉시 추첨.
    const connected = this.sseukGame.players.filter(p => p.connected);
    if (connected.length > 0 && connected.every(p => r.volunteers.includes(p.id))) {
      this._resolveDrawer().catch(() => {});
    }
  }

  async _resolveDrawer() {
    if (!this.sseukGame) return;
    // Idempotent 가드 (Codex MAJOR #1): 마지막 지원자와 volunteer timeout이 같은 tick에
    // 도달할 경우 _resolveDrawer가 중복 실행되어 drawer/keyword가 다시 뽑히고
    // SS_DRAWER_SELECTED가 두 번 송신되는 race를 봉쇄.
    if (this.sseukGame.phase !== 'volunteering') return;
    if (this.sseukGame.currentRound?.drawerId) return;
    if (this.sseukGame.timers.volunteer) { clearTimeout(this.sseukGame.timers.volunteer); this.sseukGame.timers.volunteer = null; }
    this.sseukGame.phase = 'lottery';     // 전환 잠금 (이후 _handleSseukVolunteer가 다시 트리거하지 않음)
    const r = this.sseukGame.currentRound;
    if (!r) return;

    const connected = this.sseukGame.players.filter(p => p.connected);
    if (connected.length < 2) {
      // 보호망: 누군가 빠져 인원이 부족하면 라운드를 비우고 다음으로.
      this._endSseukRound('insufficient-players');
      return;
    }

    let drawerId = null;
    const eligibleVolunteers = r.volunteers.filter(id => connected.some(p => p.id === id));
    if (eligibleVolunteers.length === 1) {
      drawerId = eligibleVolunteers[0];
    } else if (eligibleVolunteers.length >= 2) {
      drawerId = eligibleVolunteers[Math.floor(Math.random() * eligibleVolunteers.length)];
    } else {
      // 0명: drawerHistory 기반 "안 그린 사람 우선" 가중. 미경험자가 있으면 그 안에서 균등 랜덤.
      const drawCounts = new Map(connected.map(p => [p.id, 0]));
      for (const id of this.sseukGame.drawerHistory) {
        if (drawCounts.has(id)) drawCounts.set(id, drawCounts.get(id) + 1);
      }
      const minCount = Math.min(...drawCounts.values());
      const candidates = connected.filter(p => drawCounts.get(p.id) === minCount);
      drawerId = candidates[Math.floor(Math.random() * candidates.length)].id;
    }

    const keyword = this._pickSseukKeyword(r.difficulty);
    r.drawerId = drawerId;
    r.keyword = keyword;
    r.syllableCount = [...keyword].length; // 음절 단위 (Hangul은 코드포인트 1=1음절)
    this.sseukGame.drawerHistory.push(drawerId);

    // 추첨 연출 + 출제자/일반에게 분리 송신.
    // syllableCount는 출제자만 받음 (Codex MAJOR #4: 20s 글자수 힌트가 의미를 가지도록 노출 지연).
    const animPayloadBase = {
      type: 'SS_DRAWER_SELECTED',
      drawerId,
      difficulty: r.difficulty,
      lotteryMs: SS_LOTTERY_ANIM_MS,
      candidates: eligibleVolunteers.length >= 2 ? eligibleVolunteers : null,
    };
    for (const { ws, player } of this._getSessions()) {
      if (player.gameId !== 'sseuk-sseuk') continue;
      const payload = player.id === drawerId
        ? { ...animPayloadBase, keyword, syllableCount: r.syllableCount }
        : { ...animPayloadBase, syllableCount: null };
      try { ws.send(JSON.stringify(payload)); } catch {}
    }

    // 추첨 연출 후 그리기 단계로.
    const token = ++this.sseukGame.tokens.round;
    this.sseukGame.timers.round = setTimeout(() => {
      if (!this.sseukGame || this.sseukGame.tokens.round !== token) return;
      this._startSseukDrawing();
    }, SS_LOTTERY_ANIM_MS);
  }

  _pickSseukKeyword(difficulty) {
    const used = new Set(this.sseukGame.usedKeywords || []);
    // 난이도 풀에서 우선 뽑되, 모두 소진된 경우(또는 difficulty 누락) 전체 풀로 폴백.
    const tierPool = SS_KEYWORDS_BY_DIFFICULTY[difficulty] || SS_KEYWORD_POOL;
    const tierRemaining = tierPool.filter(w => !used.has(w));
    let pool;
    if (tierRemaining.length > 0) {
      pool = tierRemaining;
    } else {
      const anyRemaining = SS_KEYWORD_POOL.filter(w => !used.has(w));
      pool = anyRemaining.length > 0 ? anyRemaining : SS_KEYWORD_POOL;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.sseukGame.usedKeywords.push(pick);
    return pick;
  }

  // ── Phase B: 스트로크 동기화 ────────────────────────────────

  _handleSseukStrokeAdd(player, msg) {
    if (!this.sseukGame) return;
    // Codex MAJOR #3: bonus phase에서도 출제자가 그릴 수 있어야 (클라가 허용 중).
    if (this.sseukGame.phase !== 'drawing' && this.sseukGame.phase !== 'bonus') return;
    const r = this.sseukGame.currentRound;
    if (!r || r.drawerId !== player.id) return;       // 출제자만 그릴 수 있다.
    if (!Array.isArray(msg.points)) return;
    if (r.strokes.length >= SS_STROKES_PER_ROUND_CAP) return; // 무시 (cap).

    // Codex MINOR #7: 포인트 단위로 형태/숫자/범위 검증. malformed payload는 폐기.
    const validPoints = [];
    const cap = Math.min(msg.points.length, SS_STROKE_POINTS_CAP);
    for (let i = 0; i < cap; i++) {
      const p = msg.points[i];
      if (!Array.isArray(p) || p.length !== 2) continue;
      const x = Number(p[0]), y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || x > 1000 || y < 0 || y > 1000) continue;
      validPoints.push([Math.round(x), Math.round(y)]);
    }
    if (validPoints.length === 0) return;

    const stroke = {
      points: validPoints,
      color: typeof msg.color === 'string' ? msg.color.slice(0, 16) : '#000',
      thickness: typeof msg.thickness === 'number' ? Math.max(1, Math.min(64, msg.thickness)) : 4,
      order: r.strokes.length,
    };
    r.strokes.push(stroke);
    // 출제자 본인은 로컬에 이미 그려진 상태 — 다른 참가자에게만 보낸다.
    for (const { ws, player: p } of this._getSessions()) {
      if (p.gameId !== 'sseuk-sseuk') continue;
      if (p.id === r.drawerId) continue;
      try { ws.send(JSON.stringify({ type: 'SS_STROKE_APPLIED', kind: 'add', stroke })); } catch {}
    }
  }

  _handleSseukCanvasClear(player, _msg) {
    if (!this.sseukGame) return;
    if (this.sseukGame.phase !== 'drawing' && this.sseukGame.phase !== 'bonus') return;
    const r = this.sseukGame.currentRound;
    if (!r || r.drawerId !== player.id) return;
    r.strokes = [];
    this._broadcastGame({ type: 'SS_STROKE_APPLIED', kind: 'clear' }, 'sseuk-sseuk');
  }

  _handleSseukStrokeUndo(player, _msg) {
    if (!this.sseukGame) return;
    if (this.sseukGame.phase !== 'drawing' && this.sseukGame.phase !== 'bonus') return;
    const r = this.sseukGame.currentRound;
    if (!r || r.drawerId !== player.id) return;
    if (r.strokes.length === 0) return;
    r.strokes.pop();
    this._broadcastGame({ type: 'SS_STROKE_APPLIED', kind: 'undo' }, 'sseuk-sseuk');
  }

  // ── Phase C: 시간 경과 힌트 ────────────────────────────────

  _scheduleSseukHints(capturedRoundToken) {
    if (!this.sseukGame) return;
    const r = this.sseukGame.currentRound;
    if (!r) return;
    this.sseukGame.tokens.hint++;
    const hintToken = this.sseukGame.tokens.hint;
    r.hintRevealed = { length: false, letterIdx: null };

    // 20s: 글자 수 공개.
    const t1 = setTimeout(() => {
      if (!this.sseukGame) return;
      if (this.sseukGame.tokens.round !== capturedRoundToken) return;
      if (this.sseukGame.tokens.hint !== hintToken) return;
      if (this.sseukGame.phase !== 'drawing') return;
      r.hintRevealed.length = true;
      this._broadcastGame({
        type: 'SS_HINT_REVEAL',
        kind: 'length',
        value: r.syllableCount,
      }, 'sseuk-sseuk');
    }, SS_HINT_LENGTH_AT_MS);

    // 40s: 한 글자 공개 (랜덤 위치).
    // 1자 키워드는 letter 힌트가 곧 정답 그대로라서 letter 힌트를 보내지 않는다.
    // 1자 단어는 그림으로만 풀어야 하는 도전이 되도록 한다 (length 힌트로 1자라는
    // 사실만 공개됨).
    const syllableCount = [...r.keyword].length;
    if (syllableCount > 1) {
      const t2 = setTimeout(() => {
        if (!this.sseukGame) return;
        if (this.sseukGame.tokens.round !== capturedRoundToken) return;
        if (this.sseukGame.tokens.hint !== hintToken) return;
        if (this.sseukGame.phase !== 'drawing') return;
        const syllables = [...r.keyword];
        const idx = Math.floor(Math.random() * syllables.length);
        r.hintRevealed.letterIdx = idx;
        this._broadcastGame({
          type: 'SS_HINT_REVEAL',
          kind: 'letter',
          position: idx,
          value: syllables[idx],
        }, 'sseuk-sseuk');
      }, SS_HINT_LETTER_AT_MS);
      this.sseukGame.timers.hint.push(t1, t2);
    } else {
      this.sseukGame.timers.hint.push(t1);
    }
  }

  // ── Phase D: 정답 / 근접 / 채팅 파이프라인 ──────────────────

  _handleSseukGuess(player, msg) {
    if (!this.sseukGame) return;
    const text = (msg.text || '').toString().slice(0, 80).trim();
    if (!text) return;
    const r = this.sseukGame.currentRound;
    const phaseAllowsGuess = (this.sseukGame.phase === 'drawing' || this.sseukGame.phase === 'bonus');

    // 1) 출제자: 자유 발화 (필터 없음). 시각 구분만.
    if (r && r.drawerId === player.id) {
      this._broadcastGame({
        type: 'SS_CHAT',
        playerId: player.id,
        name: player.name,
        text,
        drawer: true,
      }, 'sseuk-sseuk');
      return;
    }

    // 2) 이미 정답을 맞힌 사람: 정답자끼리만 보이는 사이드 채널.
    const alreadyCorrect = r && Array.isArray(r.correctOrder) && r.correctOrder.some(e => e.id === player.id);
    if (alreadyCorrect) {
      const visibleTo = new Set([r.drawerId, ...r.correctOrder.map(e => e.id)]);
      for (const { ws, player: p } of this._getSessions()) {
        if (p.gameId !== 'sseuk-sseuk') continue;
        if (!visibleTo.has(p.id)) continue;
        try {
          ws.send(JSON.stringify({
            type: 'SS_CHAT',
            playerId: player.id,
            name: player.name,
            text,
            sideChannel: true,
          }));
        } catch {}
      }
      return;
    }

    // 3) 정답/근접 판정은 phase가 drawing 또는 bonus 일 때만.
    if (!phaseAllowsGuess || !r || !r.keyword) {
      // 그 외 phase는 일반 채팅으로.
      this._broadcastGame({
        type: 'SS_CHAT', playerId: player.id, name: player.name, text,
      }, 'sseuk-sseuk');
      return;
    }

    const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
    const guess = norm(text);
    const answer = norm(r.keyword);

    this._ssStat(player.id).guesses += 1;   // 칭호(끈기왕) 산정용

    if (guess === answer) {
      this._handleSseukCorrectGuess(player, text);
      return;
    }

    // 정답 누수 봉쇄 (Gemini HIGH): "정답은 사과" 처럼 정답을 그대로 포함한 메시지는
    // 다른 사람에게 보내지 않고 본인에게만 시스템 경고. 추측은 짧은 단어로 충분.
    if (answer && guess.includes(answer)) {
      const myWs = this._findPlayerWs(player.id);
      if (myWs) {
        try {
          myWs.send(JSON.stringify({
            type: 'SS_CHAT',
            system: true,
            text: '정답이 그대로 들어있어서 다른 사람에게 안 보내요!',
          }));
        } catch {}
      }
      return;
    }

    // 자리 일치 근접 — 본인에게만 SS_HINT_FEEDBACK + 시스템 메시지.
    const guessChars = [...guess];
    const answerChars = [...answer];
    const cmpLen = Math.min(guessChars.length, answerChars.length);
    const matchedPositions = [];
    for (let i = 0; i < cmpLen; i++) {
      if (guessChars[i] === answerChars[i]) matchedPositions.push(i);
    }
    // 일반 채팅으로는 전원에게 추측 자체는 보임.
    this._broadcastGame({
      type: 'SS_CHAT', playerId: player.id, name: player.name, text,
    }, 'sseuk-sseuk');
    if (matchedPositions.length > 0) {
      // 본인에게만: 자리 일치 펄스 + 시스템 메시지.
      const targetWs = this._findPlayerWs(player.id);
      if (targetWs) {
        try {
          targetWs.send(JSON.stringify({
            type: 'SS_HINT_FEEDBACK',
            matchCount: matchedPositions.length,
            matchedPositions,
            syllableCount: answerChars.length,
          }));
          const isNear = matchedPositions.length >= answerChars.length - SS_PROXIMITY_NEAR_DIFF;
          targetWs.send(JSON.stringify({
            type: 'SS_CHAT',
            system: true,
            text: isNear ? '거의 다 왔어요!' : `오? ${matchedPositions.length}글자 맞았어요`,
          }));
        } catch {}
      }
    }
  }

  _handleSseukCorrectGuess(player, originalText) {
    const r = this.sseukGame.currentRound;
    if (!r.correctOrder) r.correctOrder = [];
    if (r.correctOrder.some(e => e.id === player.id)) return; // 중복 방지.
    // 라운드 시작부터의 경과 ms 를 함께 저장 — 속도 보너스 / 출제자 tau_first 계산용.
    // 보너스 phase 에서도 startedAt 기준 누적 t 를 쓴다 (Codex 권고:
    // 보너스 10초가 추가 속도 잭팟이 되지 않도록 리셋 X).
    const atMs = r.startedAt ? Math.max(0, Date.now() - r.startedAt) : 0;
    r.correctOrder.push({ id: player.id, atMs });
    const rank = r.correctOrder.length;

    const stat = this._ssStat(player.id);
    stat.correct += 1;
    if (rank === 1) stat.firstCorrect += 1;
    if (stat.bestMs === null || atMs < stat.bestMs) stat.bestMs = atMs;

    // 1) 본인에게는 원문 그대로.
    const myWs = this._findPlayerWs(player.id);
    if (myWs) {
      try {
        myWs.send(JSON.stringify({
          type: 'SS_CHAT',
          playerId: player.id,
          name: player.name,
          text: originalText,
        }));
      } catch {}
    }
    // 2) 타인에게는 마스킹된 시스템 메시지.
    for (const { ws, player: p } of this._getSessions()) {
      if (p.gameId !== 'sseuk-sseuk') continue;
      if (p.id === player.id) continue;
      try {
        ws.send(JSON.stringify({
          type: 'SS_CHAT',
          system: true,
          text: `${player.name}님이 맞혔어요!`,
        }));
      } catch {}
    }
    // 3) 모두에게 SS_CORRECT (점수 미리보기/연출용).
    this._broadcastGame({
      type: 'SS_CORRECT',
      playerId: player.id,
      name: player.name,
      rank,
    }, 'sseuk-sseuk');

    // 첫 정답이면 bonus 타이머 가동 + phase 전환.
    if (rank === 1) {
      r.firstCorrectAt = Date.now();
      this.sseukGame.phase = 'bonus';
      // round 타이머 정리 (남은 시간 대신 bonus 10초로).
      if (this.sseukGame.timers.round) { clearTimeout(this.sseukGame.timers.round); this.sseukGame.timers.round = null; }
      this._broadcastGame({
        type: 'SS_BONUS_START',
        bonusMs: SS_BONUS_AFTER_FIRST_MS,
      }, 'sseuk-sseuk');
      const token = ++this.sseukGame.tokens.bonus;
      this.sseukGame.timers.bonus = setTimeout(() => {
        if (!this.sseukGame || this.sseukGame.tokens.bonus !== token) return;
        this._endSseukRound('bonus-timeout').catch(() => {});
      }, SS_BONUS_AFTER_FIRST_MS);
    }

    // 모든 비-출제자가 맞혔으면 즉시 종료.
    // "현재 connected guessers 가 모두 correctOrder 안에 있으면" 기준으로 변경
    // (Codex 리뷰 HIGH): 맞히고 나간 사람을 카운트로만 비교하면 정작 남은
    // 사람이 못 맞혔는데도 조기 종료될 수 있었음.
    const guessers = this.sseukGame.players.filter(p => p.connected && p.id !== r.drawerId);
    if (guessers.length > 0 && guessers.every(g => r.correctOrder.some(e => e.id === g.id))) {
      this._endSseukRound('all-correct').catch(() => {});
    }
  }

  _findPlayerWs(playerId) {
    for (const { ws, player } of this._getSessions()) {
      if (player.id === playerId) return ws;
    }
    return null;
  }

  _startSseukDrawing() {
    if (!this.sseukGame || !this.sseukGame.currentRound) return;
    this.sseukGame.phase = 'drawing';
    const r = this.sseukGame.currentRound;
    r.startedAt = Date.now();
    // G(정답 가능 인원) 을 라운드 시작 시점에 고정 — 도중에 누가 나가서
    // current connected < correctOrder 가 되면 q=k/G>1, rankPart 음수가 되는
    // 버그를 차단 (Codex 리뷰 HIGH).
    r.guesserBaseline = this.sseukGame.players.filter(p => p.connected && p.id !== r.drawerId).length;
    const roundDurationMs = r.roundDurationMs || SS_ROUND_DURATION_DEFAULT_MS;
    // syllableCount는 출제자에게만 — Codex MAJOR #4 (글자수 힌트 지연).
    const baseStart = {
      type: 'SS_ROUND_START',
      roundIdx: this.sseukGame.currentRoundIdx,
      drawerId: r.drawerId,
      difficulty: r.difficulty,
      timeLeftMs: roundDurationMs,
    };
    for (const { ws, player } of this._getSessions()) {
      if (player.gameId !== 'sseuk-sseuk') continue;
      const payload = player.id === r.drawerId
        ? { ...baseStart, syllableCount: r.syllableCount }
        : { ...baseStart, syllableCount: null };
      try { ws.send(JSON.stringify(payload)); } catch {}
    }

    // Round-end fallback timer (정답 없이 시간 만료).
    const token = ++this.sseukGame.tokens.round;
    this.sseukGame.timers.round = setTimeout(() => {
      if (!this.sseukGame || this.sseukGame.tokens.round !== token) return;
      this._endSseukRound('timeout').catch(() => {});
    }, roundDurationMs);

    // 시간 힌트 (20s, 40s).
    this._scheduleSseukHints(token);
  }

  async _endSseukRound(reason) {
    if (!this.sseukGame) return;
    // 재진입 가드 (Gemini CRITICAL): bonus-timeout / all-correct / drawer-disconnect 가
    // 동일 tick에 겹쳐 들어와도 한 번만 처리되도록. _startSseukRound가 phase를
    // 'volunteering'으로 재설정하므로 다음 라운드는 정상 진행.
    if (this.sseukGame.phase === 'ending') return;
    this.sseukGame.phase = 'ending';
    // 4개 token 패밀리 + 4개 타이머 일괄 정리 (Gemini MEDIUM: volunteer 누락 보정).
    this._clearSseukTimers();

    const r = this.sseukGame.currentRound;
    const perPlayerDelta = {};
    const perPlayerBreakdown = {};   // { [pid]: { rank?, speed?, base?, qBonus?, total } }
    // 옵션 B (Codex) 공식 — "잘 그린 판만, 빨리 맞힌 사람만" 보상.
    //   G = 정답 가능 인원 (출제자 제외 connected). 출제자 단독 / 무인 시 0.
    //   T = 라운드 총 시간 (난이도별). tau(t) = clamp(1 - t/T, 0, 1).
    //   정답자 (rank r=0 부터, G>=2):
    //     S_guess = Mg * (30(기본) + 40*(G-1-r)/(G-1) (등수) + 30*tau (속도))
    //   G=1 폴백 (2인 게임 — 정답자 1명뿐이라 등수 무의미):
    //     S_guess = Mg * (70 + 30*tau)
    //   출제자:
    //     S_draw = Md * avg(S_correct) * q^1.4 * (0.6 + 0.4*tau_first)
    //     where q = correctCount / G (정답률), tau_first = 1등 정답자 tau.
    //   HARD 분리: Mg=1.15, Md=1.0 (출제자는 이미 q·tau_first 로 평가받음).
    //   보너스 phase 에서도 t 는 startedAt 기준 누적 — 보너스 10초가 추가 속도
    //   잭팟이 되지 않도록 (Codex 권고).
    const Mg = SS_GUESSER_MULTIPLIER_BY_DIFFICULTY[r?.difficulty] || 1.0;
    const Md = SS_DRAWER_MULTIPLIER_BY_DIFFICULTY[r?.difficulty] || 1.0;
    const T  = r?.roundDurationMs || SS_ROUND_DURATION_DEFAULT_MS;
    const correctOrder = r?.correctOrder || [];
    const k = correctOrder.length;
    // G 는 라운드 시작 시점 baseline 우선 — 도중에 누가 나가도 q=k/G 가 1을
    // 넘지 않게 하기 위해 (Codex 리뷰 HIGH). baseline 이 비어 있으면 (구버전
    // 스냅샷 복원 등) k 또는 현재 connected 중 큰 값으로 안전 fallback.
    const liveGuesserCount = this.sseukGame.players
      .filter(p => p.connected && p.id !== r?.drawerId).length;
    const G = Math.max(r?.guesserBaseline || 0, k, liveGuesserCount);

    const guesserScoresRaw = [];   // float 유지 — 출제자 avg 계산 정확도 (MEDIUM).
    correctOrder.forEach((entry, i) => {
      const tau = Math.max(0, Math.min(1, 1 - (entry.atMs || 0) / T));
      let rankPart = 0;
      let base = 30;
      if (G >= 2) {
        rankPart = 40 * (G - 1 - i) / (G - 1);
      } else {
        // G=1 폴백 — 등수 분배가 무의미. 기본 70 + 속도 30.
        base = 70;
        rankPart = 0;
      }
      const speedPart = 30 * tau;
      // 명세대로 Mg 는 합쳐진 raw 에 한 번만 곱한다 (중간 round 후 곱하면
      // HARD 에서 1점 드리프트 — Codex MEDIUM).
      const rawFloat = (base + rankPart + speedPart) * Mg;
      const total = Math.round(rawFloat);
      guesserScoresRaw.push(rawFloat);
      perPlayerDelta[entry.id] = total;
      perPlayerBreakdown[entry.id] = {
        role: 'guesser',
        base,
        rank: Math.round(rankPart),
        speed: Math.round(speedPart),
        multiplier: Mg,
        total,
      };
      const target = this.sseukGame.players.find(p => p.id === entry.id);
      if (target) target.score += total;
    });

    if (r?.drawerId && k > 0 && G > 0) {
      const avg = guesserScoresRaw.reduce((a, b) => a + b, 0) / k;
      const q = k / G;
      const tauFirst = Math.max(0, Math.min(1, 1 - (correctOrder[0].atMs || 0) / T));
      const drawerRaw = Md * avg * Math.pow(q, 1.4) * (0.6 + 0.4 * tauFirst);
      const drawerTotal = Math.round(drawerRaw);
      perPlayerDelta[r.drawerId] = (perPlayerDelta[r.drawerId] || 0) + drawerTotal;
      perPlayerBreakdown[r.drawerId] = {
        role: 'drawer',
        avgGuesser: Math.round(avg),
        correctRate: Math.round(q * 100),   // % 표시용
        firstSpeed: Math.round(tauFirst * 100),
        multiplier: Md,
        total: drawerTotal,
      };
      const drawer = this.sseukGame.players.find(p => p.id === r.drawerId);
      if (drawer) drawer.score += drawerTotal;
      const drawerStat = this._ssStat(r.drawerId);
      drawerStat.drawerRounds += 1;
      drawerStat.drawerRateSum += q;
    } else if (r?.drawerId) {
      // 정답 0명 — 출제자 점수 0 (분해 정보는 보내서 UI 에 0 표기).
      perPlayerBreakdown[r.drawerId] = {
        role: 'drawer',
        avgGuesser: 0,
        correctRate: 0,
        firstSpeed: 0,
        multiplier: Md,
        total: 0,
      };
      this._ssStat(r.drawerId).drawerRounds += 1;
    }

    this._broadcastGame({
      type: 'SS_ROUND_END',
      reason,
      keyword: r?.keyword || null,
      drawerId: r?.drawerId || null,
      difficulty: r?.difficulty || null,
      guesserMultiplier: Mg,
      drawerMultiplier: Md,
      // 하위호환: 옛 multiplier 키도 (정답자 기준값) 함께 송신.
      multiplier: Mg,
      correctOrder: correctOrder.map(e => e.id),
      perPlayerDelta,
      perPlayerBreakdown,
      scores: Object.fromEntries(this.sseukGame.players.map(p => [p.id, p.score])),
    }, 'sseuk-sseuk');

    // 다음 라운드 또는 게임 종료. disconnect/insufficient-players 사유는
    // 사용자가 메시지를 읽을 시간을 더 주기 위해 길게.
    // 일반 종료는 1.5s 리플레이 + 1s 완성 그림 hold = 2500ms.
    const pauseMs = (reason === 'drawer-disconnect' || reason === 'insufficient-players') ? 2500 : 2500;
    this.sseukGame.currentRoundIdx += 1;
    if (this.sseukGame.currentRoundIdx >= this.sseukGame.totalRounds) {
      await new Promise(rs => setTimeout(rs, pauseMs));
      if (!this.sseukGame) return;
      await this._finishSseukGame();
      return;
    }
    await new Promise(rs => setTimeout(rs, pauseMs));
    if (!this.sseukGame) return;
    this._startSseukRound();
  }

  // 게임 종료 칭호 — 전원이 하나씩 받는다 (꼴찌 포함). 카테고리는 우선순위
  // 순서로 "가장 두드러진" 사람에게 1개씩 배정하고, 남은 사람은 폴백 칭호.
  _computeSseukAwards(rankings) {
    const stats = this.sseukGame.stats || {};
    const emptyStat = { firstCorrect: 0, correct: 0, bestMs: null, guesses: 0, volunteers: 0, drawerRounds: 0, drawerRateSum: 0 };
    const get = (id) => stats[id] || emptyStat;
    const awarded = new Set();
    const awards = {};

    // score(stat) 최대인 미수상자 선택. min 미만이면 해당 카테고리 유찰.
    const pickTop = (score, min = 1) => {
      let bestId = null;
      let best = -Infinity;
      for (const p of rankings) {
        if (awarded.has(p.id)) continue;
        const v = score(get(p.id));
        if (v >= min && v > best) { best = v; bestId = p.id; }
      }
      return bestId;
    };

    const categories = [
      { emoji: '⚡', title: '번개 정답왕', desc: '1등 정답이 가장 많았어요', pick: () => pickTop(s => s.firstCorrect) },
      { emoji: '🎨', title: '금손 화가', desc: '그림을 그리면 다들 척척 맞혔어요', pick: () => pickTop(s => (s.drawerRounds > 0 ? s.drawerRateSum / s.drawerRounds : 0), 0.5) },
      { emoji: '🎯', title: '척척 명탐정', desc: '정답을 가장 많이 맞혔어요', pick: () => pickTop(s => s.correct) },
      { emoji: '🚀', title: '초스피드', desc: '가장 빠른 정답을 기록했어요', pick: () => pickTop(s => (s.bestMs === null ? -1 : 1_000_000 - s.bestMs), 1) },
      { emoji: '🙋', title: '용감한 도전자', desc: '먼저 그리겠다고 가장 많이 손들었어요', pick: () => pickTop(s => s.volunteers, 2) },
      { emoji: '🔥', title: '끈기왕', desc: '포기하지 않고 가장 많이 도전했어요', pick: () => pickTop(s => s.guesses, 3) },
    ];
    for (const c of categories) {
      if (awarded.size >= rankings.length) break;
      const id = c.pick();
      if (id) {
        awarded.add(id);
        awards[id] = { emoji: c.emoji, title: c.title, desc: c.desc };
      }
    }

    const fallbacks = [
      { emoji: '🌟', title: '오늘의 주인공', desc: '다음 판 우승 예감!' },
      { emoji: '💪', title: '열정 플레이어', desc: '끝까지 함께해줘서 고마워요' },
      { emoji: '🍀', title: '행운의 친구', desc: '다음 판엔 행운이 찾아올 거예요' },
      { emoji: '🌈', title: '분위기 메이커', desc: '함께라서 더 즐거웠어요' },
      { emoji: '🧸', title: '말랑 지킴이', desc: '오늘도 즐겁게 놀아줘서 고마워요' },
    ];
    let fi = 0;
    for (const p of rankings) {
      if (!awards[p.id]) {
        awards[p.id] = fallbacks[fi % fallbacks.length];
        fi += 1;
      }
    }
    return awards;
  }

  async _finishSseukGame() {
    if (!this.sseukGame) return;
    this.sseukGame.phase = 'finished';
    const rankings = [...this.sseukGame.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, characterId: p.characterId, colorIndex: p.colorIndex, score: p.score }));
    const awards = this._computeSseukAwards(rankings);
    this._broadcastGame({ type: 'SS_GAME_END', rankings, awards }, 'sseuk-sseuk');
    this._submitScoresToLeaderboard('sseuk-sseuk', rankings.map(r => ({ id: r.id, name: r.name, score: r.score, characterId: r.characterId })));
    const scores = {};
    this.sseukGame.players.forEach(p => { scores[p.id] = { name: p.name, score: p.score, colorIndex: p.colorIndex }; });
    await this.state.storage.put('scores', scores);
    await this.state.storage.put('phase', 'results');
  }

  _handlePlayerInput(player, msg) {
    if (!this.jumpGame || player.role !== 'game' || player.gameId !== 'jump-climber') return;
    if (player.isSpectator) return;
    const target = this.jumpGame.players[player.id];
    if (!target) return;
    target.inputDirection = clamp(Number(msg.direction) || 0, -1, 1);
  }

  _handleJumpPlayerState(player, msg) {
    if (!this.jumpGame || player.role !== 'game' || player.gameId !== 'jump-climber') return;
    if (player.isSpectator) return;
    const target = this.jumpGame.players[player.id];
    if (!target) return;

    target.inputDirection = clamp(Number(msg.direction) || 0, -1, 1);
    target.connected = true;

    const now = Date.now();
    const elapsedMs = target.lastStateAtMs
      ? clamp(now - target.lastStateAtMs, JUMP_PATCH_RATES.playerMs, 1000)
      : JUMP_PATCH_RATES.playerMs;
    target.lastStateAtMs = now;
    const frameBudget = Math.max(1, elapsedMs / JUMP_BASE_STEP_MS);
    const maxXDelta = 24 + JUMP_GAME_SETTINGS.moveSpeed * 2.5 * frameBudget;
    const maxYDelta = 180 + 70 * frameBudget;
    const width = Number.isFinite(msg.width) ? clamp(Number(msg.width), 20, 80) : target.width;
    const height = Number.isFinite(msg.height) ? clamp(Number(msg.height), 20, 80) : target.height;
    const x = Number(msg.x);
    const y = Number(msg.y);
    const vx = Number(msg.vx);
    const vy = Number(msg.vy);

    if (Number.isFinite(x)) {
      const nextX = clamp(x, 0, JUMP_GAME_SETTINGS.worldWidth - width);
      target.x = Number.isFinite(target.x)
        ? clamp(nextX, target.x - maxXDelta, target.x + maxXDelta)
        : nextX;
    }
    if (Number.isFinite(y)) {
      const nextY = clamp(y, -100000, JUMP_GAME_SETTINGS.startLineY + JUMP_GAME_SETTINGS.arenaHeight + 400);
      target.y = Number.isFinite(target.y)
        ? clamp(nextY, target.y - maxYDelta, target.y + maxYDelta)
        : nextY;
    }
    if (Number.isFinite(vx)) target.vx = clamp(vx, -40, 40);
    if (Number.isFinite(vy)) target.vy = clamp(vy, -80, 80);
    target.width = width;
    target.height = height;

    const claimedBest = Number(msg.bestHeight);
    const heightFromY = Math.max(0, Math.round((JUMP_GAME_SETTINGS.startLineY - target.y) / 10));
    const safeClaimedBest = Number.isFinite(claimedBest)
      ? Math.min(clamp(claimedBest, 0, 100000), heightFromY + 20)
      : 0;
    target.bestHeight = Math.max(
      target.bestHeight || 0,
      heightFromY,
      safeClaimedBest
    );

    if (target.alive && msg.alive === false) {
      target.alive = false;
      target.vx = 0;
      target.vy = 0;
    }

    if (target.alive) {
      const jumpCount = Number(msg.jumpCount);
      if (Number.isFinite(jumpCount)) target.jumpCount = clamp(Math.round(jumpCount), 0, 100000);
    }

    const bounceTag = Number(msg.bounceTag);
    if (Number.isFinite(bounceTag)) target.bounceTag = Math.round(bounceTag) & 0xff;
    if (['normal', 'super', 'boost'].includes(msg.lastBounceKind)) {
      target.lastBounceKind = msg.lastBounceKind;
    }

    if (Array.isArray(msg.pickedBoostIds) && msg.pickedBoostIds.length > 0) {
      const picked = new Set(msg.pickedBoostIds.slice(0, 8).filter((id) => typeof id === 'string'));
      // Codex 리뷰 반영: expectedPlayers 고정값 대신 "현재 alive 한 slot 들이
      // 모두 먹었는가" 로 판정. 한 명 죽고 한 명만 남았을 때 그 한 명이
      // 먹으면 즉시 삭제되도록 — 안 그러면 죽은 사람 몫이 영원히 떠 있음.
      const aliveSlots = [];
      for (const p of Object.values(this.jumpGame.players)) {
        if (p?.alive) aliveSlots.push(p.slot);
      }
      // 모두 죽거나 시작 전이면 fall back: expectedPlayers 슬롯 전체.
      const requiredSlots = aliveSlots.length > 0
        ? aliveSlots
        : Array.from({ length: Math.max(1, this.jumpGame.expectedPlayers || 1) }, (_, i) => i);

      let mutated = false;
      const remaining = [];
      for (const boost of this.jumpGame.boosts) {
        if (!picked.has(boost.id)) { remaining.push(boost); continue; }
        if (!Array.isArray(boost.pickedBySlots)) boost.pickedBySlots = [];
        if (!boost.pickedBySlots.includes(target.slot)) {
          boost.pickedBySlots.push(target.slot);
          mutated = true;
        }
        const allRequiredPicked = requiredSlots.every((s) => boost.pickedBySlots.includes(s));
        if (allRequiredPicked) {
          mutated = true;
          continue;
        }
        remaining.push(boost);
      }
      if (mutated) {
        this.jumpGame.boosts = remaining;
        this.jumpGame.worldDirty = true;
      }
    }

    const cameraY = Number(msg.cameraY);
    if (Number.isFinite(cameraY)) {
      this.jumpGame.cameraY = Math.min(this.jumpGame.cameraY, clamp(cameraY, -100000, JUMP_GAME_SETTINGS.startLineY));
    } else if (Number.isFinite(target.y)) {
      this.jumpGame.cameraY = Math.min(this.jumpGame.cameraY, target.y - 320);
    }
  }

  // ── 점프 2P 상호작용: 먹구름 공격 + 응원 (서버는 검증·레이트리밋 후 릴레이만) ──

  _handleJumpAttack(player) {
    if (!this.jumpGame || !this.jumpGame.running) return;
    if (player.role !== 'game' || player.gameId !== 'jump-climber' || player.isSpectator) return;
    const me = this.jumpGame.players[player.id];
    if (!me || !me.alive) return;
    const now = Date.now();
    if (me.lastAttackAtMs && now - me.lastAttackAtMs < 1500) return;
    me.lastAttackAtMs = now;

    const text = JSON.stringify({ type: 'jump_attack', kind: 'storm', fromSlot: me.slot, fromName: me.name });
    for (const { ws, player: target } of this._getJumpSessions({ spectators: false })) {
      if (target.id === player.id) continue;
      try { ws.send(text); } catch { /* ignore closed */ }
    }
  }

  _handleJumpCheer(player) {
    if (!this.jumpGame || !this.jumpGame.running) return;
    if (player.role !== 'game' || player.gameId !== 'jump-climber') return;
    const me = this.jumpGame.players[player.id];
    const isDeadPlayer = Boolean(me && !me.alive);
    if (!player.isSpectator && !isDeadPlayer) return; // 생존자 본인은 응원 불가

    const now = Date.now();
    if (!this.jumpCheerLastAtMs) this.jumpCheerLastAtMs = new Map();
    const last = this.jumpCheerLastAtMs.get(player.id) || 0;
    if (now - last < 300) return;
    this.jumpCheerLastAtMs.set(player.id, now);

    this.jumpGame.cheerCount = (this.jumpGame.cheerCount || 0) + 1;
    this._broadcastGame(
      { type: 'jump_cheer', count: this.jumpGame.cheerCount, fromName: player.name },
      'jump-climber'
    );
  }

  /* 이 DO 를 "새 방"으로 되돌린다 — 저장된 것도, in-memory 도 전부.
   * 4자리 코드는 재사용되므로(POST /api/rooms) 이 초기화가 방과 방 사이의 유일한 경계다. */
  async _resetRoomState() {
    this._stopJumpLoop();
    this.jumpGame = null;
    this.sseukGame = null;
    this.moduleGames.clear();
    this.relayRates = new Map();
    // storage 전체 삭제 — 모듈 상태('mod:*': 판·좌석 토큰)와 로비 상태(phase/currentGame/
    // gameRoster/scores/chatLog)가 모두 이전 방의 것이다.
    await this.state.storage.deleteAll();
  }

  // ── fetch ──────────────────────────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/init') {
      const { code } = await request.json();
      // 충돌 검사: 이 코드의 DO 가 이미 라이브 연결을 가진 활성 방이면 409 로 신호 →
      // worker 가 다른 코드로 재시도한다. 빈(종료된) 방은 재사용 가능.
      if (this.state.getWebSockets().length > 0) {
        return new Response(JSON.stringify({ occupied: true }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // 재사용된 코드다 — 이전 방의 잔여 상태를 반드시 비운다. 안 비우면 새 손님이 남의 판을
      // 물려받고(진행 중이던 게임 상태 복원), 이전 방의 좌석 토큰 보유자가 그 자리로 돌아온다.
      await this._resetRoomState();
      await this.state.storage.put('code', code);
      return new Response('OK');
    }

    /* /world-launch — internal endpoint called by WorldChannel after a match
     * is confirmed. Seeds the room with currentGame/gameRoster/phase=playing
     * directly so players can hit the game URL and join immediately, with no
     * lobby vote/countdown step.
     *
     * NOT exposed via the worker's public router. WorldChannel reaches us via
     * env.GAME_ROOM.get(id).fetch(internalRequest).
     */
    if (request.method === 'POST' && url.pathname === '/world-launch') {
      const body = await request.json().catch(() => null);
      const ok = body && typeof body.gameId === 'string' && Array.isArray(body.players) && body.players.length > 0;
      if (!ok) return new Response('Invalid body', { status: 400 });
      if (!GAME_PATHS[body.gameId]) {
        return new Response(`Unknown gameId: ${body.gameId}`, { status: 400 });
      }
      await this._seedFromWorld(body);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket event handlers ────────────────────────────────────────────────

  async webSocketMessage(ws, rawMsg) {
    // 과도하게 큰 프레임은 parse 전에 차단 (DO isolate 보호 — 내장 게임 메시지는 충분히 작음).
    if (typeof rawMsg === 'string' && rawMsg.length > RELAY_MAX_FRAME_CHARS) return;
    let msg;
    try { msg = JSON.parse(rawMsg); } catch { return; }

    const player = ws.deserializeAttachment();

    switch (msg.type) {
      case 'join':      await this._handleJoin(ws, msg);                        break;
      case 'join_game': await this._handleJoinGame(ws, msg);                    break;
      case 'chat':      if (player) await this._handleChat(player, msg);        break;
      case 'vote_game':     if (player) await this._handleVoteGame(ws, player, msg);      break;
      case 'vote_start':    if (player) await this._handleVoteStart(ws, player, msg);     break;
      case 'player_input':  if (player) this._handlePlayerInput(player, msg);             break;
      case 'player_state':  if (player) this._handleJumpPlayerState(player, msg);          break;
      case 'jump_attack':   if (player) this._handleJumpAttack(player);                    break;
      case 'jump_cheer':    if (player) this._handleJumpCheer(player);                     break;
      // ── 쓱쓱 ──
      case 'SS_SELECT_CHARACTER':
        if (player?.gameId === 'sseuk-sseuk') await this._handleSseukSelectCharacter(player, msg);
        break;
      case 'SS_READY':
        if (player?.gameId === 'sseuk-sseuk') await this._handleSseukReady(player, msg);
        break;
      case 'SS_VOLUNTEER':
        if (player?.gameId === 'sseuk-sseuk') await this._handleSseukVolunteer(player, msg);
        break;
      case 'SS_STROKE_ADD':
        if (player?.gameId === 'sseuk-sseuk') this._handleSseukStrokeAdd(player, msg);
        break;
      case 'SS_CANVAS_CLEAR':
        if (player?.gameId === 'sseuk-sseuk') this._handleSseukCanvasClear(player, msg);
        break;
      case 'SS_STROKE_UNDO':
        if (player?.gameId === 'sseuk-sseuk') this._handleSseukStrokeUndo(player, msg);
        break;
      case 'SS_GUESS':
        if (player?.gameId === 'sseuk-sseuk') this._handleSseukGuess(player, msg);
        break;
      case 'relay':         if (player) this._handleRelayMessage(ws, player, msg);         break;
      case 'mod':           if (player?.mode === 'module') await this._handleModuleMessage(ws, player, msg); break;
      // submit_result 는 로비/내장 게임 세션만 허용. relay/module 세션(mode 보유)은
      // 자체 결과 경로를 쓰므로 차단 — 점수/결과 위조 방지.
      case 'submit_result': if (player && !player.mode) await this._handleSubmitResult(player, msg); break;
      case 'rematch':       if (player) await this._handleRematch();                       break;
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          pingId: Number.isFinite(msg.pingId) ? msg.pingId : null,
          clientTimeMs: Number.isFinite(msg.clientTimeMs) ? msg.clientTimeMs : null,
          elapsedMs: this.jumpGame ? this.jumpGame.elapsedMs : null,
        }));
        break;
    }
  }

  async webSocketClose(ws) { await this._removePlayer(ws); }
  async webSocketError(ws) { await this._removePlayer(ws); }

  // ── Message handlers ────────────────────────────────────────────────────────

  async _handleJoin(ws, msg) {
    const name = (msg.name || '플레이어').slice(0, 32);
    const requestedId = typeof msg.playerId === 'string' && msg.playerId ? msg.playerId : null;

    // 동일 playerId의 lobby 세션이 살아있으면 (페이지 nav 후 옛 ws가 아직 정리 안 된 상태),
    // 옛 ws는 닫고 그 세션의 식별 정보(id/color/votes)를 새 ws로 인계 → 자기 자신 복제 방지.
    let inherited = null;
    if (requestedId) {
      for (const session of this._getLobbySessions()) {
        if (session.player.id === requestedId && session.ws !== ws) {
          inherited = session.player;
          try { session.ws.close(4001, 'replaced'); } catch { /* ignore */ }
          session.ws.serializeAttachment(null);
          break;
        }
      }
    }

    let playerData;
    if (inherited) {
      playerData = { ...inherited, name, role: 'lobby' };
    } else {
      let colorIndex = (await this.state.storage.get('colorIndex')) || 0;
      const color = COLORS[colorIndex % COLORS.length];
      await this.state.storage.put('colorIndex', colorIndex + 1);
      playerData = { id: randomHex(6), name, color, colorIndex, gameVote: null, startVote: false, role: 'lobby' };
    }
    ws.serializeAttachment(playerData);

    const sessions  = this._getLobbySessions();
    const players   = sessions.map(s => s.player);
    const chatLog   = (await this.state.storage.get('chatLog')) || [];
    const code      = (await this.state.storage.get('code')) || '';
    const phase     = (await this.state.storage.get('phase')) || 'lobby';
    const gameVotes = this._buildGameVotes(sessions);
    const currentGame = (await this.state.storage.get('currentGame')) || null;
    const scores = (await this.state.storage.get('scores')) || {};
    const results = phase === 'results' ? this._buildRankedScores(scores) : null;

    ws.send(JSON.stringify({ type: 'welcome', playerId: playerData.id, code, players, chatLog, gameVotes, phase, currentGame, results }));
    this._broadcastExcept({ type: 'player_joined', player: playerData }, ws);
    this._broadcastAll({ type: 'players_update', players });
  }

  async _handleChat(player, msg) {
    // 쓱쓱 게임 세션 플레이어는 SS_GUESS 파이프라인만 사용 (정답 누수 봉쇄).
    if (player?.gameId === 'sseuk-sseuk') return;
    const text = (msg.text || '').slice(0, 256).trim();
    if (!text) return;

    const entry = { type: 'chat', playerId: player.id, name: player.name, colorIndex: player.colorIndex, text, ts: Date.now() };

    const chatLog = (await this.state.storage.get('chatLog')) || [];
    chatLog.push(entry);
    if (chatLog.length > 50) chatLog.shift();
    await this.state.storage.put('chatLog', chatLog);

    this._broadcastAll(entry);
  }

  async _handleVoteGame(ws, player, msg) {
    const gameId = msg.gameId || null;
    if (gameId && !GAME_PATHS[gameId]) return;

    ws.serializeAttachment({ ...player, gameVote: gameId });

    const sessions  = this._getLobbySessions();
    const gameVotes = this._buildGameVotes(sessions);
    this._broadcastAll({ type: 'game_vote_update', votes: gameVotes });
    await this._checkStartCondition(sessions);
  }

  async _handleVoteStart(ws, player, msg) {
    const vote = msg.vote !== false;
    ws.serializeAttachment({ ...player, startVote: vote });

    const sessions   = this._getLobbySessions();
    const startCount = sessions.filter(s => s.player.startVote).length;
    this._broadcastAll({ type: 'start_vote_update', count: startCount, total: sessions.length });
    await this._checkStartCondition(sessions);
  }

  async _checkStartCondition(sessions) {
    const phase = (await this.state.storage.get('phase')) || 'lobby';
    if (phase !== 'lobby') return;

    const total = sessions.length;
    if (total === 0) return;

    const startCount = sessions.filter(s => s.player.startVote).length;
    if (startCount <= total / 2) return;

    const tally = {};
    for (const { player } of sessions) {
      if (player.gameVote) tally[player.gameVote] = (tally[player.gameVote] || 0) + 1;
    }

    let topGame = null, topCount = 0;
    for (const [gameId, count] of Object.entries(tally)) {
      if (count > topCount) { topGame = gameId; topCount = count; }
    }

    if (!topGame || topCount <= total / 2) return;
    await this._startCountdown(topGame);
  }

  async _startCountdown(gameId) {
    await this.state.storage.put('currentGame', gameId);
    await this.state.storage.put('gameRoster', this._getLobbySessions().map(({ player }) => ({
      id: player.id,
      name: player.name,
      colorIndex: player.colorIndex,
      color: player.color,
    })));
    await this.state.storage.delete('scores');
    this.jumpGame = null;
    this._stopJumpLoop();
    this._clearSseukTimers();
    this.sseukGame = null;
    await this.state.storage.put('phase', 'countdown');
    for (const seconds of [3, 2, 1]) {
      this._broadcastAll({ type: 'countdown', seconds });
      await new Promise(r => setTimeout(r, 1000));
    }
    await this.state.storage.put('phase', 'playing');
    this._broadcastAll({ type: 'game_start', gameId });
  }

  async _handleSubmitResult(player, msg) {
    const score = typeof msg.score === 'number' ? Math.max(0, msg.score) : 0;
    const scores = (await this.state.storage.get('scores')) || {};
    scores[player.id] = { name: player.name, score, colorIndex: player.colorIndex };
    await this.state.storage.put('scores', scores);

    const roster = (await this.state.storage.get('gameRoster')) || [];
    const total = Math.max(roster.length, Object.keys(scores).length);
    const submitted = Object.keys(scores).length;
    const ranked = this._buildRankedScores(scores);

    this._broadcastAll({ type: 'scoreboard', results: ranked, submitted, total, final: submitted >= total });

    if (submitted >= total) {
      await this.state.storage.put('phase', 'results');
    }
  }

  /* Seeds a freshly-instantiated room from the world channel matchmaker.
   * Skips the lobby vote/countdown path entirely — players will land directly
   * on the game URL with their wm-<uuid> code and trigger _handleJoinGame,
   * which already handles phase=playing + gameRoster correctly.
   *
   * Caller contract:
   *   gameId  : 'jump-climber' | 'sseuk-sseuk' | 'mallang-stairs' | 'machine-animal-runner'
   *   players : [{ id, name, characterId? }]  (id is the world sessionId,
   *             reused as the game playerId so the URL ?playerId= matches)
   *   code    : optional 4-digit-style code; for world matches we just use
   *             the wm-<uuid> from the URL path.
   */
  async _seedFromWorld({ gameId, players, code }) {
    // Defensive cleanup — a room reused for a different match must not carry
    // ghosts. _startCountdown does the same dance.
    this.jumpGame = null;
    this._stopJumpLoop();
    this._clearSseukTimers();
    this.sseukGame = null;

    if (typeof code === 'string' && code) {
      await this.state.storage.put('code', code);
    }
    await this.state.storage.put('source', 'world');
    await this.state.storage.put('currentGame', gameId);
    await this.state.storage.put('gameRoster', players.map((p, i) => ({
      id: p.id,
      name: p.name,
      colorIndex: i,
      color: COLORS[i % COLORS.length],
      // World gives us snake_case avatar ids (mochi_rabbit). Game prototypes
      // expect kebab-case (mochi-rabbit). Translate now so the per-game
      // sanitize step doesn't silently fall back to the default avatar.
      characterId: pickGameCharacter(p.characterId, gameId).gameCharacterId,
    })));
    await this.state.storage.delete('scores');
    await this.state.storage.delete('chatLog');
    await this.state.storage.put('phase', 'playing');
    // No broadcast — the room has no live sockets yet. Players will arrive
    // via /api/rooms/<wm-id> WS upgrade and send 'join_game'.
  }

  async _handleRematch() {
    await this.state.storage.delete('scores');
    await this.state.storage.delete('currentGame');
    await this.state.storage.delete('gameRoster');
    this.jumpGame = null;
    this._stopJumpLoop();
    this._clearSseukTimers();
    this.sseukGame = null;
    // Reset player votes
    for (const { ws, player } of this._getLobbySessions()) {
      ws.serializeAttachment({ ...player, gameVote: null, startVote: false });
    }
    await this.state.storage.put('phase', 'lobby');
    const sessions = this._getLobbySessions();
    this._broadcastAll({
      type: 'room_state',
      phase: 'lobby',
      currentGame: null,
      players: sessions.map(s => s.player),
      gameVotes: {},
      startVotes: 0,
      results: [],
    });
  }

  async _removePlayer(ws) {
    const player = ws.deserializeAttachment();
    ws.serializeAttachment(null);
    if (!player) return;

    // 릴레이 세션 종료 — 남은 같은 게임 세션들에 presence 갱신만 알린다.
    if (player.role === 'game' && player.mode === 'relay') {
      this.relayRates.delete(ws);
      this._broadcastRelayPresence(player.gameId);
      return;
    }

    if (player.role === 'game' && player.mode === 'module') {
      this.relayRates.delete(ws);
      const mod = SERVER_GAME_MODULES.get(player.gameId);
      if (mod) {
        const ctx = this._moduleCtx(player.gameId);
        try { await mod.onLeave?.(ctx, player); } catch { /* 모듈 오류 격리 */ }
      }
      // 모듈 세션이 모두 떠나면 in-memory 상태 정리 (mode==='module' 세션만 계산).
      const remaining = this._getGameSessions(player.gameId).filter(({ player: p }) => p.mode === 'module').length;
      if (remaining === 0) this.moduleGames.delete(player.gameId);
      return;
    }

    if (player.role === 'game' && player.gameId === 'jump-climber' && this.jumpGame?.players[player.id]) {
      const target = this.jumpGame.players[player.id];
      target.connected = false;
      target.inputDirection = 0;
      if (target.alive) {
        target.alive = false;
        target.vx = 0;
        target.vy = 0;
      }

      if (Object.values(this.jumpGame.players).every((entry) => !entry.alive)) {
        await this._finishJumpGame();
      } else {
        this._broadcastJumpPatch();
      }
      return;
    }

    if (player.role === 'game' && player.gameId === 'sseuk-sseuk' && this.sseukGame) {
      const ssPlayer = this.sseukGame.players.find(p => p.id === player.id);
      if (ssPlayer) {
        // Race guard: 클라이언트 자동 재접속으로 같은 playerId 의 새 소켓이
        // 이미 _handleSseukJoinGame 에서 connected=true 로 살려뒀는데, 묵은
        // 소켓의 close 이벤트가 늦게 도착해서 false 로 덮어쓰면 사용자가 화면
        // 상으로는 살아 있는데 서버 로스터에선 끊긴 상태가 된다. 같은 playerId
        // 의 다른 활성 sseuk-sseuk 소켓이 있으면 이 close 는 stale 로 보고
        // disconnect 부작용을 모두 건너뛴다.
        const otherLive = this._getSessions().some(({ ws: otherWs, player: other }) =>
          otherWs !== ws
          && otherWs.readyState === 1 /* WebSocket.OPEN */
          && other && other.id === player.id
          && other.gameId === 'sseuk-sseuk'
        );
        if (otherLive) return;
        ssPlayer.connected = false;
        ssPlayer.ready = false;
        this._broadcastGame({ type: 'SS_PLAYER_UPDATE', players: this.sseukGame.players }, 'sseuk-sseuk');

        const anyConnected = this.sseukGame.players.some(p => p.connected);
        if (!anyConnected) {
          this._clearSseukTimers();
          this.sseukGame = null;
          return;
        }
        // 출제자 disconnect → 즉시 라운드 종료.
        if (this.sseukGame.phase !== 'waiting' && this.sseukGame.currentRound?.drawerId === player.id) {
          this._endSseukRound('drawer-disconnect').catch(() => {});
          return;
        }
        // Codex MINOR #6: 비-출제자 disconnect 시, 남은 connected guesser가 모두 맞힌
        // 상태라면 bonus/timeout 안 기다리고 즉시 all-correct로 종료.
        if (this.sseukGame.phase === 'drawing' || this.sseukGame.phase === 'bonus') {
          const r = this.sseukGame.currentRound;
          if (r) {
            const remainingGuessers = this.sseukGame.players.filter(p => p.connected && p.id !== r.drawerId);
            const allCorrect = remainingGuessers.length > 0
              && remainingGuessers.every(g => r.correctOrder?.some(e => e.id === g.id));
            if (allCorrect) {
              this._endSseukRound('all-correct').catch(() => {});
              return;
            }
          }
        }
      }
      return;
    }

    const sessions = this._getLobbySessions(); // excludes the null'd player
    const players  = sessions.map(s => s.player);
    this._broadcastAll({ type: 'player_left', playerId: player.id, name: player.name });
    this._broadcastAll({ type: 'players_update', players });
  }


}
