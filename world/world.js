/* World client — the 2D lounge UI.
 *
 * Picker → WS connect → server-authoritative roster, chat, reactions, zone
 * dwell + host-driven match modal → game handoff. Inputs: WASD/arrows and an
 * on-screen virtual joystick (mobile). Pong heartbeat keeps the DO awake.
 */

(function () {
  // 일부 모바일 브라우저(삼성 인터넷 등)가 100dvh 를 하단 툴바를 제외하지 않은
  // 큰 뷰포트(lvh)로 계산해 페이지 맨 아래 채팅 입력줄이 툴바에 가려진다.
  // 실측 innerHeight 를 CSS 변수로 공급해 #app 높이를 항상 가시 영역에 맞춘다.
  function syncAppHeight() {
    document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
  }
  syncAppHeight();
  window.addEventListener('resize', syncAppHeight);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncAppHeight);

  const PROTOCOL_VERSION = 1;
  const HEARTBEAT_MS = 15_000;
  const MOVE_SPEED = 180; // px/sec
  const LOUNGE_ID = readLoungeId();

  const CHAT_BUBBLE_MS = 5000;
  const REACTION_MS = 1500;
  const REACTIONS = [
    { key: 'wave',  glyph: '👋' },
    { key: 'heart', glyph: '❤️' },
    { key: 'lol',   glyph: '😂' },
    { key: 'wow',   glyph: '😮' },
    { key: 'party', glyph: '🎉' },
    { key: 'sleep', glyph: '😴' },
  ];
  const REACTION_GLYPHS = Object.fromEntries(REACTIONS.map((r) => [r.key, r.glyph]));

  // ── Player name colors ─────────────────────────────────────────────────────
  // Keyed by the *nickname* (normalised) so a player keeps the same color
  // across reconnects (where sessionId changes). HSL generator gives us an
  // unlimited palette so 11+ players don't collide.
  function nameColor(key) {
    const s = String(key || '').toLowerCase().trim();
    if (!s) return '#a0a8b8';
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const hue = (h >>> 0) % 360;
    return `hsl(${hue}deg 78% 70%)`;
  }

  // ── Character sprite sheets ───────────────────────────────────────────────
  // 3x3 grid. row: 0=down 1=side(right) 2=up. col: 0=idle 1=stepA 2=stepB.
  // The `left` direction reuses the side row, mirrored horizontally.
  // 예외: 라떼 강아지 시트는 side row가 왼쪽을 향해 미러링 방향이 반대다.
  // Source frame size is derived from the loaded sheet dimensions so large
  // AI-generated sprite atlases do not get cropped to an old fixed size.
  const SPRITE_FRAME = window.CHARACTER_FRAME || { width: 32, height: 32, cols: 3, rows: 3 };
  const WALK_FRAME_MS = 150;
  const spriteCache = new Map(); // worldId -> { img, ready }
  function getSprite(worldId) {
    let s = spriteCache.get(worldId);
    if (s) return s;
    s = { img: null, ready: false };
    spriteCache.set(worldId, s);
    const meta = Array.isArray(window.CHARACTERS)
      ? window.CHARACTERS.find((c) => c.worldId === worldId) : null;
    if (meta && meta.sheet) {
      const img = new Image();
      img.onload = () => { s.img = img; s.ready = true; };
      img.src = meta.sheet;
    }
    return s;
  }
  function getSpriteSourceFrame(sprite) {
    const cols = Math.max(1, Number(SPRITE_FRAME.cols) || 1);
    const rows = Math.max(1, Number(SPRITE_FRAME.rows) || 1);
    const img = sprite?.img;
    const fallbackWidth = Math.max(1, Number(SPRITE_FRAME.width) || 32);
    const fallbackHeight = Math.max(1, Number(SPRITE_FRAME.height) || 32);
    // 사람 아바타 합성 시트는 canvas 라 naturalWidth 가 없다 — width 로 폴백.
    const iw = img ? (img.naturalWidth || img.width) : 0;
    const ih = img ? (img.naturalHeight || img.height) : 0;
    if (!iw || !ih) {
      return { width: fallbackWidth, height: fallbackHeight };
    }
    return {
      width: Math.floor(iw / cols) || fallbackWidth,
      height: Math.floor(ih / rows) || fallbackHeight,
    };
  }

  // ── Human avatar composite (AVATAR_DESIGN.md §5) ─────────────────────────
  // characterId 'human' 은 고정 시트가 아니라 착장(outfit) 기반 오프스크린 합성
  // 시트를 쓴다. 착장이 바뀔 때 한 번만 합성하고 프레임마다는 시트 1장을 그린다.
  // z-order: hair_back → 코디(바디 포함) → hair_front → 얼굴 소품 → 모자.
  const HUMAN_ID = 'human';
  // 걸음 재생(§5-6): 정지 프레임을 통과 자세로 재사용한 4박자 A→정지→B→정지.
  // §1 사람검증(wardrobe-preview.html 토글 판정) 결과에 따라 2박자 [1,2] 로
  // 되돌리거나 MS 를 90~200 사이로 조정한다.
  const HUMAN_WALK_MS = 130;
  const HUMAN_WALK_PATTERN = [1, 0, 2, 0];
  const HUMAN_SHEET_SIZE = 384;        // 배포 정규화 규격(셀 128px, §5-7)
  const HUMAN_SHEET_CACHE_MAX = 24;    // LRU 상한(§5-8)

  const layerImageCache = new Map();   // url -> Promise<HTMLImageElement> (실패 시 reject)
  function loadLayerImage(url) {
    let p = layerImageCache.get(url);
    if (p) return p;
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('layer load failed: ' + url));
      img.src = url;
    });
    layerImageCache.set(url, p);
    return p;
  }

  // outfitKey -> { img: canvas|null, ready, promise } — Map 삽입 순서를 LRU 로 사용.
  const humanSheetCache = new Map();
  function ensureHumanSheet(outfit) {
    const W = window.WARDROBE;
    const key = W.outfitKey(outfit);
    let entry = humanSheetCache.get(key);
    if (entry) {
      // LRU touch — 최근 사용을 맨 뒤로.
      humanSheetCache.delete(key);
      humanSheetCache.set(key, entry);
      return entry;
    }
    entry = { img: null, ready: false, promise: null };
    entry.promise = Promise.all(W.layerUrls(outfit).map(loadLayerImage))
      .then((imgs) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = HUMAN_SHEET_SIZE;
        const c = canvas.getContext('2d');
        for (const img of imgs) c.drawImage(img, 0, 0, HUMAN_SHEET_SIZE, HUMAN_SHEET_SIZE);
        entry.img = canvas;
        entry.ready = true;
        return entry;
      })
      .catch(() => {
        // 레이어 하나라도 실패하면 합성 전체를 불합격 처리 — 민머리(마네킹)
        // 부분 노출 대신 emoji 폴백을 유지한다(§3 비노출 원칙).
        entry.ready = false;
        return entry;
      });
    humanSheetCache.set(key, entry);
    if (humanSheetCache.size > HUMAN_SHEET_CACHE_MAX) {
      const oldest = humanSheetCache.keys().next().value;
      humanSheetCache.delete(oldest);
    }
    return entry;
  }

  /* 플레이어의 현재 착장 시트를 돌려준다. 합성이 끝나기 전에는 그 플레이어가
   * 마지막으로 완성했던 시트를 유지(원자 교체, §5-9) — 없으면 not-ready 를
   * 돌려줘 emoji 폴백을 태운다. sanitize 결과는 raw 참조가 바뀔 때만 재계산.
   */
  function getHumanSprite(p) {
    if (p._outfitRaw !== p.outfit || !p._outfitSan) {
      p._outfitRaw = p.outfit;
      p._outfitSan = window.WARDROBE.sanitizeOutfit(p.outfit);
      // _lastSheet 은 남겨둔다 — 갈아입기 합성이 끝날 때까지 이전 착장을
      // 그대로 보여주다가 완료 시 한 번에 교체(깜빡임 방지, §5-9).
    }
    const entry = ensureHumanSheet(p._outfitSan);
    if (entry.ready) {
      p._lastSheet = entry;
      return entry;
    }
    return p._lastSheet || entry;
  }

  // ── World background ──────────────────────────────────────────────────────
  const worldBg = new Image();
  let worldBgReady = false;
  worldBg.onload = () => { worldBgReady = true; };
  worldBg.src = './assets/world_bg.png';

  // ── Spawn entry effect ───────────────────────────────────────────────────
  // 게임 끝나고 월드로 돌아왔을 때 캐릭터 위에 깜빡이는 등장 이펙트.
  // 외부 이미지 없이 canvas drawing 으로 빠른 폭죽/링 효과.
  const spawnEffects = [];
  function pushSpawnEffect(x, y) {
    spawnEffects.push({ x, y, startAt: performance.now(), duration: 900 });
  }
  function drawSpawnEffects(now) {
    for (let i = spawnEffects.length - 1; i >= 0; i--) {
      const e = spawnEffects[i];
      const t = (now - e.startAt) / e.duration;
      if (t >= 1) { spawnEffects.splice(i, 1); continue; }
      const fade = 1 - t;
      ctx.save();
      ctx.translate(e.x, e.y);
      const ringR = 8 + t * 60;
      ctx.strokeStyle = `rgba(255,255,255,${fade.toFixed(2)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,217,163,${fade.toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, ringR * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      // 6개 별이 회전하면서 퍼져나가는 sparkle
      ctx.fillStyle = `rgba(255,255,200,${fade.toFixed(2)})`;
      for (let s = 0; s < 6; s++) {
        const a = (Math.PI * 2 * s) / 6 + t * Math.PI;
        const sr = ringR * 0.9;
        const sx = Math.cos(a) * sr;
        const sy = Math.sin(a) * sr;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0, 3 - t * 2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── Game booth illustrations ──────────────────────────────────────────────
  const boothImages = {};
  function getBoothImage(gameId) {
    const file = gameId === 'jump-climber' ? 'booth_jump.png'
               : gameId === 'mallang-quiz-battle' ? 'booth_quiz.png'
               : gameId === 'sseuk-sseuk' ? 'booth_sseuk.png'
               : gameId === 'mallang-stairs' ? 'booth_stairs.png'
               : gameId === 'machine-animal-runner' ? 'booth_runner.png' : null;
    if (!file) return null;
    let entry = boothImages[gameId];
    if (entry) return entry;
    entry = { img: new Image(), ready: false };
    entry.img.onload = () => { entry.ready = true; };
    entry.img.src = './assets/' + file;
    boothImages[gameId] = entry;
    return entry;
  }

  // ── Lab booth (client-only) ───────────────────────────────────────────────
  // 실험실은 매칭이 필요 없는 "메뉴" 부스다. 서버 GAME_ZONES 에 넣으면 매치
  // 제안 로직이 돌아 깨지므로 클라 전용으로 렌더/판정한다. 들어서면 매칭 대신
  // GAME_REGISTRY 의 stage:'LAB' 게임 목록 패널을 열고, 카드 탭 시 해당 게임으로
  // ?from=lab 직접 이동(솔로).
  //   좌표: 정식 부스 3번째 슬롯(boothRect(2), x:571,y:200)은 mallang-stairs가
  //   사용하므로 실험실 부스는 바로 아래 2행 우측 칸으로 이동했다.
  //   (x:571,y:424,w:165,h:200). SPAWN_POINT(480,520)와도 겹치지 않는다.
  const LAB_BOOTH = { x: 571, y: 424, w: 165, h: 200 };
  const LAB_THEME = { color: '#b08cff', dark: '#6f4fd6', icon: '🧪' };
  let inLabBooth = false; // me 가 실험실 부스 rect 안에 있는지(진입/이탈 전이 추적)
  let labDismissed = false; // ✕ 로 패널을 닫음 — 같은 자리에선 재오픈 안 함(나갔다 들어오면 해제)
  let labModal = null;    // 지연 생성되는 실험실 패널 DOM

  // ── DOM references ──────────────────────────────────────────────────────────
  const joinPanel = document.getElementById('join-panel');
  const worldPanel = document.getElementById('world-panel');
  const nameInput = document.getElementById('name-input');
  const picker = document.getElementById('character-picker');
  const joinBtn = document.getElementById('join-btn');
  const joinStatus = document.getElementById('join-status');
  const connStatus = document.getElementById('conn-status');
  const canvas = document.getElementById('world-canvas');
  const ctx = canvas.getContext('2d');
  const reactionBar = document.getElementById('reaction-bar');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatLogEl = document.getElementById('chat-log');
  const chatLogBody = document.getElementById('chat-log-body');
  const chatLogToggle = document.getElementById('chat-log-toggle');
  const onlineCountEl = document.getElementById('online-count');
  const leaveBtn = document.getElementById('leave-btn');
  const wardrobeBtn = document.getElementById('wardrobe-btn');
  const matchModal = document.getElementById('match-modal');
  const matchTitle = document.getElementById('match-title');
  const matchStatus = document.getElementById('match-status');
  const matchMembers = document.getElementById('match-members');
  const matchAcceptBtn = document.getElementById('match-accept');
  const matchDeclineBtn = document.getElementById('match-decline');
  const matchModalCard = document.getElementById('match-modal-card');
  const matchPreview = document.getElementById('match-preview');
  const matchPreviewToggle = document.getElementById('match-preview-toggle');

  if (matchPreviewToggle) {
    matchPreviewToggle.addEventListener('click', () => {
      const nowHidden = matchPreview.classList.toggle('hidden');
      matchPreviewToggle.setAttribute('aria-expanded', nowHidden ? 'false' : 'true');
      matchPreviewToggle.textContent = nowHidden ? '게임 미리보기 ▸' : '미리보기 접기 ▴';
    });
  }

  // 부스 프리뷰 — gameId(=zoneId) → 게임 GIF. 준비된 게임만 등록(없으면 프리뷰 생략).
  // 다른 GIF 로 바꾸려면 경로만 교체하면 된다. 프리뷰는 부스에 올라선 순간부터
  // 하단 매칭 패널(match-modal) 안에서 보여준다(상단 플로팅 프리뷰는 폐지).
  const BOOTH_PREVIEWS = {
    // 주의: Cloudflare Pages 가 docs/ 는 서빙하지 않으므로 서빙되는 world/assets/ 에 둔다.
    'jump-climber': '/world/assets/preview_jump.gif',
    'sseuk-sseuk': '/world/assets/preview_sseuk.gif',
    // 'mallang-quiz-battle': 프리뷰 GIF 준비되면 world/assets/preview_quiz.gif 추가
  };
  // 하단 패널이 현재 pre-match(참가 준비) 로 띄워 둔 zoneId. null 이면 미표시.
  let panelZone = null;
  // pre-match 카운트다운 문구 캐시 — 매 프레임 동일 문자열을 다시 쓰지 않도록.
  let lastPanelStatus = '';
  const matchStartingView = document.getElementById('match-starting-view');
  const starterPortrait = document.getElementById('starter-portrait');
  const starterText = document.getElementById('starter-text');

  // shared/input.js only binds arrow keys. Add WASD locally so this page
  // matches the on-screen hint without touching shared input used by games.
  const wasd = { up: false, down: false, left: false, right: false };
  const joy  = { up: false, down: false, left: false, right: false };
  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }
  // World page owns its own keyboard layer (WASD + arrows) and its own touch
  // joystick. We do NOT consult InputManager here because its global touch
  // handlers fire on window-level touches (including chat-log drags) and
  // would bleed phantom movement into the world.
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    const k = e.key;
    const lk = k.toLowerCase();
    if (lk === 'w' || k === 'ArrowUp')    { wasd.up    = true; e.preventDefault(); }
    if (lk === 's' || k === 'ArrowDown')  { wasd.down  = true; e.preventDefault(); }
    if (lk === 'a' || k === 'ArrowLeft')  { wasd.left  = true; e.preventDefault(); }
    if (lk === 'd' || k === 'ArrowRight') { wasd.right = true; e.preventDefault(); }
  });
  // keyup is intentionally NOT gated by isTypingTarget — if a movement key
  // was held when focus moved into an input, we still want the release to
  // clear the latched state.
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    const lk = k.toLowerCase();
    if (lk === 'w' || k === 'ArrowUp')    wasd.up    = false;
    if (lk === 's' || k === 'ArrowDown')  wasd.down  = false;
    if (lk === 'a' || k === 'ArrowLeft')  wasd.left  = false;
    if (lk === 'd' || k === 'ArrowRight') wasd.right = false;
  });
  // Lose any "held" state when the tab/window loses focus — otherwise a
  // keydown without matching keyup leaves the player drifting. Also fully
  // reset the touch joystick (capture / pointer id / thumb) so the next
  // touch after returning from background isn't blocked.
  window.addEventListener('blur', () => {
    wasd.up = wasd.down = wasd.left = wasd.right = false;
    resetJoystick();
  });
  function isHeld(dir) {
    return wasd[dir] || joy[dir];
  }

  // ── On-screen joystick (touch) ──────────────────────────────────────────────
  // Spawns under the first touch point on the canvas and follows the finger
  // until release. Listeners are bound to the canvas (not the wrap) so the
  // chat log overlay doesn't trigger movement when it gets touched.
  let joystickEl = null;
  // Exposed so the top-level `blur` handler can fully reset session state
  // (activePointerId / thumb transform / .active class) — clearing only the
  // `joy` flags isn't enough because activePointerId would block the next
  // touchdown after the tab regains focus.
  let resetJoystick = () => {};
  function setupJoystick() {
    if (joystickEl) return;
    const wrap = document.querySelector('.canvas-wrap');
    if (!wrap) return;

    const base = document.createElement('div');
    base.className = 'vjoy';
    const thumb = document.createElement('div');
    thumb.className = 'vjoy-thumb';
    base.appendChild(thumb);
    wrap.appendChild(base);
    joystickEl = base;

    const TRAVEL = 50; // px from origin to fully held
    const DEADZONE = 0.30;
    let activePointerId = null;
    let originX = 0, originY = 0;

    const reset = () => {
      joy.up = joy.down = joy.left = joy.right = false;
      thumb.style.transform = 'translate(-50%, -50%)';
      base.classList.remove('active');
      activePointerId = null;
    };
    resetJoystick = () => {
      if (activePointerId !== null) {
        try { canvas.releasePointerCapture(activePointerId); } catch { /* ignore */ }
      }
      reset();
    };
    const apply = (clientX, clientY) => {
      let dx = clientX - originX, dy = clientY - originY;
      const len = Math.hypot(dx, dy);
      if (len > TRAVEL) { dx = dx / len * TRAVEL; dy = dy / len * TRAVEL; }
      thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const nx = dx / TRAVEL, ny = dy / TRAVEL;
      joy.left = nx < -DEADZONE; joy.right = nx > DEADZONE;
      joy.up   = ny < -DEADZONE; joy.down  = ny > DEADZONE;
    };
    const start = (e) => {
      if (activePointerId !== null) return;
      if (e.pointerType === 'mouse') return; // mouse users use keyboard
      activePointerId = e.pointerId;
      originX = e.clientX; originY = e.clientY;
      const wrapRect = wrap.getBoundingClientRect();
      base.style.left = (e.clientX - wrapRect.left) + 'px';
      base.style.top  = (e.clientY - wrapRect.top)  + 'px';
      base.classList.add('active');
      // Capture the pointer to the canvas so finger drags past the canvas
      // edge still deliver move/up events.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      apply(e.clientX, e.clientY);
      e.preventDefault();
    };
    const move = (e) => {
      if (e.pointerId !== activePointerId) return;
      apply(e.clientX, e.clientY);
    };
    const end = (e) => {
      if (activePointerId === null) return;
      if (e && e.pointerId !== activePointerId) return;
      try { canvas.releasePointerCapture(activePointerId); } catch { /* ignore */ }
      reset();
    };

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
  }

  // Online count poll timer. Declared up here (not inside the polling block
  // below) because `let` has TDZ — startOnlinePoll() runs immediately on
  // page load and would otherwise throw.
  let onlinePollTimer = null;

  // ── Picker state ────────────────────────────────────────────────────────────
  let selectedCharacterId = null; // 동물 worldId 또는 'human'
  let selectedPreset = null;      // human 일 때 'girl'|'boy' (카드 하이라이트 용)
  let selectedBuddyId = null;     // human 일 때 게임에 데려갈 말랑 친구
  let pendingOutfit = null;       // human 일 때 입장에 쓸 착장(항상 sanitize 완료)
  // buildPicker() 가 이 IIFE 본문 실행 중에 곧장 돌기 때문에, 피커가 만지는
  // let 상태는 전부 이 지점 위에서 선언돼야 한다(아래 joinParams TDZ 주석과
  // 같은 함정 — 실제로 buddyRowEl 을 아래 두었다가 TDZ ReferenceError 발생).
  let buddyRowEl = null;
  buildPicker();
  restoreSavedName();
  startOnlinePoll();

  // ── 착장 로컬 저장 (A단계: localStorage, 서버 저장은 B단계 §10) ─────────────
  // world_outfit = { preset, rev, outfit, hair, hairColor, hat, faceAcc }
  function loadSavedOutfit() {
    try {
      const raw = JSON.parse(localStorage.getItem('world_outfit'));
      if (!raw || typeof raw !== 'object') return null;
      const preset = window.WARDROBE.presets[raw.preset] ? raw.preset : 'girl';
      return {
        preset,
        rev: Number.isFinite(raw.rev) ? raw.rev : 0,
        ...window.WARDROBE.sanitizeOutfit(raw, preset),
      };
    } catch { return null; }
  }
  function saveOutfitLocal(preset, outfit, rev) {
    try {
      localStorage.setItem('world_outfit', JSON.stringify({ preset, rev, ...outfit }));
    } catch { /* ignore */ }
  }

  nameInput.addEventListener('input', updateJoinButton);
  joinBtn.addEventListener('click', tryJoin);
  if (leaveBtn) leaveBtn.addEventListener('click', leaveWorld);
  if (wardrobeBtn) wardrobeBtn.addEventListener('click', () => openWardrobePanel());
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !joinBtn.disabled) tryJoin();
  });

  // 게임에서 광장으로 복귀 (?from=game) 했고 닉네임·캐릭터가 둘 다 저장돼
  // 있으면 picker 를 건너뛰고 바로 입장. picker 를 즉시 숨기고 "광장에 들어가는
  // 중…" 스플래시로 대체 — WS welcome 이 ~500ms~1s 걸리는 동안 character-select
  // 가 깜빡이며 보였던 문제 해결. WS 가 실패하면 showJoinError 가 picker 를
  // 복원하므로 빈 화면에 갇히는 케이스도 없음.
  const autoEnterSplash = document.getElementById('auto-enter-splash');
  // 자동입장 splash 가 무한 로딩에 갇히지 않게 timeout fallback.
  // 1차 8초 안에 welcome 안 오면 ws 끊고 한 번 더 시도 (cold start / 첫 connection
  // race 회복). 2차도 12초 더 안 오면 showJoinError 로 picker 복구.
  let autoEnterFallbackTimer = null;
  let autoEnterRetried = false;
  const AUTO_ENTER_FIRST_TIMEOUT_MS  = 8000;
  const AUTO_ENTER_RETRY_TIMEOUT_MS  = 12000;
  function showAutoEnterSplash() {
    if (!autoEnterSplash) return;
    autoEnterSplash.classList.remove('hidden');
    joinPanel.classList.add('hidden');
    armAutoEnterTimeout(AUTO_ENTER_FIRST_TIMEOUT_MS);
  }
  function armAutoEnterTimeout(ms) {
    if (autoEnterFallbackTimer) clearTimeout(autoEnterFallbackTimer);
    autoEnterFallbackTimer = setTimeout(() => {
      autoEnterFallbackTimer = null;
      if (me) return;                       // 이미 입장 성공.
      if (!autoEnterRetried) {
        // 1차 timeout — 한 번 더 시도. WS 강제 종료 후 새로 openSocket.
        autoEnterRetried = true;
        console.warn('[world] auto-enter 1st timeout, retrying...');
        try { if (ws) ws.close(); } catch { /* ignore */ }
        ws = null;
        openSocket();
        armAutoEnterTimeout(AUTO_ENTER_RETRY_TIMEOUT_MS);
        return;
      }
      // 2차도 실패 — picker 로 복원.
      console.warn('[world] auto-enter 2nd timeout, falling back to picker');
      try { if (ws) ws.close(); } catch { /* ignore */ }
      showJoinError('광장 입장이 늦어집니다. 다시 시도해 주세요.');
    }, ms);
  }
  function hideAutoEnterSplash() {
    if (autoEnterFallbackTimer) { clearTimeout(autoEnterFallbackTimer); autoEnterFallbackTimer = null; }
    autoEnterRetried = false;
    if (autoEnterSplash) autoEnterSplash.classList.add('hidden');
  }
  (function maybeAutoRejoin() {
    try {
      const from = new URLSearchParams(window.location.search).get('from');
      if (from !== 'game') return;
      if (joinBtn.disabled) return; // 저장된 닉/캐릭터가 없으면 평소대로 picker 노출
      showAutoEnterSplash();
      // **중요**: 이 IIFE 는 아래 `let ws = null;` / `let joinParams = null;`
      // 선언 라인보다 위에서 실행되므로, 여기서 곧바로 tryJoin() 을 호출하면
      // joinParams 할당 시 TDZ ReferenceError 가 throw 되고 외부 try/catch
      // 가 silent 하게 삼킨다. 결과로 joinParams 가 null 인 채 8초 대기 후
      // retry 가 'join_world null' 을 송신해 서버가 BAD_NAME 으로 응답.
      // setTimeout 0 으로 defer 해 현재 macrotask(=이 스크립트 본문) 가 끝나
      // 모든 let 초기화가 완료된 다음에 tryJoin 이 실행되도록 한다.
      setTimeout(() => tryJoin(), 0);
    } catch { /* ignore */ }
  })();

  // ── World state ─────────────────────────────────────────────────────────────
  let ws = null;
  let joinParams = null;   // { name, characterId } — kept so we can re-join on reconnect
  let worldStarted = false; // true once the first `welcome` set up the world
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let leaving = false;     // set true while the user is intentionally leaving the world
  const MAX_RECONNECT_ATTEMPTS = 8;
  let me = null;        // { id, name, characterId, x, y, dir, moving }
  let peers = new Map(); // id -> { id, name, characterId, x, y, dir, moving }
  let zonesCatalog = []; // [{ id, gameId, title, rect, minPlayers, maxPlayers, holdMs }]
  let zoneStates = new Map(); // zoneId -> { count, ready, minPlayers, maxPlayers }
  let myZoneProgress = null;  // { zoneId, candidateSince, holdMs, ready, serverNow, clientAt }
  let bounds = { width: canvas.width, height: canvas.height };
  let lastFrameAt = 0;
  let heartbeatTimer = null;
  let rafHandle = null;
  let lastMoveSentAt = 0;
  let lastSentSnap = null; // { x, y, dir, moving } — last move we actually sent

  // Per-player ephemeral overlays. Keyed by player id.
  const bubbles = new Map();    // id -> { text, until }
  const reactions = new Map();  // id -> { glyph, until }

  // Active match proposal awaiting our response.
  let activeProposal = null; // { matchId, gameId, title, members, hostId }
  let matchCloseTimer = null; // delayed closeMatchModal handle (cancellation flow)
  let matchStartingAt = 0;    // performance.now() when 'match_starting' arrived; 0 = not in transition

  // ── Picker UI ───────────────────────────────────────────────────────────────
  // 카드 식별은 pickId — 동물은 worldId, 사람 프리셋은 'human:girl'/'human:boy'.
  // (worldId 만으로 비교하면 human 카드 2장이 동시에 하이라이트된다.)
  function buildPicker() {
    if (!Array.isArray(window.CHARACTERS)) {
      joinStatus.textContent = '캐릭터 카탈로그를 불러올 수 없습니다.';
      joinStatus.classList.add('error');
      return;
    }
    picker.innerHTML = '';
    // 사람 프리셋 2카드를 맨 앞에 — 꾸미기가 주인공(§3). 선택 결과는
    // characterId:'human' + 프리셋 기본(또는 마지막 저장) 착장.
    const W = window.WARDROBE;
    if (W && W.presets) {
      for (const presetId of Object.keys(W.presets)) {
        const preset = W.presets[presetId];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'character-card human-card';
        btn.dataset.pickId = `human:${presetId}`;
        btn.innerHTML = `
          <div class="preview" aria-hidden="true">${preset.emoji || '🧒'}</div>
          <span class="label">${escapeHtml(preset.label)}</span>
          <span class="sub-label">꾸미기 가능</span>
        `;
        // 프리뷰: 프리셋 기본 착장의 정면 셀을 합성해 카드에 그린다(완성 전엔 emoji).
        paintHumanCardPreview(btn.querySelector('.preview'), W.sanitizeOutfit(null, presetId));
        btn.addEventListener('click', () => selectHumanPreset(presetId));
        picker.appendChild(btn);
      }
    }
    for (const c of window.CHARACTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-card';
      btn.dataset.pickId = c.worldId;
      const preview = c.portrait
        ? `<img class="preview-img" src="${c.portrait}" alt="" />`
        : characterEmoji(c.worldId);
      btn.innerHTML = `
        <div class="preview" aria-hidden="true">${preview}</div>
        <span class="label">${escapeHtml(c.label)}</span>
      `;
      btn.addEventListener('click', () => selectCharacter(c.worldId));
      picker.appendChild(btn);
    }
    ensureBuddyRow();
  }

  function paintHumanCardPreview(previewEl, outfit) {
    if (!previewEl) return;
    ensureHumanSheet(outfit).promise.then((e) => {
      if (!e.ready || !previewEl.isConnected) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 96;
      const c = canvas.getContext('2d');
      const cell = HUMAN_SHEET_SIZE / 3;
      c.drawImage(e.img, 0, 0, cell, cell, 0, 0, 96, 96);
      canvas.className = 'preview-img';
      previewEl.replaceChildren(canvas);
    });
  }

  function highlightPickedCard(pickId) {
    for (const card of picker.querySelectorAll('.character-card')) {
      card.classList.toggle('selected', card.dataset.pickId === pickId);
    }
  }

  function selectCharacter(worldId) {
    selectedCharacterId = worldId;
    selectedPreset = null;
    pendingOutfit = null;
    highlightPickedCard(worldId);
    try { localStorage.setItem('world_character', worldId); } catch { /* ignore */ }
    syncBuddyRow();
    updateJoinButton();
  }

  /* 사람 프리셋 카드 선택(§3): 마지막 저장 착장이 같은 프리셋이면 그대로 복원,
   * 다른 프리셋 카드를 눌렀으면 그 프리셋의 기본 헤어+기본 코디를 적용(프리셋 전환).
   */
  function selectHumanPreset(presetId) {
    selectedCharacterId = HUMAN_ID;
    selectedPreset = presetId;
    const saved = loadSavedOutfit();
    if (saved && saved.preset === presetId) {
      pendingOutfit = window.WARDROBE.sanitizeOutfit(saved, presetId);
    } else {
      pendingOutfit = window.WARDROBE.sanitizeOutfit(null, presetId);
      saveOutfitLocal(presetId, pendingOutfit, saved ? saved.rev : 0);
    }
    highlightPickedCard(`human:${presetId}`);
    try { localStorage.setItem('world_character', HUMAN_ID); } catch { /* ignore */ }
    // 말랑 친구(게임 파트너) — 저장값 복원, 없으면 랜덤 기본(§2).
    if (!selectedBuddyId) {
      let savedBuddy = null;
      try { savedBuddy = localStorage.getItem('world_game_buddy'); } catch { /* ignore */ }
      const valid = Array.isArray(window.CHARACTERS)
        && window.CHARACTERS.some((c) => c.worldId === savedBuddy);
      selectBuddy(valid ? savedBuddy
        : window.CHARACTERS[Math.floor(Math.random() * window.CHARACTERS.length)].worldId);
    }
    syncBuddyRow();
    updateJoinButton();
  }

  // ── 말랑 친구 서브 선택 (human 전용, §2 역할 분리) ──────────────────────────
  // buddyRowEl 선언은 피커 상태 블록 상단에 있다(TDZ 주의).
  function ensureBuddyRow() {
    if (buddyRowEl || !picker.parentElement) return;
    const row = document.createElement('div');
    row.id = 'buddy-select';
    row.className = 'buddy-select hidden';
    row.innerHTML = `
      <span class="buddy-label">🎮 게임에 데려갈 말랑 친구</span>
      <div class="buddy-cards"></div>
    `;
    const cards = row.querySelector('.buddy-cards');
    for (const c of (window.CHARACTERS || [])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'buddy-card';
      b.dataset.worldId = c.worldId;
      b.title = c.label;
      b.innerHTML = c.portrait
        ? `<img src="${c.portrait}" alt="${escapeHtml(c.label)}" />`
        : characterEmoji(c.worldId);
      b.addEventListener('click', () => selectBuddy(c.worldId));
      cards.appendChild(b);
    }
    picker.parentElement.appendChild(row);
    buddyRowEl = row;
  }

  function selectBuddy(worldId) {
    selectedBuddyId = worldId;
    try { localStorage.setItem('world_game_buddy', worldId); } catch { /* ignore */ }
    if (buddyRowEl) {
      for (const b of buddyRowEl.querySelectorAll('.buddy-card')) {
        b.classList.toggle('selected', b.dataset.worldId === worldId);
      }
    }
  }

  function syncBuddyRow() {
    if (buddyRowEl) buddyRowEl.classList.toggle('hidden', selectedCharacterId !== HUMAN_ID);
  }

  function updateJoinButton() {
    const okName = nameInput.value.trim().length > 0;
    const okChar = !!selectedCharacterId;
    joinBtn.disabled = !(okName && okChar);
  }

  function restoreSavedName() {
    try {
      const saved = localStorage.getItem('world_name');
      if (saved) nameInput.value = saved;
      const savedChar = localStorage.getItem('world_character');
      if (savedChar === HUMAN_ID) {
        // 완전 첫 접속이 아닌 경우에만 복원 — 저장 착장의 프리셋 카드로.
        const savedOutfit = loadSavedOutfit();
        selectHumanPreset(savedOutfit ? savedOutfit.preset : 'girl');
      } else if (savedChar) {
        selectCharacter(savedChar);
      }
      // 완전 첫 접속(저장 없음)은 무선택 — 남/녀를 반드시 직접 고른다(§3 확정지시).
    } catch { /* ignore */ }
    updateJoinButton();
  }

  // ── WS connect ──────────────────────────────────────────────────────────────
  function tryJoin() {
    if (joinBtn.disabled) return;
    joinBtn.disabled = true;
    joinStatus.classList.remove('error');
    joinStatus.textContent = '연결 중...';

    const name = nameInput.value.trim().slice(0, 16);
    try { localStorage.setItem('world_name', name); } catch { /* ignore */ }

    // entryFrom='game' 일 때 서버가 광장 가운데 랜덤 위치로 스폰. 한 번
    // 소비하면 URL에서 제거해서 다음 leave→rejoin 때 다시 랜덤되지 않게 함.
    const entryFrom = (new URLSearchParams(window.location.search).get('from')) || null;
    if (entryFrom === 'game') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('from');
        history.replaceState(null, '', url.toString());
      } catch { /* ignore */ }
    }
    joinParams = { name, characterId: selectedCharacterId, entryFrom };
    if (selectedCharacterId === HUMAN_ID) {
      // 사람 아바타(§11): 착장 + 말랑 친구 + 카탈로그 버전. pendingOutfit 은
      // 피커에서 항상 채워지지만, 방어적으로 저장값→프리셋 기본 순서로 폴백.
      const saved = loadSavedOutfit();
      const preset = selectedPreset || (saved ? saved.preset : 'girl');
      joinParams.outfit = pendingOutfit || window.WARDROBE.sanitizeOutfit(saved, preset);
      joinParams.gameBuddyId = selectedBuddyId;
      joinParams.catalogVersion = window.WARDROBE.catalogVersion;
      myOutfitRev = Math.max(myOutfitRev, saved ? saved.rev : 0);
    }
    openSocket();
  }

  function openSocket() {
    const base = (window.WORKER_URL || window.location.origin).replace(/^http/, 'ws');
    const url = `${base}/api/world/${encodeURIComponent(LOUNGE_ID)}`;
    let socket;

    try {
      socket = new WebSocket(url);
      ws = socket;
    } catch (err) {
      if (worldStarted) scheduleReconnect();
      else showJoinError(`연결 실패: ${err.message}`);
      return;
    }

    socket.addEventListener('open', () => {
      if (socket !== ws) return;
      send({ t: 'join_world', d: joinParams });
    });
    socket.addEventListener('message', (ev) => {
      if (socket !== ws) return;
      onMessage(ev);
    });
    socket.addEventListener('close', () => {
      if (socket !== ws) return;
      onClose();
    });
    socket.addEventListener('error', () => {
      if (socket !== ws) return;
      // The `close` event fires right after and drives reconnect; only the
      // pre-join attempt needs to surface an error to the join panel.
      if (!worldStarted) showJoinError('연결 오류가 발생했습니다.');
    });
  }

  // Auto-reconnect: if the socket drops after we're already in the world, keep
  // the render loop alive and silently re-connect + re-join with backoff.
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectAttempts += 1;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      connStatus.textContent = '연결 끊김 — 새로고침 해주세요';
      connStatus.classList.add('bad');
      return;
    }
    connStatus.textContent = `재접속 중... (${reconnectAttempts})`;
    const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 8000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  // Return to the character picker. Closes the socket cleanly, clears
  // session state, and re-shows the join panel without tearing down the
  // one-time wiring (chat form, reaction bar, render loop, joystick) so
  // re-joining is instant.
  function leaveWorld() {
    leaving = true;
    stopHeartbeat();
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }

    me = null;
    peers = new Map();
    bubbles.clear();
    reactions.clear();
    myZoneProgress = null;
    zoneStates = new Map();
    zonesCatalog = [];
    inLabBooth = false;
    closeLabPanel();
    inMirrorBooth = false;
    closeWardrobePanel();
    if (wardrobeBtn) wardrobeBtn.classList.add('hidden');
    if (activeProposal) closeMatchModal();
    if (chatLogBody) chatLogBody.innerHTML = '';

    worldPanel.classList.add('hidden');
    joinPanel.classList.remove('hidden');
    joinStatus.textContent = '';
    joinStatus.classList.remove('error');
    setConnStatus(false);
    updateJoinButton();
    startOnlinePoll();
  }

  // ── Online count polling ──────────────────────────────────────────────────
  // Anonymous read-only GET to /api/world/:loungeId/state. Refreshes the
  // join screen badge ("지금 광장에 N명이 모여 있어요") every 8s while the
  // user is still on the join panel. The timer state is declared up near the
  // module-level state (search "onlinePollTimer") because startOnlinePoll()
  // runs immediately on first paint, before this block.
  async function refreshOnlineCount() {
    if (!onlineCountEl) return;
    try {
      const base = window.WORKER_URL || window.location.origin;
      const url = `${base}/api/world/${encodeURIComponent(LOUNGE_ID)}/state`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const n = Number.isFinite(data.online) ? data.online : 0;
      if (n > 0) {
        onlineCountEl.textContent = `지금 광장에 ${n}명이 모여 있어요`;
        onlineCountEl.classList.remove('is-empty');
      } else {
        onlineCountEl.textContent = '아직 아무도 없어요. 가장 먼저 입장해 보세요!';
        onlineCountEl.classList.add('is-empty');
      }
    } catch {
      // 네트워크 일시 오류는 조용히 무시. 마지막 표시 유지.
    }
  }
  function startOnlinePoll() {
    if (onlinePollTimer) return;
    refreshOnlineCount();
    onlinePollTimer = setInterval(refreshOnlineCount, 8000);
  }
  function stopOnlinePoll() {
    if (onlinePollTimer) {
      clearInterval(onlinePollTimer);
      onlinePollTimer = null;
    }
  }

  function showJoinError(msg) {
    // 자동 입장 등으로 joinPanel 이 숨겨진 상태에서 실패하면 사용자가
    // 빈 화면에 갇히므로, 무조건 join 패널을 복원한다. (자동 입장 스플래시도
    // 함께 내려서 회전 스피너가 picker 와 같이 보이지 않도록.)
    hideAutoEnterSplash();
    joinPanel.classList.remove('hidden');
    worldPanel.classList.add('hidden');
    joinStatus.textContent = msg;
    joinStatus.classList.add('error');
    joinBtn.disabled = false;
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
      ws = null;
    }
  }

  function onMessage(ev) {
    let env;
    try { env = JSON.parse(ev.data); } catch { return; }
    if (!env || env.v !== PROTOCOL_VERSION) return;

    switch (env.t) {
      case 'welcome': return handleWelcome(env.d);
      case 'error': return handleServerError(env.d);
      case 'player_joined': return handlePlayerJoined(env.d);
      case 'player_left': return handlePlayerLeft(env.d);
      case 'tick': return handleTick(env.d);
      case 'chat': return handleChat(env.d);
      case 'reaction': return handleReaction(env.d);
      case 'outfit_change': return handleOutfitChange(env.d);
      case 'zone_state': return handleZoneState(env.d);
      case 'zone_progress': return handleZoneProgress(env.d);
      case 'match_proposal': return handleMatchProposal(env.d);
      case 'match_members_updated': return handleMatchMembersUpdated(env.d);
      case 'match_starting': return handleMatchStarting(env.d);
      case 'match_unstarting': return handleMatchUnstarting(env.d);
      case 'match_confirmed': return handleMatchConfirmed(env.d);
      case 'match_cancelled': return handleMatchCancelled(env.d);
      case 'go_to_game': return handleGoToGame(env.d);
      default:
        // Quietly ignore unknown types so future server messages don't break us.
        return;
    }
  }

  function handleWelcome(d) {
    if (!d || !d.you) return;
    me = { ...d.you };
    bounds = d.bounds || bounds;
    canvas.width = bounds.width;
    canvas.height = bounds.height;

    peers = new Map();
    if (Array.isArray(d.players)) {
      for (const p of d.players) {
        if (p && p.id && p.id !== me.id) peers.set(p.id, { ...p });
      }
    }

    zonesCatalog = Array.isArray(d.zones) ? d.zones : [];
    zoneStates = new Map(zonesCatalog.map((z) => [z.id, {
      count: numOr(z.count, 0),
      ready: numOr(z.ready, 0),
      minPlayers: z.minPlayers,
      maxPlayers: z.maxPlayers,
    }]));
    myZoneProgress = null;

    setConnStatus(true);
    reconnectAttempts = 0;
    startHeartbeat();

    // Always show the world panel — handles both first join and re-join
    // after the user returned to the character picker.
    joinPanel.classList.add('hidden');
    hideAutoEnterSplash();
    worldPanel.classList.remove('hidden');

    // 꾸미기 진입 버튼은 사람 아바타 전용(동물은 꾸미기 비활성, §2).
    if (wardrobeBtn) wardrobeBtn.classList.toggle('hidden', me.characterId !== HUMAN_ID);

    // One-time wiring — guarded so re-joins don't double-bind listeners
    // or spin up a second render loop.
    if (!worldStarted) {
      worldStarted = true;
      stopOnlinePoll();
      buildReactionBar();
      bindChatForm();
      bindMatchModal();
      setupJoystick();
      startRenderLoop();
    }

    // Server replays recent (≤2h) chat history on every welcome — render it
    // so reconnect/re-join shows the conversation that happened.
    renderChatHistory(d.chat);

    // 게임 복귀로 입장한 경우 캐릭터 위치에 등장 이펙트 한 번.
    if (joinParams && joinParams.entryFrom === 'game' && me) {
      pushSpawnEffect(me.x, me.y);
      // 이번 입장에만 트리거. 재접속(welcome 다시 와도) 효과 다시 안 돌게.
      joinParams = { ...joinParams, entryFrom: null };
    }
  }

  function buildReactionBar() {
    if (reactionBar.childElementCount > 0) return;
    for (const r of REACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.key = r.key;
      btn.textContent = r.glyph;
      btn.setAttribute('aria-label', `리액션 ${r.glyph}`);
      btn.addEventListener('click', () => sendReaction(r.key));
      reactionBar.appendChild(btn);
    }
  }

  function bindMatchModal() {
    matchAcceptBtn.addEventListener('click', sendMatchStart);
    matchDeclineBtn.addEventListener('click', sendMatchLeave);
  }

  function bindChatForm() {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value;
      if (!text.trim()) return;
      send({ t: 'chat', d: { text } });
      chatInput.value = '';
    });
  }

  function sendReaction(key) {
    if (!REACTION_GLYPHS[key]) return;
    send({ t: 'reaction', d: { emoji: key } });
  }

  function handlePlayerJoined(d) {
    const p = d?.player;
    if (!p || !p.id || (me && p.id === me.id)) return;
    peers.set(p.id, { ...p });
  }

  function handlePlayerLeft(d) {
    if (!d?.id) return;
    peers.delete(d.id);
    bubbles.delete(d.id);
    reactions.delete(d.id);
  }

  function handleTick(d) {
    const updates = Array.isArray(d?.players) ? d.players : [];
    for (const u of updates) {
      if (!u || !u.id) continue;
      // Server may send a correction for self when it rejects a move.
      if (me && u.id === me.id) {
        me.x = numOr(u.x, me.x);
        me.y = numOr(u.y, me.y);
        me.dir = u.dir || me.dir;
        me.moving = !!u.moving;
        continue;
      }
      const existing = peers.get(u.id);
      if (existing) {
        existing.x = numOr(u.x, existing.x);
        existing.y = numOr(u.y, existing.y);
        existing.dir = u.dir || existing.dir;
        existing.moving = !!u.moving;
      }
      // If we receive a tick for an unknown id, it'll arrive via player_joined
      // in normal flow. Ignore otherwise — no point creating a phantom.
    }
  }

  function numOr(v, fallback) { return Number.isFinite(v) ? v : fallback; }

  function handleChat(d) {
    if (!d?.id || typeof d.text !== 'string') return;
    const text = d.text.slice(0, 120);
    // Instant bubble above the head — fades out after a few seconds.
    bubbles.set(d.id, { text, until: performance.now() + CHAT_BUBBLE_MS });
    // Persistent log on the side — stays visible.
    appendChatLog(d.id, d.name || '익명', text, !!(me && d.id === me.id));
  }

  function appendChatLog(id, name, text, isYou) {
    if (!chatLogBody) return;
    const line = document.createElement('div');
    line.className = isYou ? 'chat-line me' : 'chat-line';
    const who = document.createElement('b');
    who.textContent = name;
    who.style.color = nameColor(name);
    line.appendChild(who);
    line.appendChild(document.createTextNode(text));
    const nearBottom = chatLogBody.scrollHeight - chatLogBody.scrollTop - chatLogBody.clientHeight < 40;
    chatLogBody.appendChild(line);
    // Only auto-scroll if the user was already near the bottom; otherwise they
    // are reading older messages and shouldn't be yanked.
    if (nearBottom) chatLogBody.scrollTop = chatLogBody.scrollHeight;
  }

  function renderChatHistory(entries) {
    if (!chatLogBody) return;
    chatLogBody.innerHTML = '';
    if (!Array.isArray(entries)) return;
    for (const m of entries) {
      if (!m || typeof m.text !== 'string') continue;
      appendChatLog(m.id, m.name || '익명', m.text, !!(me && m.id === me.id));
    }
    chatLogBody.scrollTop = chatLogBody.scrollHeight;
  }

  // Collapse toggle — persisted across sessions in localStorage.
  const CHAT_COLLAPSED_KEY = 'tenten_chatCollapsed';
  function setChatCollapsed(collapsed) {
    if (!chatLogEl) return;
    chatLogEl.classList.toggle('collapsed', !!collapsed);
    if (chatLogToggle) {
      chatLogToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      chatLogToggle.setAttribute('aria-label', collapsed ? '채팅 펼치기' : '채팅 접기');
    }
    try { localStorage.setItem(CHAT_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }
  if (chatLogToggle) {
    chatLogToggle.addEventListener('click', () => {
      setChatCollapsed(!chatLogEl.classList.contains('collapsed'));
    });
  }
  try {
    if (localStorage.getItem(CHAT_COLLAPSED_KEY) === '1') setChatCollapsed(true);
  } catch { /* ignore */ }

  function handleReaction(d) {
    if (!d?.id || !REACTION_GLYPHS[d.emoji]) return;
    reactions.set(d.id, { glyph: REACTION_GLYPHS[d.emoji], until: performance.now() + REACTION_MS });
  }

  // ── 착장 교체 프로토콜 (§11) ─────────────────────────────────────────────
  let myOutfitRev = 0; // 단조 증가 — 서버가 역순 도착을 걸러낼 수 있게 한다.

  /* 서버 검증을 거친 착장 브로드캐스트. 본인 echo 는 revision 으로 dedupe 되고
   * (낙관 적용 시 같은 값을 미리 설정), 갈아입은 피어 위엔 반짝임 이펙트.
   */
  function handleOutfitChange(d) {
    if (!d?.id || !d.outfit) return;
    const p = (me && d.id === me.id) ? me : peers.get(d.id);
    if (!p) return;
    const rev = numOr(d.revision, 0);
    if (rev <= (p._outfitRev || 0)) return;
    p._outfitRev = rev;
    p.outfit = d.outfit; // 참조 교체 — getHumanSprite 가 감지해 재합성(§5-9)
    pushSpawnEffect(p.x, p.y);
  }

  /* 꾸미기 패널 저장(§7): 낙관 적용 + localStorage + joinParams 갱신(재접속 시
   * 구버전 착장으로 되돌아가는 버그 방지) + 서버 송신. outfit 은 호출 전에
   * sanitize 되어 있어야 한다.
   */
  function sendOutfitChange(outfit, preset) {
    if (!me || me.characterId !== HUMAN_ID) return;
    myOutfitRev += 1;
    me.outfit = outfit;
    me._outfitRev = myOutfitRev;
    saveOutfitLocal(preset, outfit, myOutfitRev);
    if (joinParams) joinParams = { ...joinParams, outfit };
    pendingOutfit = outfit;
    selectedPreset = preset;
    send({ t: 'outfit_change', d: { outfit, revision: myOutfitRev } });
    pushSpawnEffect(me.x, me.y);
  }

  function handleZoneState(d) {
    if (!d?.zoneId) return;
    zoneStates.set(d.zoneId, {
      count: numOr(d.count, 0),
      ready: numOr(d.ready, 0),
      minPlayers: numOr(d.minPlayers, 1),
      maxPlayers: numOr(d.maxPlayers, 99),
    });
    // 실험실 매칭 풀(lab:*) 대기 인원이 바뀌면 패널의 '같이하기 (대기 N)' 갱신.
    if (typeof d.zoneId === 'string' && d.zoneId.startsWith('lab:')
        && labModal && !labModal.classList.contains('hidden')) {
      renderLabList();
    }
  }

  // Build a map worldId -> portrait URL so the modal members list can show
  // each player's profile image instead of a fallback emoji.
  function characterPortrait(worldId) {
    const list = Array.isArray(window.CHARACTERS) ? window.CHARACTERS : [];
    const meta = list.find((c) => c.worldId === worldId);
    return meta?.portrait || null;
  }

  function handleMatchProposal(d) {
    if (!d?.matchId || !Array.isArray(d.players)) return;
    activeProposal = {
      matchId: d.matchId,
      gameId: d.gameId,
      title: d.title || d.gameId,
      zoneId: d.zoneId,
      hostId: d.hostId,
      members: d.players,
      minPlayers: numOr(d.minPlayers, 1),
      maxPlayers: numOr(d.maxPlayers, 99),
    };
    // 실험실 '같이하기' 로 들어온 매칭이면 실험실 패널을 닫고 매칭 모달에 넘긴다.
    closeLabPanel();
    openMatchModal();
  }

  function handleMatchMembersUpdated(d) {
    if (!d?.matchId || !activeProposal || activeProposal.matchId !== d.matchId) return;
    activeProposal.hostId = d.hostId;
    activeProposal.members = Array.isArray(d.players) ? d.players : [];
    if (typeof d.minPlayers === 'number') activeProposal.minPlayers = d.minPlayers;
    if (typeof d.maxPlayers === 'number') activeProposal.maxPlayers = d.maxPlayers;
    renderMatchMembers();
    refreshMatchActions();
  }

  function handleMatchConfirmed(d) {
    if (!d?.matchId) return;
    if (!activeProposal || activeProposal.matchId !== d.matchId) return;
    matchStatus.textContent = '확정됨 — 잠시 후 게임이 시작됩니다.';
    matchAcceptBtn.disabled = true;
    matchDeclineBtn.disabled = true;
    // go_to_game arrives separately and triggers the redirect.
  }

  /* 누군가 "시작" 을 눌러 서버가 first-wins 락을 잡은 직후. modal-card 가
   * .is-starting 으로 바뀌면서 멤버 목록·액션이 사라지고 starter 의
   * 캐릭터 + 안내 문구가 부드럽게 떠오른다. go_to_game 이 따라 오면
   * 게임 페이지로 이동, match_unstarting / match_cancelled 가 오면 복귀.
   */
  function handleMatchStarting(d) {
    if (!d?.matchId) return;
    if (!activeProposal || activeProposal.matchId !== d.matchId) return;
    const starter = d.startedBy || {};
    const who = starter.name || '누군가';
    const title = activeProposal.title || '게임';

    // Starter 의 캐릭터 portrait (있으면 이미지, 없으면 이모지).
    const portraitSrc = characterPortrait(starter.characterId);
    starterPortrait.innerHTML = '';
    if (portraitSrc) {
      const img = document.createElement('img');
      img.src = portraitSrc;
      img.alt = '';
      starterPortrait.appendChild(img);
    } else {
      starterPortrait.textContent = characterEmoji(starter.characterId);
    }
    starterText.innerHTML = `<strong>${escapeHtml(who)}</strong>님이 모두를 <strong>${escapeHtml(title)}</strong>(으)로 데려갑니다<span class="arrow">→</span>`;

    matchModalCard.classList.add('is-starting');
    matchStartingView.setAttribute('aria-hidden', 'false');
    matchAcceptBtn.disabled = true;
    matchDeclineBtn.disabled = true;
    // is-starting 전환 시 열린 GIF가 남지 않도록 접기.
    matchPreview.classList.add('hidden');
    matchPreviewToggle.classList.add('hidden');

    // go_to_game 이 너무 빨리 도착해도 최소 700ms 는 화면을 잡아둔다.
    // 그래야 트랜지션 의도가 인지된다.
    matchStartingAt = performance.now();
  }

  /* 서버가 락을 잡았다가 min 재검증 실패로 되돌렸을 때. 트랜지션 풀고
   * 평시 모달로 복귀.
   */
  function handleMatchUnstarting(d) {
    if (!d?.matchId) return;
    if (!activeProposal || activeProposal.matchId !== d.matchId) return;
    matchModalCard.classList.remove('is-starting');
    matchStartingView.setAttribute('aria-hidden', 'true');
    matchStartingAt = 0;
    // 시작 취소(unstarting) 시 토글 버튼을 기본 접힘 상태로 복원.
    const gif = activeProposal.gameId && BOOTH_PREVIEWS[activeProposal.gameId];
    if (gif) {
      matchPreview.classList.add('hidden');
      matchPreviewToggle.textContent = '게임 미리보기 ▸';
      matchPreviewToggle.setAttribute('aria-expanded', 'false');
      matchPreviewToggle.classList.remove('hidden');
    }
    refreshMatchActions();
  }

  function handleGoToGame(d) {
    if (!d?.url || typeof d.url !== 'string') return;
    // Hardened same-origin check. `startsWith('/')` is NOT enough — '//evil.com'
    // and '/\evil.com' both pass that and would navigate off-origin. Parse the
    // URL and verify both the origin and that it's a known game prototype path.
    let target;
    try { target = new URL(d.url, window.location.origin); } catch { return; }
    if (target.origin !== window.location.origin) return;
    if (!target.pathname.startsWith('/games/')) return;

    const navigate = () => {
      stopHeartbeat();
      if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
      if (ws) { try { ws.close(); } catch { /* ignore */ } }
      window.location.href = target.pathname + target.search + target.hash;
    };

    // 트랜지션 의도를 인지할 수 있게 최소 700ms 는 잡아둔다 (Gemini 권장).
    // 서버 응답이 느리면 자연스럽게 그 시간이 다 흘러간 뒤일 수 있고, 그
    // 경우엔 즉시 이동한다.
    const MIN_TRANSITION_MS = 700;
    const elapsed = matchStartingAt ? performance.now() - matchStartingAt : MIN_TRANSITION_MS;
    const remain = Math.max(0, MIN_TRANSITION_MS - elapsed);
    if (remain > 0) {
      setTimeout(navigate, remain);
    } else {
      navigate();
    }
  }

  function handleMatchCancelled(d) {
    if (!d?.matchId) return;
    if (!activeProposal || activeProposal.matchId !== d.matchId) return;
    matchStatus.textContent = '매칭이 취소되었습니다.';
    matchAcceptBtn.disabled = true;
    matchDeclineBtn.disabled = true;
    if (matchCloseTimer) clearTimeout(matchCloseTimer);
    matchCloseTimer = setTimeout(() => { matchCloseTimer = null; closeMatchModal(); }, 1200);
  }

  function openMatchModal() {
    if (!activeProposal) return;
    // A pending cancel-close from a previous proposal must not fire now.
    if (matchCloseTimer) { clearTimeout(matchCloseTimer); matchCloseTimer = null; }
    if (joystickEl) joystickEl.style.visibility = 'hidden';
    matchTitle.textContent = activeProposal.title;
    renderMatchMembers();
    refreshMatchActions();
    // pre-match(참가 준비) 로 떠 있던 같은 패널이 그대로 이어받는다 — 멤버·버튼 노출.
    matchModalCard.classList.remove('is-prematch');
    panelZone = null;
    // 새 modal 은 항상 평시 상태로 — 이전 트랜지션 잔재 제거.
    matchModalCard.classList.remove('is-starting');
    matchStartingView.setAttribute('aria-hidden', 'true');
    matchStartingAt = 0;
    // 게임 프리뷰 — 토글 버튼으로 열어볼 수 있게. 기본은 숨김.
    const previewGif = activeProposal.gameId && BOOTH_PREVIEWS[activeProposal.gameId];
    if (previewGif) {
      matchPreview.src = previewGif;
      matchPreview.classList.add('hidden');
      matchPreviewToggle.textContent = '게임 미리보기 ▸';
      matchPreviewToggle.setAttribute('aria-expanded', 'false');
      matchPreviewToggle.classList.remove('hidden');
    } else {
      matchPreview.removeAttribute('src');
      matchPreview.classList.add('hidden');
      matchPreviewToggle.classList.add('hidden');
    }
    matchModal.classList.remove('hidden');
    matchModal.setAttribute('aria-hidden', 'false');
  }

  function closeMatchModal() {
    matchModal.classList.add('hidden');
    matchModal.setAttribute('aria-hidden', 'true');
    if (matchCloseTimer) { clearTimeout(matchCloseTimer); matchCloseTimer = null; }
    if (joystickEl) joystickEl.style.visibility = '';
    matchModalCard.classList.remove('is-starting');
    matchModalCard.classList.remove('is-prematch');
    matchStartingView.setAttribute('aria-hidden', 'true');
    matchStartingAt = 0;
    matchPreview.removeAttribute('src');
    matchPreview.classList.add('hidden');
    matchPreviewToggle.classList.add('hidden');
    matchPreviewToggle.setAttribute('aria-expanded', 'false');
    matchPreviewToggle.textContent = '게임 미리보기 ▸';
    activeProposal = null;
    panelZone = null;
  }

  function renderMatchMembers() {
    if (!activeProposal) return;
    matchMembers.innerHTML = '';
    for (const m of activeProposal.members) {
      const li = document.createElement('li');
      if (me && m.id === me.id) li.classList.add('is-self');
      if (m.id === activeProposal.hostId) li.classList.add('is-host');
      li.dataset.id = m.id;

      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      const src = characterPortrait(m.characterId);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        glyph.appendChild(img);
      } else {
        glyph.textContent = characterEmoji(m.characterId);
      }

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m.name || '익명';
      name.style.color = nameColor(m.name);

      li.append(glyph, name);
      if (m.id === activeProposal.hostId) {
        const badge = document.createElement('span');
        badge.className = 'host-badge';
        badge.textContent = '방장';
        li.appendChild(badge);
      }
      matchMembers.appendChild(li);
    }
  }

  function refreshMatchActions() {
    if (!activeProposal) return;
    // hostId 는 이제 권한 필드가 아니라 표시용 (leader 배지). seated 멤버
    // 누구나 시작 가능.
    const isMember = !!(me && Array.isArray(activeProposal.members)
      && activeProposal.members.some((m) => m.id === me.id));
    const min = activeProposal.minPlayers || 1;
    const count = activeProposal.members.length;
    const enough = count >= min;

    matchAcceptBtn.style.display = isMember ? '' : 'none';
    matchAcceptBtn.disabled = !enough;
    matchAcceptBtn.textContent = enough
      ? `시작 (${count}명)`
      : `최소 ${min}명 필요 (${count}/${min})`;
    matchDeclineBtn.disabled = false;
    matchDeclineBtn.textContent = '나가기';

    matchStatus.textContent = enough
      ? '준비되면 누구나 시작을 누를 수 있어요.'
      : `${min}명이 모이면 시작할 수 있어요.`;
  }

  function sendMatchStart() {
    if (!activeProposal) return;
    // seated 멤버인지 확인 (자기 자신이 members 배열에 있는지)
    const isMember = !!(me && Array.isArray(activeProposal.members)
      && activeProposal.members.some((m) => m.id === me.id));
    if (!isMember) return;
    matchAcceptBtn.disabled = true;
    matchStatus.textContent = '시작 중...';
    send({ t: 'match_start', d: { matchId: activeProposal.matchId } });
  }

  function sendMatchLeave() {
    if (!activeProposal) {
      closeMatchModal();
      return;
    }
    matchDeclineBtn.disabled = true;
    matchStatus.textContent = '나가는 중...';
    send({ t: 'match_leave', d: { matchId: activeProposal.matchId } });
    // Close immediately for snappy feedback. Optimistically clear zone progress
    // too — the server turns us to ROAM on leave (no re-candidacy until we move
    // again), so without this the render loop would reopen the pre-match panel
    // for one frame before server's zone_progress(null) arrives.
    myZoneProgress = null;
    closeMatchModal();
  }

  function handleZoneProgress(d) {
    if (!d || !d.zoneId) {
      myZoneProgress = null;
      // Walking out of a zone (or being kicked back to ROAM) closes any open
      // lobby modal so the player isn't stranded looking at a ghost proposal.
      if (activeProposal) closeMatchModal();
      return;
    }
    // If we somehow ended up in a different zone than the proposal we have
    // a modal open for, that proposal is no longer ours — drop it.
    if (activeProposal && activeProposal.zoneId && d.zoneId !== activeProposal.zoneId) {
      closeMatchModal();
    }
    myZoneProgress = {
      zoneId: d.zoneId,
      candidateSince: numOr(d.candidateSince, Date.now()),
      holdMs: numOr(d.holdMs, 3000),
      ready: !!d.ready,
      serverNow: numOr(d.serverNow, Date.now()),
      clientAt: performance.now(),
    };
  }

  // 하단 매칭 패널 동기화. 렌더 루프에서 매 프레임 호출(변경 없으면 빠르게 반환).
  // 부스(프리뷰 있는 게임)에 올라선 순간부터 패널을 pre-match(참가 준비) 로 띄우고,
  // 매칭 제안이 오면 openMatchModal 이 같은 패널을 멤버+시작 버튼으로 이어받는다.
  // 부스를 벗어나면 닫는다. 위→아래로 위치가 바뀌던 기존 상단 프리뷰는 폐지.
  function syncMatchPanel() {
    // 실제 매칭 제안/시작 모달이 떠 있으면 그쪽이 패널을 점유한다 — 건드리지 않는다.
    if (activeProposal) { panelZone = null; return; }
    const zoneId = myZoneProgress ? myZoneProgress.zoneId : null;
    // 프리뷰가 준비된 게임에서만 pre-match 패널을 띄운다(없으면 기존처럼 제안 시점에).
    const target = (zoneId && BOOTH_PREVIEWS[zoneId]) ? zoneId : null;
    if (!target) {
      if (panelZone !== null) { closeMatchModal(); panelZone = null; }
      return;
    }
    if (panelZone !== target) {
      openZonePanel(target);
      panelZone = target;
    }
    updateZonePanelCountdown();
  }

  // 부스에 올라선 동안 하단 패널을 pre-match 상태로 연다. 멤버 목록·시작 버튼은
  // 숨기고(프리뷰 + 카운트다운만), 제안이 오면 openMatchModal 이 이어받는다.
  function openZonePanel(zoneId) {
    if (matchCloseTimer) { clearTimeout(matchCloseTimer); matchCloseTimer = null; }
    const zone = zonesCatalog.find((z) => z.id === zoneId);
    matchTitle.textContent = zone ? zone.title : '';
    matchMembers.innerHTML = '';
    matchModalCard.classList.add('is-prematch');
    matchModalCard.classList.remove('is-starting');
    matchStartingView.setAttribute('aria-hidden', 'true');
    matchStartingAt = 0;
    lastPanelStatus = '';  // 새 패널 — 다음 카운트다운 갱신 때 무조건 한 번 쓴다.
    // pre-match 단계에선 프리뷰 없이 제목+카운트다운만. 프리뷰는 match_proposal 이후.
    matchPreview.removeAttribute('src');
    matchPreview.classList.add('hidden');
    matchPreviewToggle.classList.add('hidden');
    matchModal.classList.remove('hidden');
    matchModal.setAttribute('aria-hidden', 'false');
    // pre-match 동안은 조이스틱을 숨기지 않는다 — 그냥 걸어 나가면 카운트다운이 취소되도록.
  }

  // pre-match 패널의 카운트다운 문구를 매 프레임 갱신(드로우 코스트 거의 없음).
  function updateZonePanelCountdown() {
    if (!myZoneProgress) return;
    let text;
    if (myZoneProgress.ready) {
      text = '준비 완료 — 친구를 기다리는 중...';
    } else {
      const elapsedClient = performance.now() - myZoneProgress.clientAt;
      const baseElapsed = Math.max(0, myZoneProgress.serverNow - myZoneProgress.candidateSince);
      const elapsed = baseElapsed + elapsedClient;
      const remain = Math.max(0, myZoneProgress.holdMs - elapsed);
      text = `참가 준비 ${(remain / 1000).toFixed(1)}초`;
    }
    // 0.1초 단위로만 바뀌므로 같은 문자열을 60fps 로 다시 쓰는 낭비를 막는다.
    if (text !== lastPanelStatus) {
      matchStatus.textContent = text;
      lastPanelStatus = text;
    }
  }

  function handleServerError(d) {
    const msg = d?.message || '서버 오류';
    const code = d?.code || '';
    if (!me) {
      showJoinError(msg);
      return;
    }
    // 매칭 모달이 열린 상태에서 들어온 에러 (MIN_PLAYERS, NO_PROPOSAL,
    // NOT_HOST 등)는 호스트가 "시작 중..."으로 영원히 갇히지 않도록 모달에
    // 그대로 노출하고 버튼을 복구한다.
    if (activeProposal && !matchModal.classList.contains('hidden')) {
      if (code === 'NO_PROPOSAL') {
        // 서버에선 이미 매칭이 사라졌다 — 모달도 짧은 안내 후 닫는다.
        matchStatus.textContent = msg;
        matchAcceptBtn.disabled = true;
        matchDeclineBtn.disabled = true;
        if (matchCloseTimer) clearTimeout(matchCloseTimer);
        matchCloseTimer = setTimeout(() => { matchCloseTimer = null; closeMatchModal(); }, 1200);
      } else {
        // MIN_PLAYERS, NOT_HOST 등 — 모달은 유지하고 버튼·텍스트만 복구.
        refreshMatchActions();
        matchStatus.textContent = msg;
      }
      return;
    }
    console.warn('[world] server error:', d);
  }

  function onClose() {
    ws = null;
    setConnStatus(false);
    stopHeartbeat();
    // Tear down any open proposal/pre-match panel so its card + countdown don't
    // linger across a disconnect. zone_progress is re-sent fresh after
    // reconnect+rejoin, reopening the panel if the player is still on a booth.
    myZoneProgress = null;
    if (activeProposal || panelZone !== null) closeMatchModal();

    // Intentional leave — leaveWorld already swapped panels; don't reconnect.
    if (leaving) { leaving = false; return; }

    if (worldStarted) {
      // Already in the world — keep the render loop running so the canvas
      // never freezes, and reconnect + re-join in the background.
      scheduleReconnect();
    } else {
      // Dropped before the first welcome — nothing to keep alive.
      if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
      showJoinError('서버 연결이 끊겼습니다.');
    }
  }

  function setConnStatus(ok) {
    connStatus.textContent = ok ? '연결됨' : '연결 끊김';
    connStatus.classList.toggle('ok', ok);
    connStatus.classList.toggle('bad', !ok);
  }

  function send(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ts: Date.now(), ...msg })); } catch { /* closed */ }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => send({ t: 'pong', d: {} }), HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  // canvas 좌표(960) ↔ 물리 화면 px 비율. object-fit:cover 라서 실제 표시 배율은
  // 박스의 가로·세로 중 "큰 쪽"이 결정한다(세로 긴 폰은 높이 기준, 좌우가 잘림).
  // 따라서 width 만으로 계산하면 틀린다 — max(clientW, clientH) 를 써야 한다.
  // 값 = "물리 1px 당 canvas unit 수" (Fold 접힘 ≈ 2.7, 일반 폰 ≈ 1.85, 태블릿 ≈ 1.0).
  // 프레임당 1회 refreshPxScale() 로 갱신하고 이후엔 캐시값을 읽는다(레이아웃 reflow 최소화).
  let _pxScale = 1;
  let _tier = 'mobile';
  function refreshPxScale() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // floor 1.0: 큰 화면(렌더 >960px)에선 캔버스 원래 크기 유지 — 폰트는 base 로
    // 고정되는데 박스(이름표·말풍선 높이)만 toCanvasPx 로 줄어 텍스트가 잘리던 회귀 방지.
    _pxScale = (w && h) ? Math.max(1, canvas.width / Math.max(w, h)) : 1;
    const cw = w || 960;
    _tier = cw < 350 ? 'ultra-small' : (cw < 700 ? 'mobile' : 'desktop');
  }
  function getPxScale() { return _pxScale; }
  function toCanvasPx(physicalPx) { return physicalPx * _pxScale; }

  const FONT_FAMILY = '-apple-system, system-ui, sans-serif';

  // 최소 물리 가독 크기(minPhysicalSize)를 보장하되 큰 화면에선 baseCanvasSize 로
  // 내려앉는 canvas 폰트 크기(정수).
  function adaptiveSize(baseCanvasSize, minPhysicalSize) {
    return Math.floor(Math.max(baseCanvasSize, minPhysicalSize * _pxScale));
  }
  function adaptiveFont(baseCanvasSize, minPhysicalSize, weight = 'normal', family = FONT_FAMILY) {
    return `${weight} ${adaptiveSize(baseCanvasSize, minPhysicalSize)}px ${family}`;
  }

  // 텍스트가 maxW(canvas px)를 넘으면 비례 축소한 크기를 돌려준다 — 옆 부스 침범 방지.
  function widthCappedSize(text, size, weight, maxW) {
    ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
    const w = ctx.measureText(text).width;
    if (w <= maxW || w <= 0) return size;
    return Math.max(8, Math.floor(size * maxW / w));
  }

  function getDisplayTier() { return _tier; } // refreshPxScale() 에서 프레임당 1회 갱신

  // ── Render loop ─────────────────────────────────────────────────────────────
  function startRenderLoop() {
    lastFrameAt = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      step(dt);
      draw();
      syncMatchPanel();
      syncLabPanel();
      syncMirrorBooth();
      drawWardrobeStage();
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  }

  function step(dt) {
    if (!me) return;
    let dx = 0, dy = 0;
    if (isHeld('left'))  dx -= 1;
    if (isHeld('right')) dx += 1;
    if (isHeld('up'))    dy -= 1;
    if (isHeld('down'))  dy += 1;

    const moving = dx !== 0 || dy !== 0;
    me.moving = moving;

    if (moving) {
      // Normalize so diagonal isn't faster.
      const len = Math.hypot(dx, dy);
      const vx = (dx / len) * MOVE_SPEED * dt;
      const vy = (dy / len) * MOVE_SPEED * dt;
      me.x = clamp(me.x + vx, 16, bounds.width  - 16);
      me.y = clamp(me.y + vy, 16, bounds.height - 16);
      me.dir = pickDirection(dx, dy, me.dir);
    }

    maybeSendMove();
  }

  function maybeSendMove() {
    if (!me) return;
    const now = performance.now();
    // Throttle to 50ms while moving. Always send a final stationary snapshot
    // when the moving flag goes false so peers don't see us "stuck walking".
    const snap = { x: Math.round(me.x), y: Math.round(me.y), dir: me.dir, moving: me.moving };
    const stoppedSinceLast = lastSentSnap && lastSentSnap.moving && !snap.moving;
    if (!stoppedSinceLast && now - lastMoveSentAt < 50) return;

    if (lastSentSnap &&
        lastSentSnap.x === snap.x && lastSentSnap.y === snap.y &&
        lastSentSnap.dir === snap.dir && lastSentSnap.moving === snap.moving) {
      return; // nothing changed
    }

    send({ t: 'move', d: snap });
    lastSentSnap = snap;
    lastMoveSentAt = now;
  }

  function pickDirection(dx, dy, prev) {
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    if (dy !== 0) return dy < 0 ? 'up' : 'down';
    return prev;
  }

  function draw() {
    refreshPxScale();
    if (worldBgReady) {
      ctx.drawImage(worldBg, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#bfe09a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    drawZones();
    drawLabBooth();
    drawMirrorBooth();

    // Draw peers behind me so my avatar sits on top when overlapping.
    for (const p of peers.values()) drawAvatar(p, /* isYou */ false);
    if (me) drawAvatar(me, /* isYou */ true);

    // Overlays on top of everything.
    const now = performance.now();
    drawSpawnEffects(now);
    drawOverlays(now);
  }

  // Per-game booth theme — accent colour + a playful icon.
  const ZONE_THEME = {
    'jump-climber':           { color: '#ff9f4d', dark: '#d9791c', icon: '🧗' },
    'mallang-quiz-battle':    { color: '#7db4ff', dark: '#4d83d9', icon: '🧠' },
    'sseuk-sseuk':            { color: '#10b981', dark: '#047857', icon: '✏️' },
    'machine-animal-runner':  { color: '#4fa3ff', dark: '#2f7fd9', icon: '🐤' },
  };
  function zoneTheme(z) {
    return ZONE_THEME[z.gameId] || ZONE_THEME[z.id] ||
           { color: '#7db4ff', dark: '#4d83d9', icon: '🎮' };
  }

  function drawZones() {
    for (const z of zonesCatalog) {
      const st = zoneStates.get(z.id) || { count: 0, ready: 0 };
      const r = z.rect;
      const inHere = !!(me && pointInRect(me.x, me.y, r));
      const near = !!(me && !inHere && nearRect(me.x, me.y, r, 52));
      drawBooth(z, r, st, inHere, near);
    }
  }

  // 실험실 부스 — drawBooth 와 같은 시각 규약(마커→근접 강조→inHere 글로우)을
  // 따르되 보라색 비커 테마로 게임 부스와 구분한다. 매칭/카운트다운은 없다.
  function drawLabBooth() {
    const r = LAB_BOOTH;
    const t = LAB_THEME;
    const inHere = !!(me && pointInRect(me.x, me.y, r));
    const near = !!(me && !inHere && nearRect(me.x, me.y, r, 52));
    const tier = getDisplayTier();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const rmin = Math.min(r.w, r.h);
    const markerR = Math.max(toCanvasPx(13), Math.min(44, rmin * 0.22));
    ctx.save();

    if (inHere) {
      ctx.save();
      ctx.strokeStyle = t.color;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.38 - i * 0.08;
        ctx.lineWidth = 2;
        roundRect(r.x - 3 - i * 3, r.y - 3 - i * 3, r.w + 6 + i * 6, r.h + 6 + i * 6, 16 + i * 3);
        ctx.stroke();
      }
      ctx.restore();
      // 큰 비커 아이콘 중앙.
      ctx.font = `${Math.floor(markerR * 1.7)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.icon, cx, cy);
    } else {
      ctx.fillStyle = hexA(t.color, near ? 0.32 : 0.18);
      ctx.beginPath();
      ctx.arc(cx, cy, markerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexA(t.color, near ? 0.95 : 0.7);
      ctx.lineWidth = near ? 3 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, markerR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `${Math.floor(markerR * 1.1)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.icon, cx, cy + 1);
      if (near) {
        ctx.save();
        ctx.strokeStyle = t.color;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, markerR + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    const showText = tier !== 'ultra-small' || inHere || near;
    if (showText) {
      const laneMaxW = r.w - 8;
      const title = '실험실';
      const titleSize = widthCappedSize(title, adaptiveSize(15, 12), 'bold', laneMaxW);
      const subText = '🧪 실험중인 게임';
      const showSub = tier !== 'ultra-small' || near || inHere;
      const subSize = showSub ? widthCappedSize(subText, adaptiveSize(11, 10), 'normal', laneMaxW) : 0;
      const gapMarker = Math.max(6, titleSize * 0.4);
      const gapLine = Math.max(3, subSize * 0.3);
      let titleY = inHere ? r.y + r.h + 12 + titleSize : cy + markerR + gapMarker + titleSize;
      let subY = titleY + gapLine + subSize;
      if (!inHere) {
        const maxBottom = r.y + r.h - 6;
        const bottom = showSub ? subY : titleY;
        if (bottom > maxBottom) { const o = bottom - maxBottom; titleY -= o; subY -= o; }
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      ctx.font = `bold ${titleSize}px ${FONT_FAMILY}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,30,16,0.9)';
      ctx.strokeText(title, cx, titleY);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(title, cx, titleY);
      if (showSub) {
        ctx.font = `${subSize}px ${FONT_FAMILY}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,30,16,0.85)';
        ctx.strokeText(subText, cx, subY);
        ctx.fillStyle = '#e8e0ff';
        ctx.fillText(subText, cx, subY);
      }
    }
    ctx.restore();

    if (near) {
      const text = '들어가서 실험실 열기';
      ctx.save();
      ctx.font = adaptiveFont(11, 10, 'bold');
      const w = ctx.measureText(text).width + toCanvasPx(12);
      const h = toCanvasPx(18);
      const y = inHere ? (r.y - 66) : (cy - markerR - toCanvasPx(16));
      ctx.fillStyle = t.dark;
      roundRect(cx - w / 2, y - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 5, y + h / 2); ctx.lineTo(cx, y + h / 2 + 5); ctx.lineTo(cx + 5, y + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, y);
      ctx.restore();
    }
  }

  // ── Lab panel (실험실 게임 목록) ─────────────────────────────────────────────
  // 부스 안에 들어선 순간(transition) 패널을 열고, 걸어 나가면 닫는다. 닫기(✕)는
  // DOM 만 숨기며 inLabBooth 플래그는 syncLabPanel 이 소유한다(닫은 뒤 그 자리에
  // 서 있어도 재오픈되지 않고, 나갔다 다시 들어와야 열린다).
  function syncLabPanel() {
    if (!me) return;
    const inside = pointInRect(me.x, me.y, LAB_BOOTH);
    if (!inside) {
      // 부스를 벗어남 — 상태 초기화(다음 진입 때 다시 열림).
      if (inLabBooth) { inLabBooth = false; labDismissed = false; closeLabPanel(); }
      return;
    }
    inLabBooth = true;
    // 매칭 모달이 떠 있으면(같이하기 대기/제안) 실험실 패널은 양보한다.
    if (activeProposal) { closeLabPanel(); return; }
    // ✕ 로 닫아둔 동안은 재오픈하지 않는다.
    if (labDismissed) return;
    // 최초 진입 또는 매칭 취소 후 복귀 — 패널이 닫혀 있으면 연다.
    if (!labModal || labModal.classList.contains('hidden')) openLabPanel();
  }

  function ensureLabModal() {
    if (labModal) return labModal;
    const modal = document.createElement('div');
    modal.id = 'lab-modal';
    modal.className = 'modal lab-modal hidden';
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('role', 'dialog');
    modal.innerHTML = `
      <div class="modal-card lab-card">
        <div class="lab-head">
          <h2>🧪 실험실</h2>
          <button type="button" class="lab-close" aria-label="닫기">✕</button>
        </div>
        <p class="modal-sub">아직 다듬는 중인 실험작이에요. 가볍게 즐겨보고 의견 주세요!</p>
        <ul class="lab-list"></ul>
      </div>`;
    const host = document.getElementById('app') || document.body;
    host.appendChild(modal);
    modal.querySelector('.lab-close').addEventListener('click', () => {
      labDismissed = true; // 같은 자리에선 재오픈 안 함 — 나갔다 와야 다시 열림.
      closeLabPanel();
    });
    labModal = modal;
    return labModal;
  }

  function renderLabList() {
    const list = labModal.querySelector('.lab-list');
    list.innerHTML = '';
    const games = (Array.isArray(window.GAME_REGISTRY) ? window.GAME_REGISTRY : [])
      .filter((g) => g && g.stage === 'LAB' && typeof g.path === 'string');
    if (!games.length) {
      const li = document.createElement('li');
      li.className = 'lab-empty';
      li.textContent = '아직 실험 중인 게임이 없어요.';
      list.appendChild(li);
      return;
    }
    for (const g of games) {
      const li = document.createElement('li');
      li.className = 'lab-item';
      const accent = /^#[0-9a-fA-F]{6}$/.test(g.accentColor || '') ? g.accentColor : '#b08cff';
      const players = g.supportedPlayers || g.recommendedPlayers || '';
      // labMatch 게임은 '같이하기'(광장 자동 페어링) 버튼을 추가로 보여준다.
      const waiting = g.labMatch ? (zoneStates.get('lab:' + g.id)?.count || 0) : 0;
      const coopLabel = waiting > 0 ? `👥 같이하기 (대기 ${waiting})` : '👥 같이하기';
      li.innerHTML = `
        <span class="lab-icon" style="background:${hexA(accent, 0.18)};color:${accent}">${escapeHtml(g.icon || '🎮')}</span>
        <span class="lab-info">
          <span class="lab-title">${escapeHtml(g.title)}<span class="lab-badge">실험중</span></span>
          <span class="lab-desc">${escapeHtml(g.description || '')}</span>
          ${players ? `<span class="lab-meta">👥 ${escapeHtml(players)}</span>` : ''}
          <span class="lab-actions">
            <button type="button" class="lab-btn lab-btn--solo">${g.labMatch ? '혼자 하기' : '플레이 ▶'}</button>
            ${g.labMatch ? `<button type="button" class="lab-btn lab-btn--coop">${escapeHtml(coopLabel)}</button>` : ''}
          </span>
        </span>`;
      li.querySelector('.lab-btn--solo').addEventListener('click', () => gotoGameFromLab(g.path));
      const coopBtn = li.querySelector('.lab-btn--coop');
      if (coopBtn) coopBtn.addEventListener('click', () => queueLabCoop(g.id));
      list.appendChild(li);
    }
  }

  // '같이하기' — 서버 lab 큐에 진입. 이후 match_proposal 이 오면 매칭 모달이
  // 열리며(handleMatchProposal 이 실험실 패널을 닫음) 기존 발사 흐름을 그대로 탄다.
  function queueLabCoop(gameId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    send({ t: 'lab_queue', d: { gameId } });
  }

  function openLabPanel() {
    ensureLabModal();
    renderLabList();
    labModal.classList.remove('hidden');
    labModal.setAttribute('aria-hidden', 'false');
  }

  function closeLabPanel() {
    if (!labModal) return;
    labModal.classList.add('hidden');
    labModal.setAttribute('aria-hidden', 'true');
  }

  // 실험실 카드 → 게임으로 직접 이동(매칭 없음, 솔로). 동일 오리진 /games/ 경로만
  // 허용. handleGoToGame 과 같은 teardown(heartbeat/raf/ws) 후 이동.
  function gotoGameFromLab(path) {
    if (typeof path !== 'string' || !path.startsWith('/games/')) return;
    stopHeartbeat();
    if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
    const sep = path.includes('?') ? '&' : '?';
    window.location.href = path + sep + 'from=lab';
  }

  // ── 전신 거울 오브젝트 (꾸미기 진입점 2, AVATAR_DESIGN.md §6) ──────────────
  // LAB_BOOTH 와 같은 클라 전용 오브젝트(서버 zone 아님). 좌표 제약:
  //   • 게임 복귀 랜덤 스폰 영역(x80~460·y450~850)을 피한다 — 스폰하자마자
  //     패널이 열리면 안 된다.
  //   • 모바일 세로(object-fit:cover)에서 좌우가 x≈213~748 로 잘리므로 그 안에.
  //   • LAB_BOOTH(571,424,165,200)·SPAWN_POINT(480,520)와 겹치지 않게.
  const MIRROR_BOOTH = { x: 600, y: 690, w: 110, h: 120 };
  const MIRROR_THEME = { color: '#ff9fd0', dark: '#d65fa0', icon: '👕' };
  let inMirrorBooth = false;   // 진입/이탈 전이 추적 (한 번 열리면 나갔다 와야 재오픈)

  function drawMirrorBooth() {
    const r = MIRROR_BOOTH;
    const t = MIRROR_THEME;
    const inHere = !!(me && pointInRect(me.x, me.y, r));
    const near = !!(me && !inHere && nearRect(me.x, me.y, r, 52));
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const markerR = Math.max(toCanvasPx(13), Math.min(38, Math.min(r.w, r.h) * 0.3));
    ctx.save();
    ctx.fillStyle = hexA(t.color, inHere ? 0.4 : near ? 0.32 : 0.18);
    ctx.beginPath();
    ctx.arc(cx, cy, markerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(t.color, near || inHere ? 0.95 : 0.7);
    ctx.lineWidth = near || inHere ? 3 : 2;
    ctx.beginPath();
    ctx.arc(cx, cy, markerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `${Math.floor(markerR * 1.1)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.icon, cx, cy + 1);

    const title = '전신 거울';
    const titleSize = widthCappedSize(title, adaptiveSize(13, 11), 'bold', r.w + 40);
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.font = `bold ${titleSize}px ${FONT_FAMILY}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(20,30,16,0.9)';
    ctx.strokeText(title, cx, cy + markerR + titleSize + 4);
    ctx.fillStyle = '#ffe3f2';
    ctx.fillText(title, cx, cy + markerR + titleSize + 4);
    ctx.restore();

    if (near) {
      const isHuman = !!(me && me.characterId === HUMAN_ID);
      const text = isHuman ? '들어가서 꾸미기' : '사람 캐릭터만 꾸밀 수 있어요';
      ctx.save();
      ctx.font = adaptiveFont(11, 10, 'bold');
      const w = ctx.measureText(text).width + toCanvasPx(12);
      const h = toCanvasPx(18);
      const y = cy - markerR - toCanvasPx(16);
      ctx.fillStyle = t.dark;
      roundRect(cx - w / 2, y - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 5, y + h / 2); ctx.lineTo(cx, y + h / 2 + 5); ctx.lineTo(cx + 5, y + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, y);
      ctx.restore();
    }
  }

  /* 거울 안에 들어선 순간 패널을 연다(사람 아바타만). 패널은 걸어 나가도 자동으로
   * 닫지 않는다 — 편집 초안 보존(§7). 나갔다 다시 들어오면 재오픈.
   */
  function syncMirrorBooth() {
    if (!me) return;
    const inside = pointInRect(me.x, me.y, MIRROR_BOOTH);
    if (!inside) { inMirrorBooth = false; return; }
    if (inMirrorBooth) return;
    inMirrorBooth = true;
    if (me.characterId === HUMAN_ID && !activeProposal) openWardrobePanel();
  }

  // ── 꾸미기 패널 (AVATAR_DESIGN.md §7) ───────────────────────────────────────
  // 모달 패널 — 여는 동안 광장 WS 유지. 저장 시에만 일괄 반영(sendOutfitChange),
  // 닫기·오류 시 기존 착장 유지(초안 폐기). A단계는 전 아이템 무료(잠금 UI 없음).
  const WARDROBE_TABS = [
    { slot: 'outfit',  label: '👗 코디' },
    { slot: 'hair',    label: '💇 헤어' },
    { slot: 'hat',     label: '🎩 모자' },
    { slot: 'faceAcc', label: '👓 안경' },
  ];
  let wardrobeModal = null;
  let wardrobeDraft = null;      // 편집 중 착장(항상 sanitize 완료 상태)
  let wardrobeSaved = null;      // 열 때 스냅샷 — 되돌리기 대상
  let wardrobePreset = 'girl';   // 저장 시 world_outfit.preset 에 실릴 값
  let wardrobeTab = 'outfit';
  let wardrobeDir = 'down';      // 미리보기 방향 (탭하면 회전)
  let wardrobeLastSheet = null;  // 미리보기 원자 교체용 — 합성 중 이전 시트 유지

  function ensureWardrobeModal() {
    if (wardrobeModal) return wardrobeModal;
    const modal = document.createElement('div');
    modal.id = 'wardrobe-modal';
    modal.className = 'modal wardrobe-modal hidden';
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('role', 'dialog');
    modal.innerHTML = `
      <div class="modal-card wardrobe-card">
        <div class="lab-head">
          <h2>👕 꾸미기</h2>
          <button type="button" class="lab-close wardrobe-close" aria-label="닫기">✕</button>
        </div>
        <div class="wardrobe-stage">
          <canvas class="wardrobe-stage-canvas" width="150" height="150"></canvas>
          <p class="wardrobe-hint">캐릭터를 누르면 돌아서요</p>
        </div>
        <div class="wardrobe-tabs"></div>
        <div class="wardrobe-swatches hidden"></div>
        <div class="wardrobe-items"></div>
        <div class="wardrobe-presets">
          <span class="wardrobe-presets-label">처음으로:</span>
          <button type="button" data-preset="girl">👧 여자아이 기본</button>
          <button type="button" data-preset="boy">👦 남자아이 기본</button>
        </div>
        <div class="modal-actions wardrobe-actions">
          <button type="button" class="btn-ghost wardrobe-random">🎲 랜덤 코디</button>
          <button type="button" class="btn-ghost wardrobe-revert">되돌리기</button>
          <button type="button" class="btn-primary wardrobe-save">저장</button>
        </div>
      </div>`;
    const host = document.getElementById('app') || document.body;
    host.appendChild(modal);

    modal.querySelector('.wardrobe-close').addEventListener('click', closeWardrobePanel);
    modal.querySelector('.wardrobe-random').addEventListener('click', () => {
      wardrobeDraft = window.WARDROBE.randomOutfit();
      renderWardrobeControls();
    });
    modal.querySelector('.wardrobe-revert').addEventListener('click', () => {
      wardrobeDraft = { ...wardrobeSaved };
      renderWardrobeControls();
    });
    modal.querySelector('.wardrobe-save').addEventListener('click', () => {
      sendOutfitChange({ ...wardrobeDraft }, wardrobePreset);
      closeWardrobePanel();
    });
    for (const b of modal.querySelectorAll('.wardrobe-presets button')) {
      b.addEventListener('click', () => {
        wardrobePreset = b.dataset.preset;
        wardrobeDraft = window.WARDROBE.sanitizeOutfit(null, wardrobePreset);
        renderWardrobeControls();
      });
    }
    const tabsEl = modal.querySelector('.wardrobe-tabs');
    for (const t of WARDROBE_TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.slot = t.slot;
      b.textContent = t.label;
      b.addEventListener('click', () => {
        wardrobeTab = t.slot;
        renderWardrobeControls();
      });
      tabsEl.appendChild(b);
    }
    const stage = modal.querySelector('.wardrobe-stage-canvas');
    stage.addEventListener('click', () => {
      wardrobeDir = { down: 'right', right: 'up', up: 'left', left: 'down' }[wardrobeDir] || 'down';
    });
    wardrobeModal = modal;
    return modal;
  }

  function openWardrobePanel() {
    if (!me || me.characterId !== HUMAN_ID) return;
    ensureWardrobeModal();
    if (!wardrobeModal.classList.contains('hidden')) return; // 이미 열림 — 초안 유지
    const saved = loadSavedOutfit();
    wardrobePreset = (saved && saved.preset) || selectedPreset || 'girl';
    wardrobeDraft = window.WARDROBE.sanitizeOutfit(me.outfit, wardrobePreset);
    wardrobeSaved = { ...wardrobeDraft };
    wardrobeDir = 'down';
    wardrobeLastSheet = null;
    renderWardrobeControls();
    wardrobeModal.classList.remove('hidden');
    wardrobeModal.setAttribute('aria-hidden', 'false');
  }

  function closeWardrobePanel() {
    if (!wardrobeModal) return;
    wardrobeModal.classList.add('hidden');
    wardrobeModal.setAttribute('aria-hidden', 'true');
  }

  /* 탭·스와치·아이템 그리드를 현재 draft 기준으로 다시 그린다. 아이템 카드
   * 썸네일은 "그 아이템만 바꿔 입은 내 모습" 합성 시트의 정면 셀 — 캐시 키가
   * 아바타 시트와 같아서 카드를 눌렀을 때 미리보기가 즉시 뜬다.
   */
  function renderWardrobeControls() {
    const W = window.WARDROBE;
    const modal = ensureWardrobeModal();
    for (const b of modal.querySelectorAll('.wardrobe-tabs button')) {
      b.classList.toggle('active', b.dataset.slot === wardrobeTab);
    }

    // 헤어 탭에서만 색 스와치 노출.
    const swatches = modal.querySelector('.wardrobe-swatches');
    swatches.classList.toggle('hidden', wardrobeTab !== 'hair');
    if (wardrobeTab === 'hair') {
      swatches.innerHTML = '';
      for (const pal of W.hairPalettes) {
        const info = W.hairPaletteInfo[pal] || { label: pal, color: '#888' };
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wardrobe-swatch' + (wardrobeDraft.hairColor === pal ? ' selected' : '');
        b.style.background = info.color;
        b.title = info.label;
        b.setAttribute('aria-label', `머리색 ${info.label}`);
        b.addEventListener('click', () => {
          wardrobeDraft.hairColor = pal;
          renderWardrobeControls();
        });
        swatches.appendChild(b);
      }
    }

    const itemsEl = modal.querySelector('.wardrobe-items');
    itemsEl.innerHTML = '';
    const optional = wardrobeTab === 'hat' || wardrobeTab === 'faceAcc';
    const entries = [];
    if (optional) entries.push({ id: null, label: '없음' });
    for (const it of W.itemsBySlot(wardrobeTab)) entries.push(it);
    for (const it of entries) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'wardrobe-item' + (wardrobeDraft[wardrobeTab] === it.id ? ' selected' : '');
      const thumb = document.createElement('div');
      thumb.className = 'wardrobe-item-thumb';
      thumb.textContent = it.id ? '⋯' : '🚫';
      const label = document.createElement('span');
      label.textContent = it.label;
      card.append(thumb, label);
      // 썸네일 = "그 아이템만 바꿔 입은 내 모습" ('없음' 카드는 벗은 조합).
      paintWardrobeThumb(thumb, { ...wardrobeDraft, [wardrobeTab]: it.id });
      card.addEventListener('click', () => {
        wardrobeDraft[wardrobeTab] = it.id;
        renderWardrobeControls();
      });
      itemsEl.appendChild(card);
    }
  }

  function paintWardrobeThumb(el, outfit) {
    ensureHumanSheet(outfit).promise.then((e) => {
      if (!e.ready || !el.isConnected) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 84;
      const c = canvas.getContext('2d');
      const cell = HUMAN_SHEET_SIZE / 3;
      c.drawImage(e.img, 0, 0, cell, cell, 0, 0, 84, 84);
      el.replaceChildren(canvas);
    });
  }

  /* 미리보기 스테이지 — 렌더 루프에서 매 프레임 호출. draft 착장으로 제자리
   * 걷기 재생(4박자), 탭하면 방향 회전. 합성 중엔 직전 완성 시트 유지.
   */
  function drawWardrobeStage() {
    if (!wardrobeModal || wardrobeModal.classList.contains('hidden')) return;
    const canvas = wardrobeModal.querySelector('.wardrobe-stage-canvas');
    if (!canvas || !wardrobeDraft) return;
    const entry = ensureHumanSheet(wardrobeDraft);
    const sheet = entry.ready ? (wardrobeLastSheet = entry) : wardrobeLastSheet;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (!sheet) return; // 첫 합성 대기 — 다음 프레임에 뜬다
    const cell = HUMAN_SHEET_SIZE / 3;
    const row = wardrobeDir === 'down' ? 0 : wardrobeDir === 'up' ? 2 : 1;
    const col = HUMAN_WALK_PATTERN[Math.floor(performance.now() / HUMAN_WALK_MS) % HUMAN_WALK_PATTERN.length];
    c.save();
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.translate(canvas.width / 2, canvas.height * 0.95);
    if (wardrobeDir === 'left') c.scale(-1, 1); // side row 는 우향 — left 미러
    const drawW = 140, drawH = 140;
    c.drawImage(sheet.img, col * cell, row * cell, cell, cell, -drawW / 2, -drawH * 0.95, drawW, drawH);
    c.restore();
  }

  // 부스 표시 정책 (사용자 피드백):
  //   • 기본: 작은 원형 영역 + 라벨만. 월드가 산만하지 않도록 일러스트는 숨김.
  //   • 들어선 순간(inHere): 일러스트 노출 + 카운트다운 진행.
  //   • 초소형 기기(Fold folded): 라벨 숨김 (아이콘만), 근접 시 툴팁으로 표시.
  function drawBooth(z, r, st, inHere, near) {
    const t = zoneTheme(z);
    const tier = getDisplayTier();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    
    // 마커 크기: rect 비례(0.22, 상한 44 canvas)로 키우고, 작은 화면에선 물리 13px 하한 보장.
    const rmin = Math.min(r.w, r.h);
    const markerR = Math.max(toCanvasPx(13), Math.min(44, rmin * 0.22));
    ctx.save();

    if (inHere) {
      // ── inHere: rect 전체에 proximity glow + 일러스트 ─────────────
      ctx.save();
      ctx.strokeStyle = t.color;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.38 - i * 0.08;
        ctx.lineWidth = 2;
        roundRect(r.x - 3 - i * 3, r.y - 3 - i * 3, r.w + 6 + i * 6, r.h + 6 + i * 6, 16 + i * 3);
        ctx.stroke();
      }
      ctx.restore();

      const padY = r.y + r.h - 28;
      ctx.fillStyle = hexA(t.color, 0.55);
      roundRect(r.x + 14, padY, r.w - 28, 22, 11);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(r.x + 18, padY + 3, r.w - 36, 6, 3);
      ctx.fill();

      const booth = getBoothImage(z.gameId);
      if (booth && booth.ready) {
        const drawW = r.w + 20;
        const drawH = drawW * booth.img.height / booth.img.width;
        ctx.drawImage(booth.img, cx - drawW / 2, (r.y + r.h) - drawH + 6, drawW, drawH);
      }
    } else {
      // ── 기본: 작은 원형 마커 + 아이콘. 가까이 가면 살짝 강조. ──────
      ctx.fillStyle = hexA(t.color, near ? 0.32 : 0.18);
      ctx.beginPath();
      ctx.arc(cx, cy, markerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexA(t.color, near ? 0.95 : 0.7);
      ctx.lineWidth = near ? 3 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, markerR, 0, Math.PI * 2);
      ctx.stroke();
      // 중앙 아이콘 (이모지)
      ctx.font = `${Math.floor(markerR * 1.1)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.icon || '🎮', cx, cy + 1);

      if (near) {
        // 가까울 때 외곽 부드러운 펄스링 1줄
        ctx.save();
        ctx.strokeStyle = t.color;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, markerR + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 초소형 기기(Fold 등)에서 평상시 텍스트 라벨은 숨김 (공간 부족 및 겹침 방지).
    // 단, 들어가 있거나(inHere) 가까이 갔을 때(near)는 표시.
    const showText = tier !== 'ultra-small' || inHere || near;
    if (showText) {
      const laneMaxW = r.w - 8; // 옆 부스(gapX=8) 침범 방지 폭 상한
      // 제목 — 긴 제목은 lane 폭에 맞춰 비례 축소(measureText cap).
      const titleSize = widthCappedSize(z.title, adaptiveSize(15, 12), 'bold', laneMaxW);

      // 상태 텍스트(대기 인원) — countdown 이 아니고, 표시 조건을 만족할 때만.
      const isCountdown = inHere && myZoneProgress && myZoneProgress.zoneId === z.id;
      const showStatus = !isCountdown && (tier !== 'ultra-small' || near);
      const enough = st.count >= z.minPlayers;
      const statusText = enough
        ? `대기 ${st.count}/${z.maxPlayers} · 곧 시작!`
        : `대기 ${st.count}/${z.maxPlayers} · ${z.minPlayers}명 모이면 시작`;
      const statusSize = showStatus
        ? widthCappedSize(statusText, adaptiveSize(11, 10), 'normal', laneMaxW) : 0;

      // 세로 배치(폰트 크기에 비례). 마커 모드일 땐 rect 아래로 넘치지 않게 클램프.
      const gapMarker = Math.max(6, titleSize * 0.4);
      const gapLine = Math.max(3, statusSize * 0.3);
      let titleY = inHere ? r.y + r.h + 12 + titleSize : cy + markerR + gapMarker + titleSize;
      let statusY = titleY + gapLine + statusSize;
      if (!inHere) {
        const maxBottom = r.y + r.h - 6;
        const bottom = showStatus ? statusY : titleY;
        if (bottom > maxBottom) { const o = bottom - maxBottom; titleY -= o; statusY -= o; }
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';

      // Title
      ctx.font = `bold ${titleSize}px ${FONT_FAMILY}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,30,16,0.9)';
      ctx.strokeText(z.title, cx, titleY);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(z.title, cx, titleY);

      // Status line / countdown.
      if (isCountdown) {
        drawZoneCountdown(z, r, titleY); // 제목 baseline 아래로 스택(겹침 방지)
      } else if (showStatus) {
        ctx.font = `${statusSize}px ${FONT_FAMILY}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,30,16,0.85)';
        ctx.strokeText(statusText, cx, statusY);
        ctx.fillStyle = enough ? '#d6ffe6' : '#eef2ff';
        ctx.fillText(statusText, cx, statusY);
      }
    }
    ctx.restore();

    // Proximity tooltip — 마커 모드일 땐 마커 위로, inHere일 땐 rect 위로.
    if (near) drawZoneTip(z, r, t, inHere, cy - markerR);
  }

  function drawZoneTip(z, r, t, inHere, markerTopY) {
    const sec = Math.round((z.holdMs || 3000) / 1000);
    const text = `들어가서 ${sec}초 → 시작!`;
    ctx.save();
    ctx.font = adaptiveFont(11, 10, 'bold');
    const w = ctx.measureText(text).width + toCanvasPx(12);
    const h = toCanvasPx(18);
    const cx = r.x + r.w / 2;
    const y = inHere ? (r.y - 66) : (markerTopY - toCanvasPx(16));
    ctx.fillStyle = t.dark;
    roundRect(cx - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 5, y + h / 2); ctx.lineTo(cx, y + h / 2 + 5); ctx.lineTo(cx + 5, y + h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y);
    ctx.restore();
  }

  function drawZoneCountdown(zone, r, titleBaselineY) {
    if (!myZoneProgress) return;
    const elapsedClient = performance.now() - myZoneProgress.clientAt;
    // serverNow - candidateSince = elapsed at the moment server stamped this
    const baseElapsed = Math.max(0, myZoneProgress.serverNow - myZoneProgress.candidateSince);
    const elapsed = baseElapsed + elapsedClient;
    const remain = Math.max(0, myZoneProgress.holdMs - elapsed);
    const ratio = clamp(elapsed / myZoneProgress.holdMs, 0, 1);
    const cx = r.x + r.w / 2;

    const cdSize = adaptiveSize(11, 10);
    ctx.font = `bold ${cdSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    const status = myZoneProgress.ready ? '준비 완료 — 모이는 중...' : `참가 준비 ${(remain / 1000).toFixed(1)}초`;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20,30,16,0.8)';
    // 제목 baseline 아래로 한 줄 띄워 배치 — 제목과 겹치지 않게(폰트 비례 gap).
    // titleBaselineY 가 없으면(이전 호출부 호환) rect 아래 기존 위치로 폴백.
    const textY = (titleBaselineY != null)
      ? titleBaselineY + Math.max(4, cdSize * 0.35) + cdSize
      : r.y + r.h + toCanvasPx(24);
    ctx.strokeText(status, cx, textY);
    ctx.fillStyle = myZoneProgress.ready ? '#d6ffe6' : '#ffffff';
    ctx.fillText(status, cx, textY);

    // Progress bar.
    const padX = 18, barW = r.w - padX * 2, barH = Math.max(6, toCanvasPx(4));
    const barX = r.x + padX, barY = textY + toCanvasPx(6);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(barX, barY, barW, barH, barH / 2);
    ctx.fill();
    ctx.fillStyle = myZoneProgress.ready ? '#6bdfa1' : '#ffd27a';
    roundRect(barX, barY, barW * ratio, barH, barH / 2);
    ctx.fill();
  }

  function drawOverlays(now) {
    const drawForPlayer = (p) => {
      const b = bubbles.get(p.id);
      if (b) {
        if (b.until <= now) bubbles.delete(p.id);
        else drawBubble(p.x, p.y, b.text, Math.min(1, (b.until - now) / 600));
      }
      const r = reactions.get(p.id);
      if (r) {
        if (r.until <= now) reactions.delete(p.id);
        else drawReaction(p.x, p.y, r.glyph, Math.min(1, (r.until - now) / 400));
      }
    };
    if (me) drawForPlayer(me);
    for (const p of peers.values()) drawForPlayer(p);
  }

  function drawBubble(cx, cy, text, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = adaptiveFont(14, 12, 'bold');
    const padX = toCanvasPx(11), padY = toCanvasPx(7), lineH = toCanvasPx(18);
    const lines = wrapText(text, toCanvasPx(160));
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    const h = lines.length * lineH + padY * 2;
    // Sit just above the name pill so the tail visually connects to the
    // character. Clamp to keep the bubble inside the canvas.
    const top = Math.max(8, cy - toCanvasPx(100) - h);
    const tailH = toCanvasPx(10);
    const tailHalfW = toCanvasPx(7);

    // Drop shadow for contrast over the grass.
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;

    // Body + tail as a single path so the dark outline is continuous.
    const x = cx - w / 2, y = top, r = 10;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    // 오른쪽 가장자리 → tail 시작점
    ctx.lineTo(cx + tailHalfW, y + h);
    ctx.lineTo(cx, y + h + tailH);   // 뾰족한 끝
    ctx.lineTo(cx - tailHalfW, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();

    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 외곽선 (그림자 끄고 깔끔하게).
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(20,30,16,0.8)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.fillStyle = '#1a1410';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, cx, top + padY + i * lineH));
    ctx.restore();
  }

  function drawReaction(cx, cy, glyph, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${Math.floor(toCanvasPx(24))}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(glyph, cx, cy - toCanvasPx(30));
    ctx.restore();
  }

  function wrapText(text, maxWidth) {
    const out = [];
    let line = '';
    for (const ch of text) {
      const candidate = line + ch;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        out.push(line);
        line = ch;
      } else {
        line = candidate;
      }
      if (out.length >= 3) { out[2] = line; break; }
    }
    if (out.length < 3 && line) out.push(line);
    return out.length ? out : [''];
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawAvatar(p, isYou) {
    const r = 18;
    ctx.save();
    ctx.translate(p.x, p.y);

    // 지면 기반 그림자/링은 그리지 않는다. 스프라이트 셀 하단 패딩이 캐릭터
    // 마다 달라서 어떤 y로 두어도 한쪽에서는 발과 분리돼 떠 보였다. 본인 표시는
    // 아래쪽 이름표 스타일로 처리한다.

    const isHuman = p.characterId === HUMAN_ID;
    const sprite = isHuman ? getHumanSprite(p) : getSprite(p.characterId);
    let nameTagY = -r - 8;

    if (sprite.ready) {
      const dir = p.dir || 'down';
      const row = dir === 'down' ? 0 : dir === 'up' ? 2 : 1; // left/right -> side
      // 사람 아바타는 4박자(A→정지→B→정지, §5-6), 동물은 기존 2박자 유지.
      const col = !p.moving ? 0
        : isHuman ? HUMAN_WALK_PATTERN[Math.floor(performance.now() / HUMAN_WALK_MS) % HUMAN_WALK_PATTERN.length]
        : (Math.floor(performance.now() / WALK_FRAME_MS) % 2) + 1;
      const { width: fw, height: fh } = getSpriteSourceFrame(sprite);
      const drawW = 100, drawH = 100;
      const destX = -drawW / 2;
      // 스프라이트 셀 하단에 ~15% 정도 빈 패딩이 있어 0.97 로 정렬하면
      // 시각적 발이 지면보다 위에 떴다. 0.85 로 낮춰 캐릭터를 더 끌어내려
      // 셀 패딩이 지면 아래로 빠지고 시각적 발이 y≈0(컨택트 쉐도우 자리)에
      // 닿도록 한다.
      const FOOT_FRACTION = 0.85;
      const destY = -drawH * FOOT_FRACTION;
      nameTagY = destY - 8;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      // 대부분 시트의 side row 아트는 오른쪽을 향해 left일 때 미러링한다.
      // 라떼 강아지 시트만 side row가 왼쪽을 향해 반대로 미러링해야 한다.
      const sideFacesLeft = p.characterId === 'latte_puppy';
      const mirror = sideFacesLeft ? (dir === 'right') : (dir === 'left');
      if (mirror) ctx.scale(-1, 1);
      ctx.drawImage(sprite.img, col * fw, row * fh, fw, fh, destX, destY, drawW, drawH);
      ctx.restore();
    } else {
      // Emoji-on-disk fallback for avatars without a sprite sheet.
      ctx.fillStyle = isYou ? '#ffb96b' : '#6bbcff';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '22px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1a1410';
      ctx.fillText(characterEmoji(p.characterId), 0, 1);

      const arrowOffset = { up: [0, -r - 6], down: [0, r + 6], left: [-r - 6, 0], right: [r + 6, 0] }[p.dir] || [0, r + 6];
      ctx.fillStyle = isYou ? '#ffb96b' : '#6bbcff';
      ctx.beginPath();
      ctx.arc(arrowOffset[0], arrowOffset[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Name tag — colored pill matching the chat log so each player is
    // recognizable at a glance.
    const name = p.name || '';
    if (name) {
      ctx.font = adaptiveFont(15, 12, 'bold');
      const w = ctx.measureText(name).width;
      const padX = toCanvasPx(9), tagH = toCanvasPx(22);
      const tagW = w + padX * 2;
      const tagTop = nameTagY - tagH;
      ctx.fillStyle = 'rgba(20, 30, 16, 0.78)';
      roundRect(-tagW / 2, tagTop, tagW, tagH, tagH / 2);
      ctx.fill();
      if (isYou) {
        ctx.strokeStyle = '#ffb96b';
        ctx.lineWidth = 1.8;
        roundRect(-tagW / 2, tagTop, tagW, tagH, tagH / 2);
        ctx.stroke();
      }
      ctx.fillStyle = isYou ? '#ffd9a8' : nameColor(p.name);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 0, tagTop + tagH / 2 + 0.5);
    }

    ctx.restore();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function pointInRect(x, y, r) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }
  function nearRect(x, y, r, m) {
    return x >= r.x - m && x < r.x + r.w + m && y >= r.y - m && y < r.y + r.h + m;
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function readLoungeId() {
    const raw = new URLSearchParams(window.location.search).get('worldId');
    if (raw && /^lounge-[a-z0-9-]{1,32}$/.test(raw)) return raw;
    return 'lounge-1';
  }

  function characterEmoji(worldId) {
    switch (worldId) {
      case 'human': return '🧒';
      case 'latte_puppy': return '🐶';
      case 'mochi_rabbit': return '🐰';
      case 'pudding_hamster': return '🐹';
      case 'mint_kitten': return '🐱';
      case 'peach_chick': return '🐤';
      default: return '⭐';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
})();
