import { QUIZ_BANK } from './quiz_bank.js';
import { SS_KEYWORD_POOL } from './ss_keywords.js';
import { submitScore } from './leaderboard.js';
import { pickGameCharacter } from './characters.js';

const COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

// Keep in sync with /games/registry.js (browser can't import that file here)
const GAME_PATHS = {
  'jump-climber': '/prototypes/jump-climber/index.html',
  'mallang-quiz-battle': '/prototypes/mallang-quiz-battle/index.html',
  'sseuk-sseuk': '/prototypes/sseuk-sseuk/index.html',
};

const QUIZ_VALID_CHARS = ['mochi-rabbit', 'pudding-hamster', 'peach-chick', 'latte-puppy', 'mint-kitten'];
const SS_VALID_CHARS = ['mochi-rabbit', 'pudding-hamster', 'peach-chick', 'latte-puppy', 'mint-kitten'];
const SS_TOTAL_ROUNDS = 5;
const SS_VOLUNTEER_TIMEOUT_MS = 8000;   // spec 8~10초 중 하한
const SS_ROUND_DURATION_MS    = 75000;  // spec 60~90초 중앙
const SS_BONUS_AFTER_FIRST_MS = 10000;
const SS_HINT_LENGTH_AT_MS    = 20000;
const SS_HINT_LETTER_AT_MS    = 40000;
const SS_LOTTERY_ANIM_MS      = 2500;

const SS_STROKE_POINTS_CAP     = 500;   // 단일 스트로크 최대 포인트 수
const SS_STROKES_PER_ROUND_CAP = 200;   // 라운드당 최대 스트로크 수

// 정답에 가까운 단어를 가리킬 때 쓰는 "거의 다 왔어요!" 임계 — 정답 길이 - 1 일치.
const SS_PROXIMITY_NEAR_DIFF   = 1;
const QUIZ_QUESTION_COUNT = 10;
const QUIZ_TIME_LIMIT_MS = 10000;
const QUIZ_REVEAL_MS = 3500;
const QUIZ_POINTS_PER_CORRECT = 100;
const QUIZ_HINT_PENALTY = 40;

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

const JUMP_CHARACTER_ABILITIES = {
  'mochi-rabbit':    { jumpMul: 1.06, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 0 },
  'pudding-hamster': { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.18, boostMul: 1.00, superJumpEvery: 0 },
  'peach-chick':     { jumpMul: 1.00, gravityMul: 0.85, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 0 },
  'latte-puppy':     { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.00, superJumpEvery: 3 },
  'mint-kitten':     { jumpMul: 1.00, gravityMul: 1.00, moveMul: 1.00, boostMul: 1.50, superJumpEvery: 0 },
};

const JUMP_DEFAULT_ABILITIES = JUMP_CHARACTER_ABILITIES['mochi-rabbit'];

function getJumpAbilities(characterId) {
  return JUMP_CHARACTER_ABILITIES[characterId] || JUMP_DEFAULT_ABILITIES;
}

function sanitizeJumpCharacterId(characterId, fallback = 'mochi-rabbit') {
  return JUMP_CHARACTERS.includes(characterId) ? characterId : fallback;
}

const TUG_CHARACTERS = ['mochi-rabbit', 'pudding-hamster', 'peach-chick'];
const TUG_DEFAULT_CHARACTER = 'mochi-rabbit';
const TUG_DURATION_MS = 30000;
const TUG_COUNTDOWN_SECONDS = 3;
const TUG_PLAYER_COUNT = 2;
const TUG_TICK_MS = 50;
const TUG_KO_THRESHOLD = 1.0;

// 리듬 링 + 풀 파워 — SPEC v0.9 라운드 구조.
// 페이즈 1: 정상값 / 페이즈 2 (클러치, 20초 이후): 단축값.
// ringIntervalMs는 ring lifetime(shrink + goodWindow)보다 약간 길게 잡아
// 단일 currentRing 정책에서 등간격이 깨지지 않도록 한다 (1단계 980→1000, 2단계 790→820).
const TUG_RHYTHM_CONFIG_PHASE1 = {
  ringIntervalMs: 1000,
  ringShrinkDurationMs: 700,
  perfectWindowMs: 120,
  goodWindowMs: 280,
};

const TUG_RHYTHM_CONFIG_PHASE2 = {
  ringIntervalMs: 820,
  ringShrinkDurationMs: 550,
  perfectWindowMs: 110,
  goodWindowMs: 240,
};

// 후방 호환 — 기존 TUG_RHYTHM_CONFIG 참조는 phase 1 값을 가리키도록.
const TUG_RHYTHM_CONFIG = TUG_RHYTHM_CONFIG_PHASE1;

// 페이즈 2 진입 시각 (라운드 시작 후 경과 시간) — SPEC line 63.
const TUG_PHASE_CLUTCH_START_MS = 20000;

const TUG_PULL_POWER = {
  perfect: 0.040,
  good: 0.018,
  miss: -0.005,
};

// Phase E-1 — 아이템 시스템 (SPEC v0.11 line 207~250).
// 자동 grab 정책: 별도 클라 인풋 없음, 서버가 캐릭터 측 ropePos 영역에 도달한 박스를 자동 부여.
const TUG_ITEM_CONFIG = {
  spawnIntervalMs: 4000,
  spawnIntervalJitterMs: 1500,
  fallDurationMs: 2200,
  // 캐릭터에 자동 grab되는 fallProgress 임계 — 1.0 직전. 0.92는 약 200ms 마진(2200 * 0.08).
  autoGrabFallProgress: 0.92,
};

const TUG_ITEM_DEFS = {
  cottoncandy_bomb: {
    spawnWeight: 70,
    pullDelta: 0.10,
    effect: 'instant_pull',
  },
  ice_star: {
    spawnWeight: 30,
    multiplier: 0.75,
    affectedPulls: 1,
    perfectBypassesEffect: true,
    effect: 'opponent_next_non_perfect_pull_weakened',
  },
};

function pickTugItemType() {
  const total = Object.values(TUG_ITEM_DEFS).reduce((sum, def) => sum + def.spawnWeight, 0);
  let roll = Math.random() * total;
  for (const [id, def] of Object.entries(TUG_ITEM_DEFS)) {
    roll -= def.spawnWeight;
    if (roll <= 0) return id;
  }
  return 'cottoncandy_bomb';
}

function getTugRhythmConfig(game) {
  if (!game || !game.startedAt) return TUG_RHYTHM_CONFIG_PHASE1;
  const elapsed = Date.now() - game.startedAt;
  return elapsed >= TUG_PHASE_CLUTCH_START_MS
    ? TUG_RHYTHM_CONFIG_PHASE2
    : TUG_RHYTHM_CONFIG_PHASE1;
}

function getTugPhaseStage(game) {
  if (!game || !game.startedAt) return 1;
  return (Date.now() - game.startedAt) >= TUG_PHASE_CLUTCH_START_MS ? 2 : 1;
}

