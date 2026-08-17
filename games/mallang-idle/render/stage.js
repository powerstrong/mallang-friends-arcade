/*
 * 말랑프렌즈 키우기 — 전투 무대 씬 렌더러 (전투 화면 개편 단계 0)
 *
 * 이 모듈이 아레나(.arena) 안쪽 "세계"를 통째로 소유한다. game.js 는 이제 엔진을
 * 굴리고 사건을 이 모듈에 넘길 뿐, 전투 화면을 직접 그리지 않는다.
 *
 * 네 개의 하위 시스템으로 나눠 둔다 — 이후 단계가 각각을 안에서 갈아끼운다
 * (../COMBAT_STAGE_OVERHAUL.md 6절):
 *
 *   parallax  시차 배경 스택   → 단계 2 에서 하늘·원경·중경 3겹이 더 붙는다
 *   actors    액터(우리 편·적) → 단계 2·3 에서 상태별 다중 프레임 애니메이션으로 교체
 *   camera    카메라           → 단계 4 에서 줌·팬·슬로모가 붙는다
 *   particles 캔버스 파티클    → 단계 1 에서 DOM 이펙트를 전부 흡수한다
 *
 * 규칙 (AGENT_PROTOCOL 2절):
 *   - 여기는 표현 계층이다. 엔진 상태를 **읽기만** 한다. 데미지·처치·진행을 다시
 *     계산하지 않는다. 화면을 위해 밸런스를 건드리면 지표가 거짓말을 한다.
 *   - Math.random 은 표현 계층이라 허용된다(결정론과 무관한 지터·장식).
 */
