/* World client — Commit 3 scope.
 *
 * Responsibilities of this file in this commit:
 *   - Character/name picker UI -> WS connect to /api/world/:loungeId
 *   - Receive `welcome` and render YOUR character on the canvas
 *   - Local-only WASD/arrow movement (no broadcast yet)
 *   - Periodic pong heartbeat so the DO does not GC the session
 *
 * NOT in this commit:
 *   - Sending `move` to the server (Commit 4)
 *   - Rendering other players (Commit 4)
 *   - Chat / reactions / zone matching (later commits)
 */

(function () {
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
  // 3x3 grid of 32px frames. row: 0=down 1=side(right) 2=up. col: 0=idle 1=stepA 2=stepB.
  // The `left` direction reuses the side row, mirrored horizontally.
  const SPRITE_FRAME = window.CHARACTER_FRAME || { width: 32, height: 32 };
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

  // ── World background ──────────────────────────────────────────────────────
  const worldBg = new Image();
  let worldBgReady = false;
  worldBg.onload = () => { worldBgReady = true; };
  worldBg.src = './assets/world_bg.png';

  // ── Game booth illustrations ──────────────────────────────────────────────
  const boothImages = {};
  function getBoothImage(gameId) {
    const file = gameId === 'jump-climber' ? 'booth_jump.png'
               : gameId === 'mallang-quiz-battle' ? 'booth_quiz.png' : null;
    if (!file) return null;
    let entry = boothImages[gameId];
    if (entry) return entry;
    entry = { img: new Image(), ready: false };
    entry.img.onload = () => { entry.ready = true; };
    entry.img.src = './assets/' + file;
    boothImages[gameId] = entry;
    return entry;
  }

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
  const leaveBtn = document.getElementById('leave-btn');
  const matchModal = document.getElementById('match-modal');
  const matchTitle = document.getElementById('match-title');
  const matchStatus = document.getElementById('match-status');
  const matchMembers = document.getElementById('match-members');
  const matchAcceptBtn = document.getElementById('match-accept');
  const matchDeclineBtn = document.getElementById('match-decline');

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

  // ── Picker state ────────────────────────────────────────────────────────────
  let selectedCharacterId = null;
  buildPicker();
  restoreSavedName();

  nameInput.addEventListener('input', updateJoinButton);
  joinBtn.addEventListener('click', tryJoin);
  if (leaveBtn) leaveBtn.addEventListener('click', leaveWorld);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !joinBtn.disabled) tryJoin();
  });

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
  let activeProposal = null; // { matchId, gameId, title, members, deadline, responded }
  let matchCloseTimer = null; // delayed closeMatchModal handle (cancellation flow)

  // ── Picker UI ───────────────────────────────────────────────────────────────
  function buildPicker() {
    if (!Array.isArray(window.CHARACTERS)) {
      joinStatus.textContent = '캐릭터 카탈로그를 불러올 수 없습니다.';
      joinStatus.classList.add('error');
      return;
    }
    picker.innerHTML = '';
    for (const c of window.CHARACTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-card';
      btn.dataset.worldId = c.worldId;
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
  }

  function selectCharacter(worldId) {
    selectedCharacterId = worldId;
    for (const card of picker.querySelectorAll('.character-card')) {
      card.classList.toggle('selected', card.dataset.worldId === worldId);
    }
    try { localStorage.setItem('world_character', worldId); } catch { /* ignore */ }
    updateJoinButton();
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
      if (savedChar) selectCharacter(savedChar);
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

    joinParams = { name, characterId: selectedCharacterId };
    openSocket();
  }

  function openSocket() {
    const base = (window.WORKER_URL || window.location.origin).replace(/^http/, 'ws');
    const url = `${base}/api/world/${encodeURIComponent(LOUNGE_ID)}`;

    try {
      ws = new WebSocket(url);
    } catch (err) {
      if (worldStarted) scheduleReconnect();
      else showJoinError(`연결 실패: ${err.message}`);
      return;
    }

    ws.addEventListener('open', () => {
      send({ t: 'join_world', d: joinParams });
    });
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', () => {
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
    if (activeProposal) closeMatchModal();
    if (chatLogBody) chatLogBody.innerHTML = '';

    worldPanel.classList.add('hidden');
    joinPanel.classList.remove('hidden');
    joinStatus.textContent = '';
    joinStatus.classList.remove('error');
    setConnStatus(false);
    updateJoinButton();
  }

  function showJoinError(msg) {
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
      case 'zone_state': return handleZoneState(env.d);
      case 'zone_progress': return handleZoneProgress(env.d);
      case 'match_proposal': return handleMatchProposal(env.d);
      case 'match_members_updated': return handleMatchMembersUpdated(env.d);
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
    worldPanel.classList.remove('hidden');

    // One-time wiring — guarded so re-joins don't double-bind listeners
    // or spin up a second render loop.
    if (!worldStarted) {
      worldStarted = true;
      buildReactionBar();
      bindChatForm();
      bindMatchModal();
      setupJoystick();
      startRenderLoop();
    }

    // Server replays recent (≤2h) chat history on every welcome — render it
    // so reconnect/re-join shows the conversation that happened.
    renderChatHistory(d.chat);
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

  function handleZoneState(d) {
    if (!d?.zoneId) return;
    zoneStates.set(d.zoneId, {
      count: numOr(d.count, 0),
      ready: numOr(d.ready, 0),
      minPlayers: numOr(d.minPlayers, 1),
      maxPlayers: numOr(d.maxPlayers, 99),
    });
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

  function handleGoToGame(d) {
    if (!d?.url || typeof d.url !== 'string') return;
    // Hardened same-origin check. `startsWith('/')` is NOT enough — '//evil.com'
    // and '/\evil.com' both pass that and would navigate off-origin. Parse the
    // URL and verify both the origin and that it's a known game prototype path.
    let target;
    try { target = new URL(d.url, window.location.origin); } catch { return; }
    if (target.origin !== window.location.origin) return;
    if (!target.pathname.startsWith('/prototypes/')) return;

    stopHeartbeat();
    if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
    window.location.href = target.pathname + target.search + target.hash;
  }

  function handleMatchCancelled(d) {
    if (!d?.matchId) return;
    if (!activeProposal || activeProposal.matchId !== d.matchId) return;
    const reasonText = ({
      declined: '매칭이 취소되었습니다.',
      invalid: '매칭이 취소되었습니다.',
    })[d.reason] || '매칭이 취소되었습니다.';
    matchStatus.textContent = reasonText;
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
    matchModal.classList.remove('hidden');
    matchModal.setAttribute('aria-hidden', 'false');
  }

  function closeMatchModal() {
    matchModal.classList.add('hidden');
    matchModal.setAttribute('aria-hidden', 'true');
    if (matchCloseTimer) { clearTimeout(matchCloseTimer); matchCloseTimer = null; }
    if (joystickEl) joystickEl.style.visibility = '';
    activeProposal = null;
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
    const isHost = !!(me && activeProposal.hostId === me.id);
    const min = activeProposal.minPlayers || 1;
    const count = activeProposal.members.length;
    const enough = count >= min;

    matchAcceptBtn.style.display = isHost ? '' : 'none';
    matchAcceptBtn.disabled = !enough;
    matchAcceptBtn.textContent = enough
      ? `시작 (${count}명)`
      : `최소 ${min}명 필요 (${count}/${min})`;
    matchDeclineBtn.disabled = false;
    matchDeclineBtn.textContent = '나가기';

    if (isHost) {
      matchStatus.textContent = enough
        ? '준비되면 시작을 누르세요.'
        : `최소 ${min}명이 되면 시작할 수 있어요.`;
    } else {
      matchStatus.textContent = '방장이 시작을 누르면 함께 입장합니다.';
    }
  }

  function sendMatchStart() {
    if (!activeProposal) return;
    if (!me || activeProposal.hostId !== me.id) return;
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
    // Close immediately for snappy feedback — server's zone_progress(null)
    // will also try to close but the modal is already gone.
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

  function handleServerError(d) {
    const msg = d?.message || '서버 오류';
    if (!me) {
      showJoinError(msg);
    } else {
      // Already in the world — surface but keep the session alive.
      console.warn('[world] server error:', d);
    }
  }

  function onClose() {
    setConnStatus(false);
    stopHeartbeat();
    // Tear down any open match proposal so its card + countdown don't linger.
    if (activeProposal) closeMatchModal();

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

  // ── Render loop ─────────────────────────────────────────────────────────────
  function startRenderLoop() {
    lastFrameAt = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      step(dt);
      draw();
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
    if (worldBgReady) {
      ctx.drawImage(worldBg, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#bfe09a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    drawZones();

    // Draw peers behind me so my avatar sits on top when overlapping.
    for (const p of peers.values()) drawAvatar(p, /* isYou */ false);
    if (me) drawAvatar(me, /* isYou */ true);

    // Overlays on top of everything.
    const now = performance.now();
    drawOverlays(now);
  }

  // Per-game booth theme — accent colour + a playful icon.
  const ZONE_THEME = {
    'jump-climber':        { color: '#ff9f4d', dark: '#d9791c', icon: '🧗' },
    'mallang-tug-war':     { color: '#5fd3a0', dark: '#33ab78', icon: '🪢' },
    'mallang-quiz-battle': { color: '#7db4ff', dark: '#4d83d9', icon: '🧠' },
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

  // A carnival-style game booth: striped awning, signboard, entrance pad.
  function drawBooth(z, r, st, inHere, near) {
    const t = zoneTheme(z);
    const cx = r.x + r.w / 2;
    ctx.save();

    // Proximity glow — soft rings while approaching or standing inside.
    if (near || inHere) {
      ctx.save();
      ctx.strokeStyle = t.color;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = (inHere ? 0.38 : 0.24) - i * 0.08;
        ctx.lineWidth = 2;
        roundRect(r.x - 3 - i * 3, r.y - 3 - i * 3, r.w + 6 + i * 6, r.h + 6 + i * 6, 16 + i * 3);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Entrance pad — subtle "stand here" marker at the booth base.
    const padY = r.y + r.h - 28;
    ctx.fillStyle = hexA(t.color, inHere ? 0.55 : 0.28);
    roundRect(r.x + 14, padY, r.w - 28, 22, 11);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(r.x + 18, padY + 3, r.w - 36, 6, 3);
    ctx.fill();

    // Booth illustration.
    const booth = getBoothImage(z.gameId);
    if (booth && booth.ready) {
      // Keep the booth scaled to fit inside the canvas. r.w + 40 means the
      // 320x320 booth image renders at 360x360 and the top edge of the top
      // booth (rect.y=150) lands at canvas y=16 instead of overflowing.
      const drawW = r.w + 40;
      const drawH = drawW * booth.img.height / booth.img.width;
      ctx.drawImage(booth.img, cx - drawW / 2, (r.y + r.h) - drawH + 6, drawW, drawH);
    }

    // Title — below the booth, dark halo for readability on grass.
    ctx.font = 'bold 14px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20,30,16,0.85)';
    ctx.strokeText(z.title, cx, r.y + r.h + 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(z.title, cx, r.y + r.h + 16);

    // Status line / countdown.
    if (inHere && myZoneProgress && myZoneProgress.zoneId === z.id) {
      drawZoneCountdown(z, r);
    } else {
      const enough = st.count >= z.minPlayers;
      const statusText = enough
        ? `대기 ${st.count}/${z.maxPlayers} · 곧 시작!`
        : `대기 ${st.count}/${z.maxPlayers} · ${z.minPlayers}명 모이면 시작`;
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,30,16,0.8)';
      ctx.strokeText(statusText, cx, r.y + r.h + 33);
      ctx.fillStyle = enough ? '#d6ffe6' : '#eef2ff';
      ctx.fillText(statusText, cx, r.y + r.h + 33);
    }
    ctx.restore();

    // Proximity tooltip floats above the booth.
    if (near) drawZoneTip(z, r, t);
  }

  function drawZoneTip(z, r, t) {
    const sec = Math.round((z.holdMs || 3000) / 1000);
    const text = `들어가서 ${sec}초 → 시작!`;
    ctx.save();
    ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 18;
    const cx = r.x + r.w / 2;
    const y = r.y - 66;
    ctx.fillStyle = t.dark;
    roundRect(cx - w / 2, y - 11, w, 22, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 5, y + 11); ctx.lineTo(cx, y + 16); ctx.lineTo(cx + 5, y + 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y);
    ctx.restore();
  }

  function drawZoneCountdown(zone, r) {
    if (!myZoneProgress) return;
    const elapsedClient = performance.now() - myZoneProgress.clientAt;
    // serverNow - candidateSince = elapsed at the moment server stamped this
    const baseElapsed = Math.max(0, myZoneProgress.serverNow - myZoneProgress.candidateSince);
    const elapsed = baseElapsed + elapsedClient;
    const remain = Math.max(0, myZoneProgress.holdMs - elapsed);
    const ratio = clamp(elapsed / myZoneProgress.holdMs, 0, 1);
    const cx = r.x + r.w / 2;

    ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const status = myZoneProgress.ready ? '준비 완료 — 모이는 중...' : `참가 준비 ${(remain / 1000).toFixed(1)}초`;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20,30,16,0.8)';
    ctx.strokeText(status, cx, r.y + r.h + 33);
    ctx.fillStyle = myZoneProgress.ready ? '#d6ffe6' : '#ffffff';
    ctx.fillText(status, cx, r.y + r.h + 33);

    // Progress bar.
    const padX = 18, barW = r.w - padX * 2, barH = 6;
    const barX = r.x + padX, barY = r.y + r.h + 39;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(barX, barY, barW, barH, 3);
    ctx.fill();
    ctx.fillStyle = myZoneProgress.ready ? '#6bdfa1' : '#ffd27a';
    roundRect(barX, barY, barW * ratio, barH, 3);
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
    ctx.font = '13px -apple-system, system-ui, sans-serif';
    const padX = 9, padY = 6, lineH = 16;
    const lines = wrapText(text, 220);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    const h = lines.length * lineH + padY * 2;
    // Sit above the sprite + name pill so the bubble doesn't overlap the
    // character head. Derived from current drawH(100) + name pill(~22) +
    // gap(~8) ≈ 130. Clamp to keep it inside the canvas top.
    const top = Math.max(8, cy - 130 - h);

    // Soft drop shadow for contrast over the grass.
    ctx.shadowColor = 'rgba(0,0,0,0.32)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    roundRect(cx - w / 2, top, w, h, 10);
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(cx - 6, top + h);
    ctx.lineTo(cx, top + h + 8);
    ctx.lineTo(cx + 6, top + h);
    ctx.closePath();
    ctx.fill();

    // Reset shadow before drawing text so the text stays crisp.
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = '#1a1410';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, cx, top + padY + i * lineH));
    ctx.restore();
  }

  function drawReaction(cx, cy, glyph, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(glyph, cx, cy - 30);
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

    // Shadow — slightly larger and softer so feet read as planted on the ground.
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(0, r + 4, r * 1.1, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Accent ring marks your own avatar.
    if (isYou) {
      ctx.strokeStyle = '#ffb96b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, r + 4, r * 1.18, r * 0.48, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const sprite = getSprite(p.characterId);
    let nameTagY = -r - 8;

    if (sprite.ready) {
      const dir = p.dir || 'down';
      const row = dir === 'down' ? 0 : dir === 'up' ? 2 : 1; // left/right -> side
      const col = p.moving ? (Math.floor(performance.now() / WALK_FRAME_MS) % 2) + 1 : 0;
      const fw = SPRITE_FRAME.width, fh = SPRITE_FRAME.height;
      const drawW = 100, drawH = 100;
      const destX = -drawW / 2;
      // Cells render the character at ~95% of cell height with ~5% bottom padding.
      // Anchor the visible bottom of the sprite onto the shadow center to kill
      // the "floating above shadow" feeling across down/side/up rows.
      const FOOT_FRACTION = 0.95;
      const destY = (r + 4) - drawH * FOOT_FRACTION;
      nameTagY = destY - 8;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      if (dir === 'left') ctx.scale(-1, 1);
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
      ctx.font = 'bold 15px -apple-system, system-ui, sans-serif';
      const w = ctx.measureText(name).width;
      const padX = 9, tagH = 22;
      const tagW = w + padX * 2;
      const tagTop = nameTagY - tagH;
      ctx.fillStyle = 'rgba(20, 30, 16, 0.78)';
      roundRect(-tagW / 2, tagTop, tagW, tagH, 11);
      ctx.fill();
      ctx.fillStyle = nameColor(p.name);
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