function sanitizeTugCharacterId(characterId, fallback = TUG_DEFAULT_CHARACTER) {
  return TUG_CHARACTERS.includes(characterId) ? characterId : fallback;
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

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.jumpGame = null;
    this.jumpLoop = null;
    this.tugWarGame = null;
    this.tugWarLoop = null;
    this.quizGame = null;
    this.sseukGame = null;
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

  async _submitScoresToLeaderboard(gameId, players) {
    try {
      if (!this.env?.DB || !Array.isArray(players) || players.length === 0) return;

      const roomCode = (await this.state.storage.get('roomCode')) || null;
      const sessions = this._getGameSessions(gameId);

      for (const { id, name, score } of players) {
        try {
          const { isNewRecord, previousBest, rank } = await submitScore(this.env.DB, {
            playerName: name,
            gameId,
            score,
            roomCode,
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
    const kind = isBase ? 'base' : PLATFORM_KINDS[Math.floor(Math.random() * PLATFORM_KINDS.length)];
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
    const kind = Math.random() < 0.5 ? 'rocket' : 'star';
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
      game.nextMonsterSpawnAtMs = game.elapsedMs + randomBetween(
        JUMP_GAME_SETTINGS.monsterSpawnIntervalMinMs,
        JUMP_GAME_SETTINGS.monsterSpawnIntervalMaxMs
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
    player.vy += JUMP_GAME_SETTINGS.gravity * abilities.gravityMul * stepScale;
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
    this._submitScoresToLeaderboard('jump-climber', Object.entries(scores).map(([id, s]) => ({ id, name: s.name, score: s.score })));

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
    if (msg.gameId === 'mallang-quiz-battle') {
      return await this._handleQuizJoinGame(ws, msg);
    }

    if (msg.gameId === 'sseuk-sseuk') {
      return await this._handleSseukJoinGame(ws, msg);
    }

    if (msg.gameId === 'mallang-tug-war') {
      return await this._handleTugWarJoinGame(ws, msg);
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

  _ensureTugWarGame(playerRoster) {
    if (this.tugWarGame) return this.tugWarGame;
    const participants = playerRoster.slice(0, TUG_PLAYER_COUNT);
    const game = {
      phase: 'waiting',
      durationMs: TUG_DURATION_MS,
      startedAt: null,
      countdownEndsAt: null,
      ropePos: 0,
      players: {},
      roster: participants.map((p, i) => ({
        id: p.id,
        name: p.name,
        side: i === 0 ? 'left' : 'right',
      })),
      winnerId: null,
      endReason: null,
      // 라운드별 토큰 — 늦게 도착한 setTimeout이 새 라운드를 침범하지 못하게 race guard.
      // 주의: in-memory만 — DO hibernation 시 setTimeout과 함께 손실됨. Cloudflare Alarms API 전환은 후속.
      countdownToken: null,
      roundToken: null,
      // 리듬 링 + 통계
      currentRing: null,
      nextRingId: 1,
      nextRingSpawnAtMs: 0,
      stats: {},
      // Phase E-1: 아이템 시스템.
      // items 배열에는 active(미수령/미만료) 박스만 유지.
      // iceStarPending[playerId] = remaining count — 다음 비-Perfect 풀 약화 횟수.
      items: [],
      nextItemId: 1,
      nextItemSpawnAtMs: 0,
      iceStarPending: {},
    };
    game.roster.forEach(({ id, name, side }) => {
      game.players[id] = {
        id,
        name,
        side,
        characterId: TUG_DEFAULT_CHARACTER,
        ready: false,
        connected: false,
      };
      game.stats[id] = {
        // Phase C부터 활성.
        perfects: 0,
        goods: 0,
        misses: 0,
        itemsGrabbed: 0,
        totalPullContribution: 0,
        longestPerfectStreak: 0,
        currentPerfectStreak: 0,
        // Phase E-3: 명장면 회상용. side 기준 자기 진영 입장에서 갱신.
        worstRopePos: 0,        // 자기에게 가장 위험했던 ropePos의 절대값 (0~1).
        timeInDangerMs: 0,      // danger/critical 상태(자기 진영 기준) 누적 시간.
        comebackFromRopePos: null, // 0.7 이상 밀렸다가 자기 진영 우세로 복귀했을 때 가장 깊었던 절대값.
        finalBlowAt: null,      // 본인 KO 승리/시간 우세 결정 시점의 elapsedMs.
        _deepestDisadvantage: 0, // 내부: 가장 깊이 밀렸던 절대값 (comeback 계산용).
        _wasInDanger: false,     // 내부: 직전 tick의 danger 상태 (체류 시간 계산용 — 실제 누적은 frame ms 가산).
      };
    });
    this.tugWarGame = game;
    return game;
  }

  _serializeTugWarState() {
    if (!this.tugWarGame) return null;
    const game = this.tugWarGame;
    let timeLeftMs = game.durationMs;
    if (game.phase === 'playing' && game.startedAt) {
      timeLeftMs = Math.max(0, game.durationMs - (Date.now() - game.startedAt));
    } else if (game.phase === 'finished') {
      timeLeftMs = 0;
    }
    let countdownMsLeft = null;
    if (game.phase === 'countdown' && game.countdownEndsAt) {
      countdownMsLeft = Math.max(0, game.countdownEndsAt - Date.now());
    }
    return {
      phase: game.phase,
      durationMs: game.durationMs,
      timeLeftMs,
      countdownMsLeft,
      startedAt: game.startedAt,
      ropePos: game.ropePos,
      players: game.roster.map(({ id }) => ({ ...game.players[id] })),
      winnerId: game.winnerId,
      endReason: game.endReason,
      currentRing: game.currentRing ? this._serializeTugRing(game.currentRing) : null,
      items: game.items.map((item) => this._serializeTugItem(item)),
      stats: this._serializeTugStats(game.stats),
      phaseStage: getTugPhaseStage(game),
      serverTimeMs: Date.now(),
    };
  }

  // 화이트리스트 방식 — SPEC PlayerStats에 명시된 필드 + currentPerfectStreak(v0.10에서 명시)만 직렬화.
  // 내부 트래킹 필드(_deepestDisadvantage 등)와 미래에 추가되는 임의 필드를 자동 차단.
  _serializeTugStats(stats) {
    const ALLOWED_KEYS = [
      'perfects', 'goods', 'misses', 'itemsGrabbed',
      'totalPullContribution', 'longestPerfectStreak', 'currentPerfectStreak',
      'worstRopePos', 'timeInDangerMs', 'comebackFromRopePos', 'finalBlowAt',
    ];
    const out = {};
    for (const [id, s] of Object.entries(stats)) {
      const cleaned = {};
      for (const k of ALLOWED_KEYS) {
        if (k in s) cleaned[k] = s[k];
      }
      out[id] = cleaned;
    }
    return out;
  }

  _serializeTugItem(item) {
    return {
      id: item.id,
      itemType: item.itemType,
      spawnedAt: item.spawnedAt,
      expiresAt: item.expiresAt,
      ropePosAtSpawn: item.ropePosAtSpawn,
      fallProgress: item.fallProgress,
    };
  }

  _serializeTugRing(ring) {
    // resolvedBy는 클라가 알 필요 없으므로 제외 (이중 판정 방지는 서버 권한).
    // window/shrink는 ring-local — 클라 예측/glow가 페이즈 전환 race에 흔들리지 않게 함께 송출.
    return {
      id: ring.id,
      spawnedAt: ring.spawnedAt,
      centerAt: ring.centerAt,
      expiresAt: ring.expiresAt,
      perfectWindowMs: ring.perfectWindowMs,
      goodWindowMs: ring.goodWindowMs,
      shrinkDurationMs: ring.shrinkDurationMs,
    };
  }

  _broadcastTugWarStateSync() {
    const state = this._serializeTugWarState();
    if (!state) return;
    this._broadcastGame({ type: 'TUG_STATE_SYNC', state }, 'mallang-tug-war');
  }

  async _handleTugWarJoinGame(ws, msg) {
    const currentGame = (await this.state.storage.get('currentGame')) || null;
    const lobbyPhase = (await this.state.storage.get('phase')) || 'lobby';
    if (currentGame !== 'mallang-tug-war' || lobbyPhase !== 'playing') {
      ws.send(JSON.stringify({ type: 'error', message: '지금은 줄다리기 방에 합류할 수 없습니다.' }));
      return;
    }

    const fullRoster = (await this.state.storage.get('gameRoster')) || [];
    const playerRoster = fullRoster.slice(0, TUG_PLAYER_COUNT);
    const rosterPlayer = fullRoster.find((p) => p.id === msg.playerId) || null;
    if (!rosterPlayer) {
      ws.send(JSON.stringify({ type: 'error', message: '방 플레이어 정보가 맞지 않습니다.' }));
      return;
    }

    const game = this._ensureTugWarGame(playerRoster);
    const isPlayer = game.players[rosterPlayer.id] != null;
    const role = isPlayer ? 'player' : 'spectator';
    const side = isPlayer ? game.players[rosterPlayer.id].side : undefined;

    ws.serializeAttachment({
      ...rosterPlayer,
      role: 'game',
      gameId: 'mallang-tug-war',
      side: side || null,
      isSpectator: !isPlayer,
    });

    if (isPlayer) {
      game.players[rosterPlayer.id].connected = true;
    }

    ws.send(JSON.stringify({ type: 'TUG_JOINED', role, side }));
    this._broadcastTugWarStateSync();
  }

  async _handleTugWarSelectCharacter(player, msg) {
    if (!this.tugWarGame || player.isSpectator) return;
    const target = this.tugWarGame.players[player.id];
    if (!target) return;
    if (this.tugWarGame.phase !== 'waiting') return;
    target.characterId = sanitizeTugCharacterId(msg.characterId, target.characterId);
    this._broadcastTugWarStateSync();
  }

  async _handleTugWarReady(player, msg) {
    if (!this.tugWarGame || player.isSpectator) return;
    const target = this.tugWarGame.players[player.id];
    if (!target) return;
    if (this.tugWarGame.phase !== 'waiting') return;
    target.ready = msg.ready === true;

    const everyone = Object.values(this.tugWarGame.players);
    const fullRoster = everyone.length === TUG_PLAYER_COUNT;
    const allReady = fullRoster && everyone.every((p) => p.ready && p.connected);

    if (allReady) {
      this._startTugWarCountdown();
    } else {
      this._broadcastTugWarStateSync();
    }
  }

  _startTugWarCountdown() {
    if (!this.tugWarGame || this.tugWarGame.phase !== 'waiting') return;
    this.tugWarGame.phase = 'countdown';
    this.tugWarGame.countdownEndsAt = Date.now() + TUG_COUNTDOWN_SECONDS * 1000;
    const token = randomHex(8);
    this.tugWarGame.countdownToken = token;
    this._broadcastTugWarStateSync();
    setTimeout(() => this._tugWarBeginRound(token), TUG_COUNTDOWN_SECONDS * 1000);
  }

  _tugWarBeginRound(token) {
    if (!this.tugWarGame || this.tugWarGame.phase !== 'countdown') return;
    if (this.tugWarGame.countdownToken !== token) return; // 이전 라운드의 늦은 timer 무시
    this.tugWarGame.countdownToken = null;
    this.tugWarGame.phase = 'playing';
    this.tugWarGame.startedAt = Date.now();
    this.tugWarGame.countdownEndsAt = null;
    // 첫 링은 첫 spawn interval만큼 지연 후 등장 — 시작 직후 갑자기 링이 떠 있는 어색함 회피.
    this.tugWarGame.nextRingSpawnAtMs = Date.now() + TUG_RHYTHM_CONFIG.ringIntervalMs;
    this.tugWarGame.currentRing = null;
    // 첫 아이템도 같은 패턴 — 첫 spawn interval 후 등장.
    this.tugWarGame.nextItemSpawnAtMs = Date.now() + TUG_ITEM_CONFIG.spawnIntervalMs;
    this.tugWarGame.items = [];
    this.tugWarGame.iceStarPending = {};
    // Phase E-3: drama stats 첫 dt가 stale timestamp로 튀지 않도록 라운드 시작에 동기화.
    this.tugWarGame._lastDramaTickAt = Date.now();
    const roundToken = randomHex(8);
    this.tugWarGame.roundToken = roundToken;
    this._broadcastTugWarStateSync();
    this._startTugWarLoop();
    setTimeout(() => this._tugWarRoundTimeout(roundToken), TUG_DURATION_MS);
  }

  _startTugWarLoop() {
    if (this.tugWarLoop) clearInterval(this.tugWarLoop);
    this.tugWarLoop = setInterval(() => this._tickTugWar(), TUG_TICK_MS);
  }

  _stopTugWarLoop() {
    if (this.tugWarLoop) {
      clearInterval(this.tugWarLoop);
      this.tugWarLoop = null;
    }
  }

  _tickTugWar() {
    const game = this.tugWarGame;
    if (!game || game.phase !== 'playing') {
      this._stopTugWarLoop();
      return;
    }

    const now = Date.now();
    let dirty = false;

    // Phase E-3: 명장면 회상 stats 갱신 (worstRopePos / timeInDangerMs / comebackFromRopePos).
    this._updateTugDramaStats(now);

    // 페이즈 1 → 페이즈 2 전환 감지. 직전 stage와 다르면 STATE_SYNC.
    const stage = getTugPhaseStage(game);
    if (game.lastPhaseStage !== stage) {
      game.lastPhaseStage = stage;
      dirty = true;
    }

    // 활성 ring 만료 처리
    if (game.currentRing && now >= game.currentRing.expiresAt) {
      // 양 플레이어 중 응답 안 한 사람은 자동 miss로 기록.
      // ropePos는 변동 없음 (의도적 공백 — SPEC line 818) 이지만 stats(misses, perfectStreak 끊김)는 갱신.
      for (const player of Object.values(game.players)) {
        if (!game.currentRing.resolvedBy[player.id]) {
          game.currentRing.resolvedBy[player.id] = 'miss';
          this._applyTugTapStats(player.id, 'miss', 0);
        }
      }
      game.currentRing = null;
      dirty = true;
    }

    // 새 ring 스폰 — 페이즈에 따라 config 동적 선택
    if (!game.currentRing && now >= game.nextRingSpawnAtMs) {
      const cfg = getTugRhythmConfig(game);
      this._spawnTugRing(now, cfg);
      // 다음 스폰 시각은 이번 spawnedAt + ringIntervalMs (등간격 유지)
      game.nextRingSpawnAtMs = game.currentRing.spawnedAt + cfg.ringIntervalMs;
      dirty = true;
    }

    // 아이템 lifecycle — fallProgress 갱신, auto-grab, 만료 정리.
    if (this._tickTugItems(now)) dirty = true;

    // 새 아이템 스폰 — 평균 4초 + 지터.
    if (now >= game.nextItemSpawnAtMs) {
      this._spawnTugItem(now);
      dirty = true;
    }

    if (dirty) this._broadcastTugWarStateSync();
  }

  // 아이템 fallProgress 갱신 + 자동 grab/만료 처리. 변경이 있었으면 true 반환.
  _tickTugItems(now) {
    const game = this.tugWarGame;
    if (!game) return false;
    let dirty = false;
    const remaining = [];

    for (const item of game.items) {
      if (item.grabbed) continue; // 이미 처리된 아이템은 다음 sync에서 빠짐
      const age = now - item.spawnedAt;
      const progress = age / TUG_ITEM_CONFIG.fallDurationMs;
      item.fallProgress = Math.min(1, progress);

      // 자동 grab: progress가 임계 이상 + ropePos가 자기 진영 쪽으로 충분히 와 있으면 가까운 캐릭터에게 부여.
      // SPEC: 박스는 현재 ropePos 위에서 떨어짐 + 줄이 움직이면 박스도 함께 움직임 (item.ropePosAtSpawn은 시각 가이드).
      // 게임 로직상 grab 결정은 현재 ropePos 부호로: ropePos > 0 → left 우세 → left가 grab.
      if (item.fallProgress >= TUG_ITEM_CONFIG.autoGrabFallProgress) {
        const grabSide = game.ropePos > 0 ? 'left' : (game.ropePos < 0 ? 'right' : null);
        if (grabSide) {
          const grabber = Object.values(game.players).find((p) => p.side === grabSide);
          if (grabber) {
            this._applyTugItemEffect(item, grabber);
            dirty = true;
            continue; // 박스 소멸
          }
        }
        // ropePos==0 균형 또는 grab 못 한 채 끝까지 떨어짐 → 둘 다 못 먹음.
        if (item.fallProgress >= 1) {
          dirty = true;
          continue;
        }
      }

      remaining.push(item);
    }

    if (remaining.length !== game.items.length) {
      game.items = remaining;
      dirty = true;
    }
    return dirty;
  }

  _spawnTugItem(now) {
    const game = this.tugWarGame;
    if (!game) return;
    const itemType = pickTugItemType();
    const id = `item-${game.nextItemId++}`;
    game.items.push({
      id,
      itemType,
      spawnedAt: now,
      expiresAt: now + TUG_ITEM_CONFIG.fallDurationMs,
      ropePosAtSpawn: game.ropePos,
      fallProgress: 0,
      grabbed: false,
    });
    const jitter = (Math.random() * 2 - 1) * TUG_ITEM_CONFIG.spawnIntervalJitterMs;
    game.nextItemSpawnAtMs = now + TUG_ITEM_CONFIG.spawnIntervalMs + jitter;
  }

  _applyTugItemEffect(item, grabber) {
    const game = this.tugWarGame;
    if (!game) return;
    item.grabbed = true;
    item.grabbedBy = grabber.id;

    const stats = game.stats[grabber.id];
    if (stats) stats.itemsGrabbed += 1;

    if (item.itemType === 'cottoncandy_bomb') {
      // 즉시 풀 +0.10. side 부호 반전 적용.
      const def = TUG_ITEM_DEFS.cottoncandy_bomb;
      const signed = grabber.side === 'right' ? -def.pullDelta : def.pullDelta;
      game.ropePos = clamp(game.ropePos + signed, -1, 1);

      this._broadcastGame({
        type: 'TUG_ITEM_RESULT',
        itemId: item.id,
        itemType: item.itemType,
        playerId: grabber.id,
        effect: TUG_ITEM_DEFS.cottoncandy_bomb.effect,
        ropeDelta: signed,
        newRopePos: game.ropePos,
        clientSeq: null,
      }, 'mallang-tug-war');

      if (Math.abs(game.ropePos) >= TUG_KO_THRESHOLD) {
        this._finishTugWarKO();
        return;
      }
    } else if (item.itemType === 'ice_star') {
      // 상대의 다음 비-Perfect 풀 약화. perfect는 bypass.
      const opponent = Object.values(game.players).find((p) => p.id !== grabber.id);
      if (opponent) {
        game.iceStarPending[opponent.id] = (game.iceStarPending[opponent.id] || 0) + TUG_ITEM_DEFS.ice_star.affectedPulls;
      }
      this._broadcastGame({
        type: 'TUG_ITEM_RESULT',
        itemId: item.id,
        itemType: item.itemType,
        playerId: grabber.id,
        targetId: opponent?.id || null,
        effect: TUG_ITEM_DEFS.ice_star.effect,
        ropeDelta: 0,
        newRopePos: game.ropePos,
        clientSeq: null,
      }, 'mallang-tug-war');
    }
  }

  // Phase E-3 — 명장면 회상 stats 갱신 (매 tick).
  // 자기 진영 입장의 disadvantage = side==='left' ? -ropePos : ropePos. 양수면 위험, 음수면 안전.
  _updateTugDramaStats(now) {
    const game = this.tugWarGame;
    if (!game || game.phase !== 'playing' || !game.startedAt) return;

    const dt = game._lastDramaTickAt ? Math.max(0, now - game._lastDramaTickAt) : 0;
    game._lastDramaTickAt = now;

    for (const player of Object.values(game.players)) {
      const stats = game.stats[player.id];
      if (!stats) continue;
      const selfDisadvantage = player.side === 'left' ? -game.ropePos : game.ropePos;
      const disadvAbs = Math.max(0, selfDisadvantage);

      // worstRopePos: 자기에게 가장 위험했던 ropePos 절대값.
      if (disadvAbs > stats.worstRopePos) stats.worstRopePos = disadvAbs;

      // timeInDangerMs: 자기 진영 기준 danger(>=0.7) 또는 critical(>=0.9) 상태 누적 체류.
      if (disadvAbs >= 0.7) stats.timeInDangerMs += dt;

      // comebackFromRopePos: 0.7 이상 밀렸다가 자기 진영 균형(disadv<=0)으로 복귀한 시점에 기록.
      // 라운드 내 다중 comeback이 있을 수 있으므로 가장 극적인(가장 깊었던) 값으로 max 갱신.
      if (disadvAbs > stats._deepestDisadvantage) stats._deepestDisadvantage = disadvAbs;
      if (stats._deepestDisadvantage >= 0.7 && selfDisadvantage <= 0) {
        const candidate = stats._deepestDisadvantage;
        if (stats.comebackFromRopePos == null || candidate > stats.comebackFromRopePos) {
          stats.comebackFromRopePos = candidate;
        }
        // deepest 리셋 — 다음 더 깊은 comeback 후보 측정을 새로 시작.
        stats._deepestDisadvantage = 0;
      }
    }
  }

  _markTugFinalBlow(winnerId) {
    const game = this.tugWarGame;
    if (!game || !winnerId) return;
    const stats = game.stats[winnerId];
    if (!stats) return;
    const elapsed = game.startedAt ? Date.now() - game.startedAt : 0;
    stats.finalBlowAt = elapsed;
  }

  _spawnTugRing(now, cfg = TUG_RHYTHM_CONFIG_PHASE1) {
    const game = this.tugWarGame;
    if (!game) return;
    const id = `ring-${game.nextRingId++}`;
    const spawnedAt = now;
    const centerAt = spawnedAt + cfg.ringShrinkDurationMs;
    const expiresAt = centerAt + cfg.goodWindowMs;
    game.currentRing = {
      id,
      spawnedAt,
      centerAt,
      expiresAt,
      // ring-local cfg snapshot — 페이즈 경계에서 spawn된 ring은 spawn 시점 window로 판정.
      // 서버/클라 모두 이 값을 권위로 사용해 1→2 전환 race 방지.
      perfectWindowMs: cfg.perfectWindowMs,
      goodWindowMs: cfg.goodWindowMs,
      shrinkDurationMs: cfg.ringShrinkDurationMs,
      resolvedBy: {},
    };
  }

  _tugWarRoundTimeout(token) {
    if (!this.tugWarGame || this.tugWarGame.phase !== 'playing') return;
    if (this.tugWarGame.roundToken !== token) return;
    this._finishTugWarTimeout();
  }

  _finishTugWarTimeout() {
    const game = this.tugWarGame;
    if (!game || game.phase !== 'playing') return;
    game.roundToken = null;
    game.phase = 'finished';
    game.endReason = 'timeout';
    game.currentRing = null;
    this._stopTugWarLoop();
    // 시간 종료 — ropePos 부호로 승자 결정. ropePos==0이면 무승부.
    if (game.ropePos > 0) {
      const left = Object.values(game.players).find((p) => p.side === 'left');
      game.winnerId = left?.id || null;
    } else if (game.ropePos < 0) {
      const right = Object.values(game.players).find((p) => p.side === 'right');
      game.winnerId = right?.id || null;
    } else {
      game.winnerId = null;
    }
    this._markTugFinalBlow(game.winnerId);
    this._broadcastTugGameEnd('timeout');
    this._broadcastTugWarStateSync();
  }

  _finishTugWarKO() {
    const game = this.tugWarGame;
    if (!game || game.phase !== 'playing') return;
    game.roundToken = null;
    game.phase = 'finished';
    game.endReason = 'ko';
    game.currentRing = null;
    this._stopTugWarLoop();
    // |ropePos| >= 1.0 도달 — 부호 기준으로 승자 결정. ropePos > 0 이면 left가 승.
    if (game.ropePos >= TUG_KO_THRESHOLD) {
      const left = Object.values(game.players).find((p) => p.side === 'left');
      game.winnerId = left?.id || null;
    } else {
      const right = Object.values(game.players).find((p) => p.side === 'right');
      game.winnerId = right?.id || null;
    }
    this._markTugFinalBlow(game.winnerId);
    this._broadcastTugGameEnd('ko');
    this._broadcastTugWarStateSync();
  }

  _broadcastTugGameEnd(reason) {
    const game = this.tugWarGame;
    if (!game) return;
    if (reason !== 'abandoned') {
      const tugPlayers = game.roster.map(({ id }) => {
        const p = game.players[id];
        const score = p.side === 'left'
          ? Math.round((game.ropePos + 1) / 2 * 100)
          : Math.round((1 - game.ropePos) / 2 * 100);
        return { id, name: p.name, score };
      });
      this._submitScoresToLeaderboard('mallang-tug-war', tugPlayers);
    }
    this._broadcastGame({
      type: 'TUG_GAME_END',
      reason,
      winnerId: game.winnerId,
      finalRopePos: game.ropePos,
      stats: this._serializeTugStats(game.stats),
    }, 'mallang-tug-war');
  }

  _handleTugWarTap(player, msg) {
    const game = this.tugWarGame;
    if (!game || game.phase !== 'playing') return;
    if (player.isSpectator) return;
    const target = game.players[player.id];
    if (!target) return;

    const ring = game.currentRing;
    if (!ring) {
      // 활성 ring 없을 때 탭 — 미스 텍스트만 즉시 회신 (ropePos 영향 없음, 통계 미스)
      this._applyTugTapStats(player.id, 'miss');
      this._broadcastGame({
        type: 'TUG_TAP_RESULT',
        ringId: null,
        playerId: player.id,
        judgement: 'miss',
        ropeDelta: 0,
        newRopePos: game.ropePos,
        clientSeq: Number.isFinite(msg.clientSeq) ? msg.clientSeq : null,
      }, 'mallang-tug-war');
      return;
    }

    // ringId 엄격 검증 — 누락/이전 ring/다음 ring을 alias로 보낸 경우 모두 거부.
    // 클라는 ring null 시점에 보낸 탭은 ringId=null로 보내며, 이 분기는 위에서 이미 처리됨.
    if (msg.ringId !== ring.id) return;
    if (ring.resolvedBy[player.id]) return; // 이중 판정 방지

    // 서버 도착 시각으로 판정 (RTT 보정은 후속 — 현재는 단순화).
    // ring-local cfg를 사용해 페이즈 1→2 경계 race를 차단 — 1로 spawn된 ring은 끝까지 1의 window.
    const now = Date.now();
    const delta = Math.abs(now - ring.centerAt);
    let judgement;
    if (delta <= ring.perfectWindowMs) judgement = 'perfect';
    else if (delta <= ring.goodWindowMs) judgement = 'good';
    else judgement = 'miss';

    ring.resolvedBy[player.id] = judgement;

    let ropeDelta = TUG_PULL_POWER[judgement] ?? 0;

    // Phase E-1: ice_star pending 효과. 비-Perfect 풀에만 적용, perfect는 bypass.
    const pending = game.iceStarPending[player.id] || 0;
    let iceApplied = false;
    if (pending > 0 && judgement !== 'perfect' && judgement !== 'miss') {
      ropeDelta = ropeDelta * TUG_ITEM_DEFS.ice_star.multiplier;
      game.iceStarPending[player.id] = pending - 1;
      iceApplied = true;
    } else if (pending > 0 && judgement === 'perfect') {
      // perfect는 bypass — pending 유지 (다음 비-perfect까지 보존).
    }

    // side가 left면 양수 방향, right이면 음수 방향으로 적용 (ropePos > 0이면 left 우세)
    if (target.side === 'right') ropeDelta = -ropeDelta;

    game.ropePos = clamp(game.ropePos + ropeDelta, -1, 1);
    this._applyTugTapStats(player.id, judgement, ropeDelta);
    void iceApplied; // (현재 클라 단순 통계 미사용. 추후 결과 화면 등장 시 활용)

    this._broadcastGame({
      type: 'TUG_TAP_RESULT',
      ringId: ring.id,
      playerId: player.id,
      judgement,
      ropeDelta,
      newRopePos: game.ropePos,
      clientSeq: Number.isFinite(msg.clientSeq) ? msg.clientSeq : null,
    }, 'mallang-tug-war');

    // KO 체크
    if (Math.abs(game.ropePos) >= TUG_KO_THRESHOLD) {
      this._finishTugWarKO();
      return;
    }

    this._broadcastTugWarStateSync();
  }

  _applyTugTapStats(playerId, judgement, ropeDelta = 0) {
    const stats = this.tugWarGame?.stats?.[playerId];
    if (!stats) return;
    if (judgement === 'perfect') {
      stats.perfects += 1;
      stats.currentPerfectStreak += 1;
      stats.longestPerfectStreak = Math.max(stats.longestPerfectStreak, stats.currentPerfectStreak);
    } else if (judgement === 'good') {
      stats.goods += 1;
      stats.currentPerfectStreak = 0;
    } else {
      stats.misses += 1;
      stats.currentPerfectStreak = 0;
    }
    stats.totalPullContribution += Math.abs(ropeDelta);
  }

  _handleTugWarItemGrab(player, msg) {
    // TODO: Phase E에서 아이템 효과 적용
  }

  // ── Quiz Battle ────────────────────────────────────────────────────────────

  _initQuizGame(roster) {
    if (this.quizGame) return;

    // 난이도 상향: 초등 혼합(가장 쉬운 셋)은 제외하고, 심화(`*2-`) 문항은 가중치 2배로 풀에 포함
    const isEasy = q => typeof q.id === 'string' && q.id.startsWith('elem-mixed-');
    const isHard = q => typeof q.id === 'string' && /^(math2|sci2|soc2|lang2|life2)-/.test(q.id);
    const pool = [];
    for (const q of QUIZ_BANK) {
      if (isEasy(q)) continue;
      pool.push(q);
      if (isHard(q)) pool.push(q); // 가중치 2배
    }
    // 중복 제거를 위해 id 기준으로 한 번 뽑은 문항은 제외하며 선별
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const seen = new Set();
    const picked = [];
    for (const q of pool) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      picked.push(q);
      if (picked.length >= QUIZ_QUESTION_COUNT) break;
    }

    this.quizGame = {
      players: roster.map(p => ({
        id: p.id,
        name: p.name,
        colorIndex: p.colorIndex,
        color: p.color,
        characterId: 'mochi-rabbit',
        score: 0,
        ready: false,
        connected: false,
      })),
      questions: picked,
      currentIndex: -1,
      phase: 'waiting',
      submissions: {},
      hintsUsed: {}, // { playerId: { questionIndex: true } }
      timer: null,
      questionStartedAt: null,
    };
  }

  async _handleQuizJoinGame(ws, msg) {
    const fullRoster = (await this.state.storage.get('gameRoster')) || [];
    const rosterPlayer = fullRoster.find(p => p.id === msg.playerId);
    if (!rosterPlayer) {
      ws.send(JSON.stringify({ type: 'error', message: '방 플레이어 정보가 맞지 않습니다.' }));
      return;
    }

    this._initQuizGame(fullRoster);

    const quizPlayer = this.quizGame.players.find(p => p.id === msg.playerId);
    if (quizPlayer) {
      quizPlayer.connected = true;
      if (QUIZ_VALID_CHARS.includes(msg.characterId)) quizPlayer.characterId = msg.characterId;
    }

    ws.serializeAttachment({ ...rosterPlayer, role: 'game', gameId: 'mallang-quiz-battle', isSpectator: false });
    ws.send(JSON.stringify({ type: 'QUIZ_JOINED', players: this.quizGame.players, phase: this.quizGame.phase }));
    this._broadcastGame({ type: 'QUIZ_PLAYER_UPDATE', players: this.quizGame.players }, 'mallang-quiz-battle');

    // 재접속: 현재 진행 중인 문항 재전송
    if (this.quizGame.phase === 'question') {
      const q = this.quizGame.questions[this.quizGame.currentIndex];
      const elapsed = this.quizGame.questionStartedAt ? Date.now() - this.quizGame.questionStartedAt : QUIZ_TIME_LIMIT_MS;
      const remaining = Math.max(1, Math.ceil((QUIZ_TIME_LIMIT_MS - elapsed) / 1000));
      ws.send(JSON.stringify({
        type: 'QUIZ_QUESTION',
        questionIndex: this.quizGame.currentIndex,
        total: this.quizGame.questions.length,
        question: q.question,
        options: q.options,
        timeLimit: remaining,
      }));
    }
  }

  async _handleQuizSelectCharacter(player, msg) {
    if (!this.quizGame) return;
    const characterId = QUIZ_VALID_CHARS.includes(msg.characterId) ? msg.characterId : 'mochi-rabbit';
    const quizPlayer = this.quizGame.players.find(p => p.id === player.id);
    if (!quizPlayer) return;
    quizPlayer.characterId = characterId;
    this._broadcastGame({ type: 'QUIZ_PLAYER_UPDATE', players: this.quizGame.players }, 'mallang-quiz-battle');
  }

  async _handleQuizReady(player, msg) {
    if (!this.quizGame || this.quizGame.phase !== 'waiting') return;
    const quizPlayer = this.quizGame.players.find(p => p.id === player.id);
    if (!quizPlayer) return;
    quizPlayer.ready = msg.ready !== false;
    this._broadcastGame({ type: 'QUIZ_PLAYER_UPDATE', players: this.quizGame.players }, 'mallang-quiz-battle');

    const connected = this.quizGame.players.filter(p => p.connected);
    const allReady = connected.length >= 1 && connected.every(p => p.ready);
    if (allReady) await this._startQuizCountdown();
  }

  async _startQuizCountdown() {
    this.quizGame.phase = 'countdown';
    for (const seconds of [3, 2, 1]) {
      if (!this.quizGame) return;
      this._broadcastGame({ type: 'QUIZ_COUNTDOWN', seconds }, 'mallang-quiz-battle');
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!this.quizGame) return;
    await this._advanceQuizQuestion();
  }

  async _advanceQuizQuestion() {
    if (!this.quizGame) return;
    if (this.quizGame.phase !== 'reveal' && this.quizGame.phase !== 'countdown') return;
    this.quizGame.currentIndex += 1;
    if (this.quizGame.currentIndex >= this.quizGame.questions.length) {
      await this._finishQuizGame();
      return;
    }

    const q = this.quizGame.questions[this.quizGame.currentIndex];
    this.quizGame.phase = 'question';
    this.quizGame.submissions = {};
    this.quizGame.questionStartedAt = Date.now();

    this._broadcastGame({
      type: 'QUIZ_QUESTION',
      questionIndex: this.quizGame.currentIndex,
      total: this.quizGame.questions.length,
      question: q.question,
      options: q.options,
      timeLimit: QUIZ_TIME_LIMIT_MS / 1000,
    }, 'mallang-quiz-battle');

    this.quizGame.timer = setTimeout(() => {
      this._revealQuizAnswer().catch(() => {});
    }, QUIZ_TIME_LIMIT_MS);
  }

  async _handleQuizAnswer(player, msg) {
    if (!this.quizGame || this.quizGame.phase !== 'question') return;
    if (this.quizGame.submissions[player.id] !== undefined) return;
    if (msg.questionIndex !== this.quizGame.currentIndex) return;

    const answerIndex = typeof msg.answerIndex === 'number' ? msg.answerIndex : -1;
    if (answerIndex < 0 || answerIndex > 3) return;
    this.quizGame.submissions[player.id] = answerIndex;

    const connected = this.quizGame.players.filter(p => p.connected);
    const submittedCount = Object.keys(this.quizGame.submissions).length;

    this._broadcastGame({
      type: 'QUIZ_SUBMITTED',
      playerId: player.id,
      submittedCount,
      totalCount: connected.length,
    }, 'mallang-quiz-battle');

    if (submittedCount >= connected.length) {
      if (this.quizGame.timer) { clearTimeout(this.quizGame.timer); this.quizGame.timer = null; }
      await this._revealQuizAnswer();
    }
  }

  async _handleQuizHint(ws, player, msg) {
    if (!this.quizGame || this.quizGame.phase !== 'question') return;
    if (msg.questionIndex !== this.quizGame.currentIndex) return;
    if (this.quizGame.submissions[player.id] !== undefined) return; // 이미 답 제출

    const qIdx = this.quizGame.currentIndex;
    const used = this.quizGame.hintsUsed[player.id] || {};
    if (used[qIdx]) return; // 이미 힌트 사용
    used[qIdx] = true;
    this.quizGame.hintsUsed[player.id] = used;

    const q = this.quizGame.questions[qIdx];
    // 오답 보기 4개 중 2개를 임의로 선택해 제거
    const wrongIndices = [0, 1, 2, 3].filter(i => i !== q.answer);
    for (let i = wrongIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wrongIndices[i], wrongIndices[j]] = [wrongIndices[j], wrongIndices[i]];
    }
    const eliminated = wrongIndices.slice(0, 2);

    try {
      ws.send(JSON.stringify({
        type: 'QUIZ_HINT_RESULT',
        questionIndex: qIdx,
        eliminated,
        penalty: QUIZ_HINT_PENALTY,
      }));
    } catch { /* ignore closed */ }
  }

  async _revealQuizAnswer() {
    if (!this.quizGame || this.quizGame.phase !== 'question') return;
    if (this.quizGame.timer) { clearTimeout(this.quizGame.timer); this.quizGame.timer = null; }
    this.quizGame.phase = 'reveal';

    const q = this.quizGame.questions[this.quizGame.currentIndex];
    const qIdx = this.quizGame.currentIndex;
    const hintUsedIds = [];
    for (const [pid, answerIndex] of Object.entries(this.quizGame.submissions)) {
      if (answerIndex === q.answer) {
        const p = this.quizGame.players.find(p => p.id === pid);
        const usedHint = !!(this.quizGame.hintsUsed[pid] && this.quizGame.hintsUsed[pid][qIdx]);
        if (usedHint) hintUsedIds.push(pid);
        const gained = usedHint ? Math.max(0, QUIZ_POINTS_PER_CORRECT - QUIZ_HINT_PENALTY) : QUIZ_POINTS_PER_CORRECT;
        if (p) p.score += gained;
      }
    }

    const scores = this.quizGame.players.map(p => ({ id: p.id, score: p.score }));
    this._broadcastGame({
      type: 'QUIZ_REVEAL',
      questionIndex: this.quizGame.currentIndex,
      correctIndex: q.answer,
      explanation: q.explanation,
      submissions: { ...this.quizGame.submissions },
      hintUsedIds,
      scores,
    }, 'mallang-quiz-battle');

    await new Promise(r => setTimeout(r, QUIZ_REVEAL_MS));
    if (!this.quizGame) return;
    await this._advanceQuizQuestion();
  }

  async _finishQuizGame() {
    if (!this.quizGame) return;
    this.quizGame.phase = 'finished';

    const rankings = [...this.quizGame.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, characterId: p.characterId, colorIndex: p.colorIndex, score: p.score }));

    this._broadcastGame({ type: 'QUIZ_END', rankings }, 'mallang-quiz-battle');
    this._submitScoresToLeaderboard('mallang-quiz-battle', rankings.map(r => ({ id: r.id, name: r.name, score: r.score })));

    const scores = {};
    this.quizGame.players.forEach(p => {
      scores[p.id] = { name: p.name, score: p.score, colorIndex: p.colorIndex };
    });
    await this.state.storage.put('scores', scores);
    await this.state.storage.put('phase', 'results');
  }

  // ── 슥슥 (Phase A: 라운드 머신 + 토큰 가드 + 라이프사이클 정리) ──
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
      usedKeywords: [],
      currentRound: null,         // { drawerId, keyword, syllableCount, startedAt, volunteers, firstCorrectAt, correctOrder, strokes }
      tokens: { volunteer: 0, round: 0, bonus: 0, hint: 0 },
      timers: { volunteer: null, round: null, bonus: null, hint: [] },
    };
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
        timeLeftMs: this._sseukTimeLeftMs(),
        volunteersDeadlineAt: r.volunteersDeadlineAt || null,
        // letter 힌트도 이미 공개됐으면 함께 복원.
        revealedLetter: (r.hintRevealed?.letterIdx != null && !isDrawer)
          ? { position: r.hintRevealed.letterIdx, value: [...r.keyword][r.hintRevealed.letterIdx] }
          : null,
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
      return Math.max(0, SS_ROUND_DURATION_MS - (Date.now() - r.startedAt));
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
    };
    this._broadcastGame({
      type: 'SS_VOLUNTEER_OPEN',
      roundIdx: this.sseukGame.currentRoundIdx,
      totalRounds: this.sseukGame.totalRounds,
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
    if (!r.volunteers.includes(player.id)) r.volunteers.push(player.id);
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

    const keyword = this._pickSseukKeyword();
    r.drawerId = drawerId;
    r.keyword = keyword;
    r.syllableCount = [...keyword].length; // 음절 단위 (Hangul은 코드포인트 1=1음절)
    this.sseukGame.drawerHistory.push(drawerId);

    // 추첨 연출 + 출제자/일반에게 분리 송신.
    // syllableCount는 출제자만 받음 (Codex MAJOR #4: 20s 글자수 힌트가 의미를 가지도록 노출 지연).
    const animPayloadBase = {
      type: 'SS_DRAWER_SELECTED',
      drawerId,
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

  _pickSseukKeyword() {
    const used = new Set(this.sseukGame.usedKeywords || []);
    const remaining = SS_KEYWORD_POOL.filter(w => !used.has(w));
    const pool = remaining.length > 0 ? remaining : SS_KEYWORD_POOL;
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
    const alreadyCorrect = r && Array.isArray(r.correctOrder) && r.correctOrder.includes(player.id);
    if (alreadyCorrect) {
      const visibleTo = new Set([r.drawerId, ...r.correctOrder]);
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
    if (r.correctOrder.includes(player.id)) return; // 중복 방지.
    r.correctOrder.push(player.id);
    const rank = r.correctOrder.length;

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
    const guessers = this.sseukGame.players.filter(p => p.connected && p.id !== r.drawerId);
    if (guessers.length > 0 && r.correctOrder.length >= guessers.length) {
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
    // syllableCount는 출제자에게만 — Codex MAJOR #4 (글자수 힌트 지연).
    const baseStart = {
      type: 'SS_ROUND_START',
      roundIdx: this.sseukGame.currentRoundIdx,
      drawerId: r.drawerId,
      timeLeftMs: SS_ROUND_DURATION_MS,
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
    }, SS_ROUND_DURATION_MS);

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
    // Phase A는 정답 파이프라인 미구현 → correctOrder는 항상 []. Phase D에서 채워짐.
    const rankPoints = [100, 70, 50, 30];
    (r?.correctOrder || []).forEach((pid, i) => {
      const gain = rankPoints[i] !== undefined ? rankPoints[i] : 30;
      perPlayerDelta[pid] = gain;
      const target = this.sseukGame.players.find(p => p.id === pid);
      if (target) target.score += gain;
    });
    if (r?.drawerId && r.correctOrder?.length > 0) {
      const drawerGain = r.correctOrder.length * 30;
      perPlayerDelta[r.drawerId] = (perPlayerDelta[r.drawerId] || 0) + drawerGain;
      const drawer = this.sseukGame.players.find(p => p.id === r.drawerId);
      if (drawer) drawer.score += drawerGain;
    }

    this._broadcastGame({
      type: 'SS_ROUND_END',
      reason,
      keyword: r?.keyword || null,
      drawerId: r?.drawerId || null,
      correctOrder: r?.correctOrder || [],
      perPlayerDelta,
      scores: Object.fromEntries(this.sseukGame.players.map(p => [p.id, p.score])),
    }, 'sseuk-sseuk');

    // 다음 라운드 또는 게임 종료. disconnect/insufficient-players 사유는
    // 사용자가 메시지를 읽을 시간을 더 주기 위해 길게.
    const pauseMs = (reason === 'drawer-disconnect' || reason === 'insufficient-players') ? 2500 : 1500;
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

  async _finishSseukGame() {
    if (!this.sseukGame) return;
    this.sseukGame.phase = 'finished';
    const rankings = [...this.sseukGame.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, characterId: p.characterId, colorIndex: p.colorIndex, score: p.score }));
    this._broadcastGame({ type: 'SS_GAME_END', rankings }, 'sseuk-sseuk');
    this._submitScoresToLeaderboard('sseuk-sseuk', rankings.map(r => ({ id: r.id, name: r.name, score: r.score })));
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

  // ── fetch ──────────────────────────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/init') {
      const { code } = await request.json();
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
      case 'TUG_READY':
        if (player?.gameId === 'mallang-tug-war') await this._handleTugWarReady(player, msg);
        break;
      case 'TUG_SELECT_CHARACTER':
        if (player?.gameId === 'mallang-tug-war') await this._handleTugWarSelectCharacter(player, msg);
        break;
      case 'TUG_TAP':
        if (player?.gameId === 'mallang-tug-war') this._handleTugWarTap(player, msg);
        break;
      case 'TUG_ITEM_GRAB':
        if (player?.gameId === 'mallang-tug-war') this._handleTugWarItemGrab(player, msg);
        break;
      case 'QUIZ_SELECT_CHARACTER':
        if (player?.gameId === 'mallang-quiz-battle') await this._handleQuizSelectCharacter(player, msg);
        break;
      case 'QUIZ_READY':
        if (player?.gameId === 'mallang-quiz-battle') await this._handleQuizReady(player, msg);
        break;
      case 'QUIZ_ANSWER':
        if (player?.gameId === 'mallang-quiz-battle') await this._handleQuizAnswer(player, msg);
        break;
      case 'QUIZ_HINT':
        if (player?.gameId === 'mallang-quiz-battle') await this._handleQuizHint(ws, player, msg);
        break;
      // ── 슥슥 ──
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
      case 'submit_result': if (player) await this._handleSubmitResult(player, msg);      break;
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
    // 슥슥 게임 세션 플레이어는 SS_GUESS 파이프라인만 사용 (정답 누수 봉쇄).
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
    this.tugWarGame = null;
    this._stopTugWarLoop();
    if (this.quizGame?.timer) clearTimeout(this.quizGame.timer);
    this.quizGame = null;
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
   *   gameId  : 'jump-climber' | 'mallang-tug-war' | 'mallang-quiz-battle'
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
    this.tugWarGame = null;
    this._stopTugWarLoop();
    if (this.quizGame?.timer) clearTimeout(this.quizGame.timer);
    this.quizGame = null;
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
    this.tugWarGame = null;
    this._stopTugWarLoop();
    if (this.quizGame?.timer) clearTimeout(this.quizGame.timer);
    this.quizGame = null;
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
              && remainingGuessers.every(g => r.correctOrder?.includes(g.id));
            if (allCorrect) {
              this._endSseukRound('all-correct').catch(() => {});
              return;
            }
          }
        }
      }
      return;
    }

    if (player.role === 'game' && player.gameId === 'mallang-quiz-battle' && this.quizGame) {
      const quizPlayer = this.quizGame.players.find(p => p.id === player.id);
      if (quizPlayer) {
        quizPlayer.connected = false;
        this._broadcastGame({ type: 'QUIZ_PLAYER_UPDATE', players: this.quizGame.players }, 'mallang-quiz-battle');
        const anyConnected = this.quizGame.players.some(p => p.connected);
        if (!anyConnected) {
          if (this.quizGame.timer) { clearTimeout(this.quizGame.timer); this.quizGame.timer = null; }
          this.quizGame = null;
          return;
        }
        // If in question phase, check whether remaining connected players all submitted
        if (this.quizGame?.phase === 'question') {
          const connected = this.quizGame.players.filter(p => p.connected);
          const submittedCount = Object.keys(this.quizGame.submissions).length;
          if (submittedCount >= connected.length && connected.length > 0) {
            if (this.quizGame.timer) { clearTimeout(this.quizGame.timer); this.quizGame.timer = null; }
            this._revealQuizAnswer().catch(() => {});
          }
        }
      }
      return;
    }

    if (player.role === 'game' && player.gameId === 'mallang-tug-war' && this.tugWarGame) {
      const target = this.tugWarGame.players[player.id];
      if (target) {
        target.connected = false;
        target.ready = false;

        const inRound = this.tugWarGame.phase === 'countdown' || this.tugWarGame.phase === 'playing';
        if (inRound) {
          // 라운드 토큰 무효화 — 진행 중이던 setTimeout이 실행돼도 무시되도록.
          this.tugWarGame.countdownToken = null;
          this.tugWarGame.roundToken = null;
          this.tugWarGame.phase = 'finished';
          this.tugWarGame.endReason = 'abandoned';
          this.tugWarGame.currentRing = null;
          this._stopTugWarLoop();
          const survivor = Object.values(this.tugWarGame.players).find((p) => p.connected);
          this.tugWarGame.winnerId = survivor?.id || null;
          this._broadcastTugGameEnd('abandoned');
        }
        this._broadcastTugWarStateSync();
      }
      return;
    }

    const sessions = this._getLobbySessions(); // excludes the null'd player
    const players  = sessions.map(s => s.player);
    this._broadcastAll({ type: 'player_left', playerId: player.id, name: player.name });
    this._broadcastAll({ type: 'players_update', players });
  }


}