/* 표현 계층이라 브라우저 전역(matchMedia·devicePixelRatio·ResizeObserver)을 쓴다 —
 * 그래서 UMD 팩토리가 root 를 인자로 받는다(엔진 모듈들은 받지 않는다). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleStage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /* 연출 beat 길이(초) — "이 사건이 화면에서 최소 이만큼은 보인다".
   * 엔진의 실제 간격과 다르며, 밀리면 queue.js 가 가속해 따라잡는다.
   * 단계 2 에서 전진 구간을 늘리며 이 표를 다시 만진다. */
  var BEAT = {
    mob_spawn: 0.20,
    mob_kill: 0.55,
    boss_start: 0.70,
    boss_clear: 0.90,
    boss_fail: 0.60,
  };

  var FX_CAP = 26;          // 동시 DOM 이펙트 노드 상한 — 저사양 보호 (단계 1 에서 캔버스로 이관)
  var PARTICLE_CAP = 400;   // 동시 캔버스 파티클 상한
  /* 정보 예산 예약 — 상한 포화에서 장식(스파크·먼지)이 정보(처치 확인·골드)를 밀어내면
   * 안 된다. 장식은 (PARTICLE_CAP - INFO_RESERVE) 까지만, 정보는 끝까지 받는다. */
  var INFO_RESERVE = 48;

  /* FX 시트 스펙 — 기존 플립북 에셋을 캔버스 drawImage 로 재생한다(품질 유지).
   * slash 는 시트가 아니라 단일 이미지 + 변형 궤적이다. decode 가 끝나기 전에는
   * 절차적 폴백으로 그린다 — 첫 임팩트가 유실되지 않게. */
  var SHEETS = {
    impact: { src: 'assets/fx-impact-sheet.png', frames: 4 },
    poof:   { src: 'assets/fx-poof-sheet.png',   frames: 4 },
    slash:  { src: 'assets/fx-slash.png',        frames: 1 },
    star:   { src: 'assets/fx-star.png',         frames: 1 },
  };

  var AMBIENT_ART = {
    meadow: 'assets/pt-petal.png', garden: 'assets/pt-petal.png',
    gears: 'assets/pt-gear.png', machine: 'assets/pt-gear.png', core: 'assets/pt-gear.png',
    starsea: 'assets/fx-star.png', moonfactory: 'assets/pt-gear.png',
  };

  function create(opts) {
    var el = opts.el;
    var Chapters = opts.Chapters, Chars = opts.Chars, Combat = opts.Combat;
    var B = opts.balance;
    var Queue = opts.Queue;
    var sfx = opts.sfx || function () {};
    var fmt = opts.fmt || String;

    var reducedMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* 화면에 서 있는 것 — 엔진 상태의 사본이 아니라 "연출이 어디까지 진행됐는가"다.
     * 큐가 비면 syncTo() 가 엔진 진실로 스냅하므로 영구히 어긋나지 않는다. */
    var view = { mode: 'advance', enemyKey: '', alive: false, isBoss: false };
    var party = [];

    // ── 카메라 ────────────────────────────────────────────────
    /* 단계 0 에서는 흔들림만 한다. 줌·팬·슬로모는 단계 4.
     * 흔들림 대상이 .arena 가 아니라 .stage-cam 인 것이 중요하다 — HUD(진행도·보스
     * 타이머)는 흔들리지 않아야 읽힌다(F 기둥). */
    var camera = {
      scale: 1,
      x: 0, y: 0,
      shakeAmp: 0, shakeT: 0, shakeDur: 0,
      shake: function (amp, dur) {
        if (reducedMotion) return;
        // 이미 더 센 흔들림이 진행 중이면 덮어쓰지 않는다(돌파 연출이 잔진동에 먹히지 않게)
        if (this.shakeT > 0 && this.shakeAmp > amp) return;
        this.shakeAmp = amp; this.shakeDur = dur; this.shakeT = dur;
      },
      update: function (dt) {
        if (this.shakeT > 0) {
          this.shakeT -= dt;
          var k = Math.max(0, this.shakeT / this.shakeDur);   // 선형 감쇠
          var a = this.shakeAmp * k * k;
          this.x = (Math.random() * 2 - 1) * a;
          this.y = (Math.random() * 2 - 1) * a * 0.6;
        } else { this.x = 0; this.y = 0; }
        var t = (this.x || this.y)
          ? 'translate(' + this.x.toFixed(2) + 'px,' + this.y.toFixed(2) + 'px)'
          : '';
        if (t !== this._last) { el.cam.style.transform = t; this._last = t; }
      },
      _last: null,
    };

    // ── FX 시계 ──────────────────────────────────────────────
    /* 히트스톱은 **파티클 하위 시계만** 멈춘다 (COMBAT_STAGE_OVERHAUL 6절 결정 1).
     * 엔진·큐·HUD·카메라 셰이크는 계속 돈다 — 여기가 멈추면 밸런스 영향 0 위반.
     * DOM 쪽 정지(.arena.hitstop 의 animation-play-state)도 이 시계가 함께 구동해
     * 캔버스와 DOM 이 같은 순간에 얼고 같은 순간에 풀린다. 중첩되면 더 긴 쪽이 이긴다. */
    var hitstopT = 0;
    function hitstop(sec) {
      if (reducedMotion) return;               // 감속 모드 — 정지 연출도 움직임의 일부다
      if (sec > hitstopT) hitstopT = sec;
      el.arena.classList.add('hitstop');
    }

    // ── 캔버스 파티클 ─────────────────────────────────────────
    /* 단계 1 이 스파크·파편·궤적·골드를 전부 여기로 옮긴다.
     * 좌표는 전부 **세계 좌표 = fx-canvas 로컬 CSS px** 다. DOM 이펙트(.fx-layer)와
     * 원점이 달라 117px 어긋나던 버그를 여기서 통일했다 — DOM 쪽은 spawnFx 가
     * 세계 좌표를 레이어 좌표로 변환해 받는다. */
    var ctx = el.fxCanvas ? el.fxCanvas.getContext('2d') : null;
    var pool = [];
    var pcount = 0;
    var cssW = 0, cssH = 0;

    function resize() {
      if (!el.fxCanvas) return;
      var r = el.fxCanvas.getBoundingClientRect();
      var dpr = Math.min(root.devicePixelRatio || 1, 2);   // 2 초과는 비용만 크고 차이가 안 보인다
      cssW = r.width; cssH = r.height;
      el.fxCanvas.width = Math.max(1, Math.round(cssW * dpr));
      el.fxCanvas.height = Math.max(1, Math.round(cssH * dpr));
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* 시트 이미지 캐시 — 모듈 생성 시 한 번만 로드하고 decode 완료를 기록한다.
     * 파티클마다 Image 를 만들지 않는다. ready 전 사용처는 절차적 폴백을 그린다. */
    var sheetImgs = {};
    (function loadSheets() {
      if (!root.Image) return;                 // 브라우저 밖(정적 검사)에서는 그리지 않는다
      Object.keys(SHEETS).forEach(function (k) {
        var s = SHEETS[k];
        var img = new root.Image();
        var entry = { img: img, ready: false, frames: s.frames };
        img.onload = function () {
          if (img.decode) img.decode().then(function () { entry.ready = true; },
                                            function () { entry.ready = true; });
          else entry.ready = true;
        };
        img.src = s.src;
        sheetImgs[k] = entry;
      });
    })();
    function sheetReady(name) { return !!(sheetImgs[name] && sheetImgs[name].ready); }

    var lastEmit = null;   // 좌표 회귀 테스트용 — 마지막 스폰의 세계 좌표
    function emit(kind, x, y, o) {
      o = o || {};
      var info = !!o.info;
      if (!ctx) return;
      /* 정보/장식 이원화 (결정 2) — 감속 모드에서 장식은 0, 정보는 "저동작 대체"로
       * 남는다(속도·성장 제거, 페이드만). 상한 포화에서는 장식부터 거절한다. */
      if (reducedMotion && !info) return;
      if (pcount >= PARTICLE_CAP) return;
      if (!info && pcount >= PARTICLE_CAP - INFO_RESERVE) return;
      var p = pool.length > pcount ? pool[pcount] : (pool[pcount] = {});
      pcount++;
      p.kind = kind; p.x = x; p.y = y;
      p.vx = o.vx || 0; p.vy = o.vy || 0;
      p.life = o.life || 0.4; p.age = 0;
      p.size = o.size || 14; p.grow = o.grow || 1.8;
      p.color = o.color || '205, 185, 160';
      p.alpha = o.alpha != null ? o.alpha : 0.9;
      p.info = info;
      if (reducedMotion) { p.vx = 0; p.vy = 0; p.grow = 1; }
      lastEmit = { kind: kind, x: x, y: y, info: info };
      return p;
    }

    function particlesUpdate(dt) {
      if (!(dt > 0)) return;
      for (var i = 0; i < pcount; i++) {
        var p = pool[i];
        p.age += dt;
        if (p.age >= p.life) {                 // 죽은 것은 마지막 것과 교체(스왑 제거 — 할당 없음)
          var last = pool[pcount - 1];
          pool[pcount - 1] = p; pool[i] = last;
          pcount--; i--;
          continue;
        }
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    }

    function particlesDraw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, cssW, cssH);
      for (var i = 0; i < pcount; i++) {
        var p = pool[i];
        var k = p.age / p.life;                 // 0 → 1
        var sz = p.size * (1 + (p.grow - 1) * k);
        ctx.globalAlpha = p.alpha * (1 - k);
        ctx.fillStyle = 'rgba(' + p.color + ',1)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, sz, sz * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* 발밑 먼지 — 돌진 시작·보스 착지. CSS .fx-dust 를 대체한다(캔버스 파이프라인 증명). */
    function dustPuff(x, y, big) {
      var n = big ? 7 : 4;
      for (var i = 0; i < n; i++) {
        emit('dust', x + (Math.random() * 10 - 5), y,
          { vx: -30 - Math.random() * 45, vy: -6 - Math.random() * 14,
            life: 0.34 + Math.random() * 0.16,
            size: (big ? 11 : 7) + Math.random() * 5, grow: 2.1, alpha: 0.8 });
      }
    }

    // ── 시차 배경 ─────────────────────────────────────────────
    /* 단계 2 에서 sky/far/mid 레이어가 이 배열에 추가된다. 지금은 기존 2겹 그대로. */
    var LAYERS = [
      { node: el.bgLayer, factor: 1.0, key: 'bg' },
      { node: el.fgLayer, factor: 1.8, key: 'fg' },
    ];
    var scrollX = 0;

    function setChapter(ch) {
      el.bgLayer.style.backgroundImage = "url('" + ch.bg + "')";
      el.fgLayer.style.backgroundImage = ch.fg ? "url('" + ch.fg + "')" : 'none';
    }

    function parallaxUpdate(dt) {
      if (view.mode !== 'advance') return;      // 전진 중에만 세계가 흐른다
      scrollX -= dt * 90;
      for (var i = 0; i < LAYERS.length; i++) {
        var L = LAYERS[i];
        if (L.node) L.node.style.backgroundPositionX = (scrollX * L.factor) + 'px';
      }
    }

    // ── 앰비언트 파티클 (챕터 공기) ───────────────────────────
    var ambientTimer = 0, ambientCount = 0;
    function ambientUpdate(dt, state) {
      if (reducedMotion) return;
      ambientTimer += dt;
      if (ambientTimer < 0.8) return;
      ambientTimer = 0;
      if (ambientCount >= 8) return;
      var art = AMBIENT_ART[Chapters.chapterFor(state.stage).id];
      if (!art) return;
      ambientCount++;
      var n = document.createElement('img');
      n.className = 'ambient-pt';
      n.src = art;
      n.style.left = (Math.random() * 100) + '%';
      n.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
      n.style.setProperty('--dur', (3.5 + Math.random() * 2.5) + 's');
      n.style.setProperty('--sz', (10 + Math.random() * 10) + 'px');
      el.ambientLayer.appendChild(n);
      n.addEventListener('animationend', function () { n.remove(); ambientCount--; });
    }

    // ── DOM 이펙트 (단계 1 에서 캔버스로 흡수) ────────────────
    /* 좌표 인자는 **세계 좌표**다 — 캔버스와 같은 원점. 레이어 변환은 여기서 한 번만. */
    var fxCount = 0;
    function spawnFx(cls, x, y, ttl, text) {
      if (fxCount >= FX_CAP) return null;
      fxCount++;
      var lp = layerPoint(x, y);
      var n = document.createElement(text != null ? 'span' : 'i');
      n.className = cls;
      if (text != null) n.textContent = text;
      n.style.left = lp.x + 'px';
      n.style.top = lp.y + 'px';
      /* 제거는 반드시 한 곳에서 — TTL 과 onfinish 가 각자 지우면 fxCount 가 이중 감소해
       * 음수로 내려가고 상한이 무력화된다(codex 리뷰). */
      n.__dispose = function () {
        if (n.__done) return;
        n.__done = true;
        n.remove();
        fxCount--;
      };
      el.fxLayer.appendChild(n);
      setTimeout(n.__dispose, ttl);
      return n;
    }

    /* 세계 좌표 = fx-canvas 로컬 CSS px. 캔버스와 DOM 이펙트가 **같은 좌표계**를 쓴다
     * (전에는 fxLayer 원점 기준이라 캔버스 그림이 117px 위에 찍혔다 — codex 리뷰).
     * 캔버스도 카메라(.stage-cam) 안에 있으므로 배율만큼 나눠 되돌린다 — 단계 4 에서
     * 줌이 붙어도 이펙트가 엉뚱한 곳에 찍히지 않는다. */
    function worldPoint(node, yRatio) {
      var cr = el.fxCanvas.getBoundingClientRect();
      var nr = node.getBoundingClientRect();
      var sc = camera.scale || 1;
      return {
        x: (nr.left + nr.width * 0.5 - cr.left) / sc,
        y: (nr.top + nr.height * yRatio - cr.top) / sc,
      };
    }
    function enemyPoint() { return worldPoint(el.enemyArt, 0.55); }
    function footPoint(node) {
      var cr = el.fxCanvas.getBoundingClientRect();
      var nr = node.getBoundingClientRect();
      var sc = camera.scale || 1;
      return { x: (nr.left + nr.width * 0.5 - cr.left) / sc, y: (nr.bottom - cr.top - 4) / sc };
    }
    /* 세계 좌표 → .fx-layer 로컬 좌표 (DOM 이펙트 배치용) */
    function layerPoint(wx, wy) {
      var cr = el.fxCanvas.getBoundingClientRect();
      var fr = el.fxLayer.getBoundingClientRect();
      var sc = camera.scale || 1;
      return { x: wx - (fr.left - cr.left) / sc, y: wy - (fr.top - cr.top) / sc };
    }

    var lastFxAt = 0;
    function fxReady() {
      var now = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
      if (now - lastFxAt < 400) return false;
      lastFxAt = now;
      return true;
    }

    function confettiBurst() {
      for (var i = 0; i < 10; i++) {
        var p = document.createElement('i');
        p.className = 'confetti';
        p.style.left = (35 + Math.random() * 30) + '%';
        p.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
        p.style.background = ['#ff7ea8', '#f0a72c', '#57b894', '#b08cff'][i % 4];
        p.style.animationDelay = (Math.random() * 0.1) + 's';
        el.arena.appendChild(p);
        (function (node) { setTimeout(function () { node.remove(); }, 1100); })(p);
      }
    }

    function speedLineFlash() {
      el.speedLines.hidden = false;
      el.speedLines.classList.remove('flash');
      void el.speedLines.offsetWidth;
      el.speedLines.classList.add('flash');
      setTimeout(function () { el.speedLines.hidden = true; }, 480);
    }

    /* 구출 연출 — 챕터 피날레에서 하트가 쏟아진다 (game.js 가 컷신 종료 때 부른다) */
    function heartBurst() {
      for (var i = 0; i < 8; i++) {
        var h = document.createElement('i');
        h.className = 'fx-heartp';
        h.style.left = (30 + Math.random() * 45) + '%';
        h.style.top = (30 + Math.random() * 25) + '%';
        h.style.setProperty('--hd', (Math.random() * 1.2) + 's');
        el.arena.appendChild(h);
        (function (node) { setTimeout(function () { node.remove(); }, 2400); })(h);
      }
    }

    var floatAccum = 0, floatCooldown = 0;
    function floatGold(amount) {
      floatAccum += amount;
      if (floatCooldown > 0) return;
      floatCooldown = 0.25;
      sfx('coin');
      var n = document.createElement('div');
      n.className = 'gold-float';
      n.textContent = '+' + fmt(floatAccum);
      floatAccum = 0;
      el.field.appendChild(n);
      setTimeout(function () { n.remove(); }, 900);
    }

    // ── 액터 ──────────────────────────────────────────────────
    /* 프레임 폭이 캐릭터마다 달라 background-size 까지 함께 바꿔야 워크사이클이 안 어긋난다.
     * 단계 2·3 에서 이 함수가 "상태별 시트"를 다루도록 확장된다. */
    function applySprite(node, c) {
      node.style.width = c.frameW + 'px';
      node.style.backgroundImage = "url('" + c.walk + "')";
      node.style.backgroundSize = (c.frameW * 3) + 'px 220px';
      node.style.setProperty('--walk-shift', '-' + (c.frameW * 3) + 'px');
    }

    var lastPartyKey = '';
    function syncParty(state) {
      var key = (state.party || []).join(',');
      if (!key || key === lastPartyKey) return;
      lastPartyKey = key;
      party = state.party.slice();
      var lead = Chars.byId(party[0]);
      if (lead) applySprite(el.hero, lead);
      [el.follower1, el.follower2].forEach(function (node, i) {
        var c = party[i + 1] ? Chars.byId(party[i + 1]) : null;
        node.hidden = !c;
        if (c) applySprite(node, c);
      });
    }

    var lastLocomotion = null;
    function setLocomotion(walking, isBoss) {
      var key = (walking ? 'w' : 'f') + (isBoss ? 'b' : '');
      if (key === lastLocomotion) return;
      lastLocomotion = key;
      el.hero.classList.toggle('walking', walking);
      el.hero.classList.toggle('fighting', !walking);
      [el.follower1, el.follower2].forEach(function (n) {
        n.classList.toggle('walking', walking);
        n.classList.toggle('fighting', !walking);
      });
      // 교전 대형 — 적에게 다가선다 (멀리서 허공 펀치 금지)
      el.field.classList.toggle('engaged', !walking);
      el.field.classList.toggle('vs-boss', !!isBoss);
    }

    function showEnemy(art, isBoss) {
      var key = (isBoss ? 'B' : 'M') + art.id;
      view.enemyKey = key;
      view.alive = true;
      view.isBoss = !!isBoss;
      el.enemyArt.src = art.art;
      el.enemyName.textContent = art.name;
      el.enemy.classList.toggle('is-boss', !!isBoss);
      el.enemy.hidden = false;
      el.bossRing.hidden = !isBoss;
      el.enemyHpFill.style.width = '100%';
      // 등장 연출 — 몹은 폴짝, 보스는 쿵 하고 내려온다 (착지 순간 발밑 먼지)
      el.enemyArt.classList.remove('spawn-in', 'boss-in');
      void el.enemyArt.offsetWidth;
      el.enemyArt.classList.add(isBoss ? 'boss-in' : 'spawn-in');
      if (isBoss) {
        setTimeout(function () {
          if (!view.alive) return;
          var bp = footPoint(el.enemyArt);
          dustPuff(bp.x, bp.y, true);
          camera.shake(3, 0.26);
        }, 250);   // bossIn 55% 지점(≈250ms)이 착지 프레임
      }
    }

    function hideEnemy() {
      view.alive = false;
      view.enemyKey = '';
      el.enemy.hidden = true;
      el.bossRing.hidden = true;
    }

    // ── 연출 beat 재생 ────────────────────────────────────────
    function beatDuration(ev) { return BEAT[ev.type] || 0; }

    function playBeat(ev, info) {
      var collapsed = info.collapsed;
      switch (ev.type) {
        case 'mob_spawn':
          view.mode = 'fight';
          setLocomotion(false, false);
          showEnemy(Chapters.mobFor(ev.stage, ev.index), false);
          break;

        case 'boss_start':
          view.mode = 'boss';
          setLocomotion(false, true);
          showEnemy(Chapters.bossFor(ev.stage), true);
          break;

        case 'mob_kill':
          if (!collapsed && view.alive) {
            var pp = enemyPoint();
            spawnFx('fx-poof', pp.x, pp.y, 460);
            sfx('kill');
          }
          if (!collapsed) floatGold(ev.gold);
          else floatAccum += ev.gold;          // 몰아보기 — 숫자는 다음 표시에 합산된다
          hideEnemy();
          view.mode = 'advance';
          setLocomotion(true, false);
          break;

        case 'boss_clear':
          if (!collapsed) {
            if (fxReady()) { camera.shake(4.5, 0.34); confettiBurst(); }
            speedLineFlash();
          }
          hideEnemy();
          view.mode = 'advance';
          setLocomotion(true, false);
          break;

        case 'boss_fail':
          hideEnemy();
          view.mode = 'advance';
          setLocomotion(true, false);
          break;

        default:
          break;   // upgrade·relic 등은 무대 사건이 아니다
      }
    }

    /* 연출이 다 끝났으면 화면을 엔진 진실로 스냅한다. 이 한 줄이 "표현이 영구히
     * 어긋나지 않는다"를 보장한다 — 부팅·컷신 복귀·오프라인 복귀·dev 점프 전부 포함. */
    function syncTo(state) {
      var walking = state.phase === Combat.PHASE_ADVANCE;
      if (walking) {
        if (view.mode !== 'advance' || view.alive) {
          view.mode = 'advance';
          hideEnemy();
        }
        setLocomotion(true, false);
        return;
      }
      var isBoss = state.phase === Combat.PHASE_BOSS;
      var art = isBoss ? Chapters.bossFor(state.stage) : Chapters.mobFor(state.stage, state.mobIndex);
      var key = (isBoss ? 'B' : 'M') + art.id;
      view.mode = isBoss ? 'boss' : 'fight';
      setLocomotion(false, isBoss);
      if (key !== view.enemyKey || !view.alive) showEnemy(art, isBoss);
    }

    // ── 타격 연출 ─────────────────────────────────────────────
    /* 엔진은 연속 DPS 로 계산하지만 화면은 "때리는 순간"이 보여야 산다.
     * 공격 속도에 맞춰 돌진-타격을 틱으로 재생하고, 틱 사이에 깎인 HP 를 숫자로 뭉친다.
     * 단계 3 에서 캐릭터별 다중 프레임 공격·스킬로 교체된다. */
    var strikeAccum = 0, strikeGap = 0, dmgSince = 0;
    var strikeCount = 0, restoreTimer = 0, poseSwapped = false;
    var followerTimers = [0, 0];

    function swapToAttackPose() {
      var c = Chars.byId(party[0]);
      if (!c || !c.atk) return;
      el.hero.style.backgroundImage = "url('" + c.atk + "')";
      el.hero.style.width = c.atkW + 'px';
      el.hero.style.backgroundSize = c.atkW + 'px 220px';
      poseSwapped = true;
    }
    function restoreWalkPose() {
      if (!poseSwapped) return;
      poseSwapped = false;
      var c = Chars.byId(party[0]);
      if (c) applySprite(el.hero, c);
    }

    /* 타격 접점 통일 — 돌진 거리가 고정이면 캐릭터 폭(139~301px)에 따라 주먹이 적을
     * 뚫거나 허공에 멈춘다. 매 타격 실제 간격을 재서 살짝(12px) 파고드는 지점까지만. */
    function syncLunge() {
      var hr = el.hero.getBoundingClientRect();
      var er = el.enemyArt.getBoundingClientRect();
      if (!hr.width || !er.width) return;
      var sc = parseFloat(getComputedStyle(el.hero).getPropertyValue('--sc')) || 0.4;
      var gap = er.left - hr.right;
      var reach = (gap + 12) / sc;
      if (!isFinite(reach)) return;
      reach = Math.max(24, Math.min(170, Math.round(reach)));
      el.hero.style.setProperty('--lunge', reach + 'px');
    }

    function heroStrike(dmg) {
      strikeCount++;
      var crit = strikeCount % 5 === 0;          // 표현 전용 — 5타마다 강조 연출
      el.hero.classList.remove('strike');
      void el.hero.offsetWidth;
      el.hero.classList.add('strike');
      swapToAttackPose();
      syncLunge();
      sfx('hit');
      var p = enemyPoint();     // 좌표는 지금 고정 — 접촉까지 적이 바뀌어도 빈 곳에 안 찍힌다
      var fp = footPoint(el.hero);
      dustPuff(fp.x, fp.y, false);

      /* 접촉은 heroStrike 키프레임 40% 지점(300ms × 0.4 = 120ms) — CSS 와 함께 움직인다 */
      setTimeout(function () {
        var jx = (Math.random() - 0.5) * 26, jy = (Math.random() - 0.5) * 20;

        var slash = spawnFx('fx-slash', p.x + jx - 6, p.y + jy - 4, 240);
        if (slash) slash.style.setProperty('--rot', Math.floor(Math.random() * 50 - 25) + 'deg');

        var imp = spawnFx('fx-impact' + (crit ? ' crit' : ''), p.x + jx, p.y + jy, 340);
        if (imp) imp.style.setProperty('--rot', Math.floor(Math.random() * 70 - 35) + 'deg');

        /* 숫자는 언제나 실제 누적 피해다 — 5타 강조는 리듬 연출이지 추가 피해가 아니다. */
        spawnFx('fx-dmg' + (crit ? ' crit' : ''), p.x + jx, p.y + jy - 28, 640, fmt(dmg));

        el.enemy.classList.remove('squash');
        void el.enemy.offsetWidth;
        el.enemy.classList.add('squash');

        /* 히트스톱 — 접촉 순간 모두가 잠깐 멈춘다 (타격감의 절반).
         * setTimeout 해제가 아니라 stage FX 시계가 건다/푼다 — 캔버스 파티클과
         * DOM(animation-play-state)이 같은 순간에 얼고 같은 순간에 풀린다. */
        hitstop(crit ? 0.09 : 0.055);
        if (crit) camera.shake(2, 0.16);
      }, 120);

      /* 연타 시 이전 복원 타이머가 다음 타격의 공격 포즈를 중간에 되돌리는 경합 방지 */
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(restoreWalkPose, 320);
    }

    /* 지원 사격 — 2·3번 동료가 자기 주기로 별을 던진다. 데미지는 이미 편성 보너스로
     * DPS 에 녹아 있으므로 숫자는 띄우지 않는다(두 배로 세 보이면 거짓말이다). */
    function followerShot(node) {
      var cr = el.fxCanvas.getBoundingClientRect();
      var nr = node.getBoundingClientRect();
      var sc = camera.scale || 1;
      var from = { x: (nr.left + nr.width * 0.6 - cr.left) / sc, y: (nr.top + nr.height * 0.35 - cr.top) / sc };
      var to = enemyPoint();
      var star = spawnFx('fx-proj', from.x, from.y, 520);
      if (!star) return;
      node.classList.remove('cast');
      void node.offsetWidth;
      node.classList.add('cast');
      var dx = to.x - from.x, dy = to.y - from.y;
      star.animate([
        { transform: 'translate(0,0) rotate(0deg)' },
        { transform: 'translate(' + (dx * 0.5) + 'px,' + (dy * 0.5 - 34) + 'px) rotate(180deg)' },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(360deg)' },
      ], { duration: 430, easing: 'linear' }).onfinish = function () {
        star.__dispose();
        spawnFx('fx-impact small', to.x, to.y, 280);
      };
    }

    function combatFxUpdate(dt, simDt, state) {
      if (floatCooldown > 0) floatCooldown -= dt;

      /* 데미지 숫자는 실제 깎이는 HP 와 같아야 한다 — 보스전은 bossDps(라떼·나침반 포함). */
      var fighting = view.mode !== 'advance' && view.alive;
      dmgSince += (state.phase === Combat.PHASE_BOSS ? Combat.bossDps(state) : Combat.dps(state)) * simDt;
      if (!fighting) { dmgSince = 0; return; }

      // 타격 틱: 공속을 따르되 눈이 따라갈 상한(초당 4회)을 둔다
      var rate = Math.min(4, Combat.effAspd(state));
      strikeGap += dt;
      strikeAccum += dt * rate;
      if (strikeAccum >= 1 && strikeGap >= 0.22) {
        strikeAccum = 0; strikeGap = 0;
        heroStrike(dmgSince);
        dmgSince = 0;
      }

      // 동료 지원 사격 — 서로 어긋난 주기로
      [el.follower1, el.follower2].forEach(function (node, i) {
        if (node.hidden) return;
        followerTimers[i] += dt;
        var cycle = 1.7 + i * 0.6;
        if (followerTimers[i] >= cycle) {
          followerTimers[i] = 0;
          followerShot(node);
        }
      });
    }

    // ── 연출 큐 ───────────────────────────────────────────────
    var queue = Queue.create({ duration: beatDuration, onEvent: playBeat });

    /* 매 프레임. dt = 실제 프레임 간격(연출 시계), simDt = 엔진에 준 시간(배속 포함).
     * 연출은 dt 로 돌고, "얼마나 아팠나"만 simDt 를 따른다. */
    function update(dt, simDt, state) {
      syncParty(state);
      queue.update(dt);
      if (queue.idle()) syncTo(state);

      parallaxUpdate(dt);
      ambientUpdate(dt, state);
      combatFxUpdate(dt, simDt, state);

      // 적 HP 는 엔진 진실을 그대로 보여준다(F 기둥 — 가독성은 연출보다 우선)
      if (view.alive && state.enemyMaxHp > 0) {
        var ratio = Math.max(0, state.enemyHp / state.enemyMaxHp);
        el.enemyHpFill.style.width = (ratio * 100) + '%';
      }

      camera.update(dt);

      /* FX 시계 — 히트스톱 동안 **파티클 하위 시계만** 언다 (결정 1). 엔진·큐·카메라·
       * HUD 는 위에서 이미 정상 dt 로 갱신됐다. DOM 정지(.hitstop)도 여기서 풀어
       * 캔버스와 DOM 이 같은 프레임에 해동된다. */
      var fxDt = dt;
      if (hitstopT > 0) {
        hitstopT -= dt;
        fxDt = 0;
        if (hitstopT <= 0) { hitstopT = 0; el.arena.classList.remove('hitstop'); }
      }
      particlesUpdate(fxDt);
      particlesDraw();
    }

    resize();
    if (root.ResizeObserver && el.fxCanvas) {
      new root.ResizeObserver(resize).observe(el.fxCanvas);
    } else {
      root.addEventListener('resize', resize);
    }

    return {
      push: function (events) { queue.push(events); },
      update: update,
      setChapter: setChapter,
      syncParty: syncParty,
      heartBurst: heartBurst,
      resize: resize,
      queue: queue,
      camera: camera,
      view: view,
      reducedMotion: reducedMotion,
      // 연출 검증용 — 헤드리스에선 rAF 가 멈춰 자연 발화를 볼 수 없다
      fx: {
        strike: heroStrike,
        shot: followerShot,
        dust: dustPuff,
        particleCount: function () { return pcount; },
        poofAt: function () { var p = enemyPoint(); return spawnFx('fx-poof', p.x, p.y, 460); },
        /* 단계 1 회귀용 훅 — 좌표 일치·히트스톱 정지·정책·성능을 밖에서 검증한다 */
        emit: emit,
        snapshot: function () {
          var out = [];
          for (var i = 0; i < pcount; i++) out.push({ x: pool[i].x, y: pool[i].y, age: pool[i].age });
          return out;
        },
        stepDraw: function (dt) { particlesUpdate(dt); particlesDraw(); },
        enemyPoint: enemyPoint,
        footOf: function (id) { return footPoint(el[id] || el.hero); },
        layerPoint: layerPoint,
        hitstopRemaining: function () { return hitstopT; },
        forceHitstop: hitstop,
        sheetReady: sheetReady,
        lastEmit: function () { return lastEmit; },
        caps: function () { return { particle: PARTICLE_CAP, reserve: INFO_RESERVE, dom: FX_CAP, domCount: fxCount }; },
      },
    };
  }

  return { create: create, BEAT: BEAT, FX_CAP: FX_CAP, PARTICLE_CAP: PARTICLE_CAP, INFO_RESERVE: INFO_RESERVE, SHEETS: SHEETS };
});
