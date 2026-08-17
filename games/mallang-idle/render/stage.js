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
   * 단계 2: mob_kill 을 0.55→0.95 로 늘렸다 — 처치 후 다음 몹 등장까지가 "전진
   * 구간"이고, 이 beat 의 꼬리가 걷는 시간이다(A기둥: 전진이 순간이동으로 보이면
   * 실패). 엔진 advanceSeconds(0.6)는 불변 — 밀림은 큐 가속이 흡수한다. */
  var BEAT = {
    mob_spawn: 0.30,
    mob_kill: 0.95,
    boss_start: 0.70,
    boss_clear: 1.05,
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

  /* 원경 실루엣 플레이스홀더의 챕터 무드 색 (단계 2) — 표현 계층 소유라 data/* 불변.
   * 전용 아트가 없는 챕터가 생기면 이 틴트 그라디언트가 폴백으로 남는다. */
  var FAR_TINT = {
    meadow: 'rgba(122, 156, 110, .30)', garden: 'rgba(150, 170, 105, .30)',
    gears: 'rgba(150, 132, 150, .30)', machine: 'rgba(140, 126, 148, .32)',
    core: 'rgba(158, 118, 138, .32)',
    starsea: 'rgba(96, 116, 178, .34)', moonfactory: 'rgba(134, 128, 158, .32)',
  };

  /* 시차 전용 아트 (7.3절 — 단계 2 부채 해소, imagegen 위탁분).
   * far = 원경 실루엣 띠(챕터별), sky = 하늘 장식 띠(야외 챕터만 — 실내 기계 구간은
   * setChapter 의 기존 감쇠 규칙이 그대로 적용된다). 없으면 CSS 플레이스홀더 폴백. */
  var FAR_ART = {
    meadow: 'assets/far-meadow.png', gears: 'assets/far-gears.png',
    machine: 'assets/far-machine.png', core: 'assets/far-core.png',
    garden: 'assets/far-garden.png',
    starsea: 'assets/far-starsea.png', moonfactory: 'assets/far-moonfactory.png',
  };
  var SKY_ART = {
    meadow: 'assets/sky-day.png', garden: 'assets/sky-day.png',
    starsea: 'assets/sky-star.png',
  };

  /* ── 단계 3: 전투 안무 (B기둥) — 캐릭터별 공격 + 스킬 ────────────────────
   * `heroStrike` 단일 돌진 반복을 폐기한다. 이 표들은 **표현 계층 소유**다 —
   * data/characters.js 의 스킬 '수치'(atkMul 0.20 등)는 한 줄도 안 건드린다.
   * 여기서 정하는 건 그 스킬의 '그림'(모션·궤적·타이밍·정체성 FX)뿐이다.
   *
   * 에셋 노트: 다중 프레임 시트(7.1절 attack_basic/attack_special)는 imagegen
   * 위탁분이다. 그게 오기 전까지는 기존 단일 공격 포즈(atk-*.png) 위에 **모션
   * 변주**로 시스템을 완성한다 — "에셋 대기로 정체 금지"(9절). 시트가 오면
   * applySprite 가 상태별 프레임 스왑으로 확장된다(부채로 남긴다). */
  var STRIKE_STYLES = {
    /* dur = CSS 애니메이션 길이(ms, 아래 @keyframes 와 일치), contact = 접점 비율,
     * lungeK = 돌진 거리 배수, tint = 임팩트 스파크/섬광 색(캐릭터 정체성 색). */
    slam:  { cls: 'st-slam',  dur: 360, contact: 0.42, lungeK: 1.16, tint: '255, 206, 138' },
    combo: { cls: 'st-combo', dur: 250, contact: 0.34, lungeK: 0.86, tint: '255, 240, 178', hits: 2 },
    spin:  { cls: 'st-spin',  dur: 340, contact: 0.48, lungeK: 1.02, tint: '255, 214, 120' },
    leap:  { cls: 'st-leap',  dur: 400, contact: 0.52, lungeK: 1.24, tint: '255, 178, 150' },
    dash:  { cls: 'st-dash',  dur: 300, contact: 0.32, lungeK: 1.34, tint: '196, 240, 224' },
    flick: { cls: 'st-flick', dur: 300, contact: 0.44, lungeK: 0.96, tint: '204, 220, 255' },
    basic: { cls: 'strike',   dur: 300, contact: 0.40, lungeK: 1.00, tint: '255, 236, 170' },
  };
  /* 스킬 축(skill.key) → 안무. 편성 정체성이 모션으로 보인다 (체크리스트 3번):
   *   모찌(atkMul) 묵직한 강타 · 피치(aspdMul) 빠른 연타 · 푸딩(goldMul) 회전 살림꾼
   *   라떼(bossMul) 도약 강타 · 민트(advanceMul) 순간 대시 · 별사탕(shardMul) 잽싼 튕김 */
  var STYLE_BY_SKILL = {
    atkMul: 'slam', aspdMul: 'combo', goldMul: 'spin',
    bossMul: 'leap', advanceMul: 'dash', shardMul: 'flick',
  };
  function styleFor(c) {
    var key = c && c.skill && STYLE_BY_SKILL[c.skill.key];
    return STRIKE_STYLES[key] || STRIKE_STYLES.basic;
  }

  /* 스킬 발동 주기(타격 수) — 순수 표현 리듬이다. characters.js 의 스킬 발동 수치가
   * 아니라 "몇 타마다 세트피스를 보여줄까"일 뿐. 밸런스와 무관(엔진 DPS 불변). */
  var SKILL_EVERY = 9;
  var ACCENT_EVERY = 5;

  /* 적 피격 반응 다양화 (체크리스트 4번) — 한 종류 찌부만 반복하지 않는다.
   * 타격 크기(tier) + 교대 + 보스 여부로 반응이 갈린다. CSS 키프레임과 짝. */
  function reactClass(ratio, isBoss, alt) {
    if (isBoss) return 'squash-boss';          // 보스는 덜 밀리고 대신 번쩍인다(무게)
    if (ratio >= 0.5) return 'squash-heavy';   // 큰 한 방 = 크게 날아간다
    return alt ? 'squash-spin' : 'squash';     // 잔타는 교대로 변주(회전 vs 기본)
  }
  var REACT_CLASSES = ['squash', 'squash-heavy', 'squash-spin', 'squash-boss'];

  function create(opts) {
    var el = opts.el;
    var Chapters = opts.Chapters, Chars = opts.Chars, Combat = opts.Combat;
    var B = opts.balance;
    var Queue = opts.Queue;
    var fmt = opts.fmt || String;

    /* 효과음은 연출 계층이 낸다 — 안무·비트와 같은 순간에 울려야 "타이밍이 맞는다"
     * (단계 5, G기둥). game.js 는 로직 사운드(강화·해금)만 즉시 낸다. 마지막 호출을
     * 기록해 회귀에서 "어떤 사건에 어떤 스팅이 붙었는가"를 검증한다. */
    var sfxRaw = opts.sfx || function () {};
    var lastSfx = null, sfxLog = [];
    function sfx(name) {
      lastSfx = name;
      sfxLog.push(name);
      if (sfxLog.length > 32) sfxLog.shift();   // 회귀 검증용 최근 창 — 무한 성장 방지
      sfxRaw(name);
    }

    var reducedMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* 화면에 서 있는 것 — 엔진 상태의 사본이 아니라 "연출이 어디까지 진행됐는가"다.
     * 큐가 비면 syncTo() 가 엔진 진실로 스냅하므로 영구히 어긋나지 않는다. */
    var view = { mode: 'advance', enemyKey: '', alive: false, isBoss: false };
    var party = [];
    var bossFrameT = 0;      // 보스 컷인 홀드 타이머 — 강한 초기 줌을 잠깐 유지(단계 4)
    var lastRage = false;    // 분노 페이즈(제한시간 임박) 진입/이탈 1회 토글

    // ── 카메라 (단계 4 — 줌·팬·펀치) ─────────────────────────────
    /* 대상이 .arena 가 아니라 .stage-cam 인 것이 중요하다 — HUD(진행도·보스 타이머)는
     * 흔들리지도 당겨지지도 않아야 읽힌다(F 기둥). fx-canvas 는 stage-cam **안**이라
     * 줌과 함께 스케일되고, 좌표 수학이 camera.scale 로 되돌린다.
     *
     * 멀미 방지(체크리스트 4) — 세 축 전부 상한을 두고, 목표를 향한 감쇠는
     * 프레임레이트 독립 지수 접근이라 배속·프레임 드랍에서도 진폭이 안 튄다.
     * 감속 모드에서는 전면 정지한다(줌·팬·흔들림 0). */
    var CAM_MAX_SCALE = 1.24;    // 줌 상한 — 넘으면 화면이 잘리고 멀미가 온다
    var CAM_MAX_PAN = 30;        // 팬 상한(px)
    var CAM_MAX_SHAKE = 7;       // 흔들림 진폭 상한
    var CAM_MAX_PUNCH = 0.14;    // 막타 줌 펀치 상한
    var camera = {
      scale: 1, targetScale: 1, renderScale: 1,   // renderScale = 펀치까지 얹은 실제 렌더 배수
      maxScale: CAM_MAX_SCALE, maxPan: CAM_MAX_PAN, maxShake: CAM_MAX_SHAKE,   // 상한(검증·멀미 가드)
      x: 0, y: 0,                              // 흔들림 오프셋
      panX: 0, panY: 0, targetPanX: 0, targetPanY: 0,
      punchAmp: 0, punchT: 0, punchDur: 0.32,
      shakeAmp: 0, shakeT: 0, shakeDur: 0,
      shake: function (amp, dur) {
        if (reducedMotion) return;
        amp = Math.min(amp, CAM_MAX_SHAKE);
        // 이미 더 센 흔들림이 진행 중이면 덮어쓰지 않는다(돌파 연출이 잔진동에 안 먹히게)
        if (this.shakeT > 0 && this.shakeAmp > amp) return;
        this.shakeAmp = amp; this.shakeDur = dur; this.shakeT = dur;
      },
      /* 무대를 당겨 잡는다(보스 컷인·긴장). 목표만 주면 update 가 감쇠로 접근한다.
       * 전 축 클램프 — 어떤 입력도 상한을 못 넘는다(멀미 방지의 하드 가드). */
      frame: function (scale, panX, panY) {
        if (reducedMotion) return;
        this.targetScale = Math.max(1, Math.min(CAM_MAX_SCALE, scale));
        this.targetPanX = Math.max(-CAM_MAX_PAN, Math.min(CAM_MAX_PAN, panX || 0));
        this.targetPanY = Math.max(-CAM_MAX_PAN, Math.min(CAM_MAX_PAN, panY || 0));
      },
      reset: function () { this.targetScale = 1; this.targetPanX = 0; this.targetPanY = 0; },
      /* 막타/돌파 — 짧고 강한 줌 펀치(빠르게 붙었다 감쇠). frame 위에 얹힌다 */
      punch: function (amp, dur) {
        if (reducedMotion) return;
        this.punchAmp = Math.min(amp, CAM_MAX_PUNCH); this.punchDur = dur || 0.32; this.punchT = this.punchDur;
      },
      update: function (dt) {
        if (reducedMotion) {                   // 감속 모드 — 카메라 전면 정지
          this.renderScale = 1;
          if (this._last !== '') { el.cam.style.transform = ''; this._last = ''; }
          return;
        }
        if (this.shakeT > 0) {
          this.shakeT -= dt;
          var k = Math.max(0, this.shakeT / this.shakeDur);   // 이차 감쇠
          var a = this.shakeAmp * k * k;
          this.x = (Math.random() * 2 - 1) * a;
          this.y = (Math.random() * 2 - 1) * a * 0.6;
        } else { this.x = 0; this.y = 0; }
        // 줌·팬 지수 접근(프레임레이트 독립) — 접근 속도를 낮게 잡아 부드럽게
        var ease = 1 - Math.pow(0.0016, Math.min(0.05, dt));   // dt=1/60 → ~0.10
        this.scale += (this.targetScale - this.scale) * ease;
        this.panX += (this.targetPanX - this.panX) * ease;
        this.panY += (this.targetPanY - this.panY) * ease;
        var punch = 0;
        if (this.punchT > 0) { this.punchT -= dt; punch = this.punchAmp * Math.max(0, this.punchT / this.punchDur); }
        var sc = Math.min(CAM_MAX_SCALE + CAM_MAX_PUNCH, this.scale + punch);
        this.renderScale = sc;
        var tx = this.panX + this.x, ty = this.panY + this.y;
        var t = (Math.abs(sc - 1) > 0.001 || Math.abs(tx) > 0.01 || Math.abs(ty) > 0.01)
          ? 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + sc.toFixed(4) + ')'
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
      p.sheet = o.sheet || null;               // SHEETS 키 — 플립북/이미지 파티클
      p.rot = o.rot || 0; p.rotVel = o.rotVel || 0;
      p.blend = o.blend || null;               // 'lighter' = 가산 발광 (D기둥)
      p.grav = o.grav || 0;
      p.stretch = o.stretch || 0;              // >0 이면 속도 방향으로 길쭉한 스파크
      p.fadeless = !!o.fadeless;               // 투사체 — 비행 중 흐려지지 않는다
      if (reducedMotion) { p.vx = 0; p.vy = 0; p.grow = 1; p.rotVel = 0; p.grav = 0; }
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
          /* 투사체는 수명 종료 = 착탄이다. 제거 후에 터뜨려야 인덱스가 안 꼬인다
           * (emit 이 방금 비운 풀 슬롯을 재사용한다 — 좌표는 인자로 이미 확보). */
          if (p.kind === 'proj') projLand(p.x, p.y);
          continue;
        }
        if (p.grav) p.vy += p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    }

    /* 별 착탄 — 작은 섬광 + 스파크. 도착이 판정에 관여하지 않는 순수 장식 (결정 5). */
    function projLand(x, y) {
      emit('flash', x, y, { life: 0.12, size: 22, grow: 1.8,
        color: '255, 240, 190', alpha: 0.8, blend: 'lighter' });
      for (var i = 0; i < 3; i++) {
        var a = Math.random() * TAU, sp = 60 + Math.random() * 80;
        emit('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
          life: 0.2 + Math.random() * 0.1, size: 3, grow: 0.6,
          color: '255, 236, 170', alpha: 0.9, blend: 'lighter', grav: 480, stretch: 2.2 });
      }
    }

    var TAU = Math.PI * 2;
    function particlesDraw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, cssW, cssH);
      var mode = 'source-over';
      for (var i = 0; i < pcount; i++) {
        var p = pool[i];
        var k = p.age / p.life;                 // 0 → 1
        var want = p.blend || 'source-over';
        if (want !== mode) { ctx.globalCompositeOperation = want; mode = want; }
        var sz = p.size * (1 + (p.grow - 1) * k);

        if (p.sheet) {
          var sh = sheetImgs[p.sheet];
          if (sh && sh.ready && sh.img.width) {
            var fw = sh.img.width / sh.frames;
            var fi = Math.min(sh.frames - 1, Math.floor(k * sh.frames));
            var szH = sz * (sh.img.height / fw);
            ctx.globalAlpha = p.alpha * (p.fadeless ? 1 : (1 - k * k));   // 즉시 최대 → 끝에서 빠지는 곡선
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot + p.rotVel * p.age);
            ctx.drawImage(sh.img, fi * fw, 0, fw, sh.img.height, -sz / 2, -szH / 2, sz, szH);
            ctx.restore();
            continue;
          }
          /* decode 전 폴백 — 절차적 링. 첫 임팩트가 "그냥 사라지는" 일이 없게 한다 */
          ctx.globalAlpha = p.alpha * (1 - k);
          ctx.strokeStyle = 'rgba(255, 220, 140, 1)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, (sz / 2) * (0.5 + k), 0, TAU);
          ctx.stroke();
          continue;
        }

        ctx.globalAlpha = p.alpha * (1 - k);
        ctx.fillStyle = 'rgba(' + p.color + ',1)';
        if (p.stretch) {
          // 스파크 — 진행 방향으로 길쭉하게 (잔상 느낌)
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.beginPath();
          ctx.ellipse(0, 0, sz * p.stretch, sz * 0.4, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, sz, sz * 0.55, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (mode !== 'source-over') ctx.globalCompositeOperation = 'source-over';
    }

    /* 타격 임팩트 — 플립북 + 스파크 + 섬광이 접점에서 **함께** 터진다 (체크리스트 2번).
     * 전부 장식이다 — 정보(숫자)는 DOM 이 나른다. */
    function impactBurst(x, y, accent, tint) {
      var sparkCol = tint || (accent ? '255, 208, 112' : '255, 236, 170');
      emit('impact', x, y, { sheet: 'impact', life: 0.32, size: accent ? 118 : 84,
        grow: 1.15, rot: (Math.random() * 70 - 35) * Math.PI / 180, alpha: 1 });
      emit('slash', x - 6, y - 4, { sheet: 'slash', life: 0.24, size: 110, grow: 1.55,
        rot: (Math.random() * 50 - 25) * Math.PI / 180, rotVel: 2.4, alpha: 0.95 });
      var n = accent ? 10 : 6;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, sp = 130 + Math.random() * 170;
        emit('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
          life: 0.26 + Math.random() * 0.18, size: 3.5 + Math.random() * 2.5, grow: 0.6,
          color: sparkCol, alpha: 0.95,
          blend: 'lighter', grav: 520, stretch: 2.6 });
      }
      emit('flash', x, y, { life: 0.14, size: accent ? 46 : 30, grow: 2.2,
        color: '255, 245, 210', alpha: 0.85, blend: 'lighter' });
    }

    /* 스킬 세트피스 — 캐릭터 정체성 FX (체크리스트 3번). 전부 장식이라 감속 모드에서
     * emit 가 자동 억제한다. 데미지·판정에 관여하지 않는다(수치는 이미 DPS 에 녹음). */
    function heroSkillFx(c, x, y) {
      var key = c && c.skill ? c.skill.key : '';
      var i, a, sp;
      switch (key) {
        case 'atkMul':   // 모찌 강타 — 충격파 링 + 지면 파편
          emit('flash', x, y, { life: 0.3, size: 44, grow: 4.6, color: '255, 210, 150', alpha: 0.5, blend: 'lighter' });
          for (i = 0; i < 8; i++) { a = Math.random() * TAU; sp = 170 + Math.random() * 150;
            emit('debris', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 0.4,
              size: 5, grow: 0.6, color: '255, 214, 150', alpha: 0.9, blend: 'lighter', grav: 500, stretch: 2.2 }); }
          break;
        case 'aspdMul':  // 피치 연타 — 잽싼 스파크 다발
          for (i = 0; i < 9; i++) { a = Math.random() * TAU; sp = 120 + Math.random() * 140;
            emit('spark', x + (Math.random() * 24 - 12), y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
              life: 0.22 + Math.random() * 0.1, size: 3.5, grow: 0.6, color: '255, 240, 175', alpha: 0.95,
              blend: 'lighter', grav: 380, stretch: 2.6 }); }
          break;
        case 'goldMul':  // 푸딩 — 골드 분수 (장식 동전, 수치는 DOM 정보가 나른다)
          for (i = 0; i < 11; i++)
            emit('coin', x, y + 6, { vx: (Math.random() - 0.5) * 220, vy: -160 - Math.random() * 140,
              life: 0.6 + Math.random() * 0.2, size: 5, grow: 1, color: '255, 205, 90', alpha: 1, blend: 'lighter', grav: 660 });
          break;
        case 'bossMul':  // 라떼 도약 강타 — 큰 충격파 + 추가 셰이크
          emit('flash', x, y, { life: 0.34, size: 50, grow: 5.2, color: '255, 172, 150', alpha: 0.55, blend: 'lighter' });
          for (i = 0; i < 9; i++) { a = Math.random() * TAU; sp = 200 + Math.random() * 170;
            emit('debris', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.42,
              size: 6, grow: 0.6, color: '255, 190, 160', alpha: 0.9, blend: 'lighter', grav: 520, stretch: 2.4 }); }
          camera.shake(3.4, 0.28);
          break;
        case 'advanceMul':  // 민트 대시 — 수평 궤적 잔상
          for (i = 0; i < 6; i++)
            emit('spark', x - 44 + i * 20, y + (Math.random() * 30 - 15), { vx: 270, vy: 0, life: 0.22,
              size: 6, grow: 0.5, color: '196, 240, 224', alpha: 0.9, blend: 'lighter', stretch: 4.2 });
          break;
        case 'shardMul':  // 별사탕 반짝 — 별가루 샤워
          for (i = 0; i < 8; i++)
            emit('spark', x + (Math.random() * 44 - 22), y - 34, { vx: (Math.random() - 0.5) * 90,
              vy: 40 + Math.random() * 70, life: 0.5, size: 4, grow: 1.2, color: '204, 220, 255', alpha: 1,
              blend: 'lighter', grav: 120, stretch: 1.8 });
          break;
      }
    }

    /* 처치 세트피스 — 펑 플립북 + 구름 파편 + 골드 분출 + 섬광 (체크리스트 4번).
     * 골드 **수치**는 DOM 플로트(정보)가 나르고, 여기 동전 파티클은 장식이다. */
    function killBurst(x, y, big) {
      emit('poof', x, y, { sheet: 'poof', life: 0.44, size: big ? 150 : 110,
        grow: 1.2, alpha: 1 });
      var nd = big ? 10 : 7;
      for (var i = 0; i < nd; i++) {
        var a = Math.random() * TAU, sp = 60 + Math.random() * 110;
        emit('debris', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          life: 0.4 + Math.random() * 0.2, size: 5 + Math.random() * 4, grow: 0.5,
          color: '236, 226, 238', alpha: 0.9, grav: 420 });
      }
      var ng = big ? 10 : 6;
      for (var g = 0; g < ng; g++) {
        emit('coin', x, y + 6, { vx: (Math.random() - 0.5) * 160, vy: -120 - Math.random() * 120,
          life: 0.5 + Math.random() * 0.25, size: 4.5 + Math.random() * 2, grow: 1,
          color: '255, 205, 90', alpha: 1, blend: 'lighter', grav: 640 });
      }
      emit('flash', x, y, { life: 0.16, size: big ? 56 : 40, grow: 2.0,
        color: '255, 250, 225', alpha: 0.7, blend: 'lighter' });
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
    /* 단계 2 — 4겹: 구름(0.22) · 원경 실루엣(0.5) · 배경 그림(1.0, 지면 기준) ·
     * 전경 띠(1.8). 계수가 다르면 겹 사이에 깊이가 생긴다. 구름·원경은 전용 아트
     * 전까지 CSS 플레이스홀더(style.css)로 굴린다 — 에셋 대기로 정체 금지(9절). */
    var LAYERS = [
      { node: el.cloudLayer, factor: 0.22, key: 'cloud' },
      { node: el.farLayer, factor: 0.5, key: 'far' },
      { node: el.bgLayer, factor: 1.0, key: 'bg' },
      { node: el.fgLayer, factor: 1.8, key: 'fg' },
    ];
    var scrollX = 0;

    function setChapter(ch) {
      el.bgLayer.style.backgroundImage = "url('" + ch.bg + "')";
      el.fgLayer.style.backgroundImage = ch.fg ? "url('" + ch.fg + "')" : 'none';
      if (el.farLayer) {
        var tint = FAR_TINT[ch.id];
        if (tint) el.farLayer.style.setProperty('--pl-far', tint);
        /* 전용 원경 아트 — 있으면 그라디언트 플레이스홀더 대신 이미지가 흐른다 */
        var farArt = FAR_ART[ch.id];
        el.farLayer.style.backgroundImage = farArt ? "url('" + farArt + "')" : '';
        el.farLayer.style.backgroundSize = farArt ? 'auto 100%' : '';
        /* 실내·기계 구간에서도 구름이 흐르면 이상하다 — 야외 무드에만 보인다 */
        var outdoor = ch.id === 'meadow' || ch.id === 'garden' || ch.id === 'starsea';
        if (el.cloudLayer) {
          el.cloudLayer.style.opacity = outdoor ? '' : '0.25';
          var skyArt = SKY_ART[ch.id];
          el.cloudLayer.style.backgroundImage = skyArt ? "url('" + skyArt + "')" : '';
          el.cloudLayer.style.backgroundSize = skyArt ? 'auto 100%' : '';
        }
      }
    }

    /* 걷기 90px/s, 달리기(큐 따라잡기 구간)는 1.7배 — 발걸음과 세계가 같이 빨라진다 */
    function parallaxUpdate(dt, running) {
      if (view.mode !== 'advance') return;      // 전진 중에만 세계가 흐른다
      scrollX -= dt * 90 * (running ? 1.7 : 1);
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
      if (floatAccum <= 0) return;
      if (floatCooldown > 0) return;
      if (fxCount >= FX_CAP) return;          // 골드 플로트도 잔존 DOM 상한에 든다 (결정 3)
      fxCount++;
      floatCooldown = 0.25;
      sfx('coin');
      var n = document.createElement('div');
      n.className = 'gold-float';
      n.textContent = '+' + fmt(floatAccum);
      floatAccum = 0;
      el.field.appendChild(n);
      setTimeout(function () { n.remove(); fxCount--; }, 900);
    }

    /* 몰아보기(collapsed)로 배치가 끝나면 합산 골드를 보여줄 다음 처치가 없을 수 있다.
     * queue idle 전이에서 정확히 한 번 플러시한다 — 안 하면 벽·보스에 머무는 동안
     * 누적분이 영영 안 보인다 (codex 리뷰 발견, 체크리스트). */
    function flushPending() {
      if (floatAccum <= 0) return;
      floatCooldown = 0;                      // 마지막 기회다 — 배칭 쿨다운을 무시한다
      floatGold(0);
    }

    // ── 액터 ──────────────────────────────────────────────────
    /* 프레임 폭이 캐릭터마다 달라 background-size 까지 함께 바꿔야 워크사이클이 안 어긋난다.
     * 상태별 시트(단계 2·3 에셋 부채 해소): 걷기/달리기 시트를 gait 에 따라 고르고,
     * 프레임 수는 --walk-steps 로 CSS steps() 에 전달한다. 시트가 없으면 걷기 폴백. */
    function sheetFor(c, running) {
      if (running && c.run) return { img: c.run, w: c.runW || c.frameW, n: c.runN || c.walkN || 3 };
      return { img: c.walk, w: c.frameW, n: c.walkN || 3 };
    }
    function applySprite(node, c, running) {
      var s = sheetFor(c, running);
      node.style.width = s.w + 'px';
      node.style.backgroundImage = "url('" + s.img + "')";
      node.style.backgroundSize = (s.w * s.n) + 'px 220px';
      node.style.setProperty('--walk-shift', '-' + (s.w * s.n) + 'px');
      node.style.setProperty('--walk-steps', s.n);
      /* steps(var()) 는 Chrome 셔한드가 못 먹는다(실측) — 프레임 수 클래스로 고른다 */
      node.classList.toggle('frames-6', s.n === 6);
    }

    var lastPartyKey = '';
    function syncParty(state) {
      var key = (state.party || []).join(',');
      if (!key || key === lastPartyKey) return;
      lastPartyKey = key;
      party = state.party.slice();
      var lead = Chars.byId(party[0]);
      if (lead) applySprite(el.hero, lead, lastGait);
      [el.follower1, el.follower2].forEach(function (node, i) {
        var c = party[i + 1] ? Chars.byId(party[i + 1]) : null;
        node.hidden = !c;
        if (c) applySprite(node, c, lastGait);
      });
    }

    /* 주행 상태 (단계 2) — 큐가 밀려 가속 재생 중이면 파티도 달린다. 걷기/달리기
     * 구분이 실제 상태(따라잡기)와 맞물려 있어 장식이 아니라 정보이기도 하다. */
    var lastGait = false, runDustT = 0;
    function setGait(running) {
      if (running === lastGait) return;
      lastGait = running;
      [el.hero, el.follower1, el.follower2].forEach(function (n) {
        n.classList.toggle('running', running);
      });
      /* 달리기 전용 시트 스왑 — 히어로가 공격 포즈 중이면 복원(restoreWalkPose) 때 반영 */
      var lead = Chars.byId(party[0]);
      if (lead && !poseSwapped) applySprite(el.hero, lead, running);
      [el.follower1, el.follower2].forEach(function (node, i) {
        var c = party[i + 1] ? Chars.byId(party[i + 1]) : null;
        if (c && !node.hidden) applySprite(node, c, running);
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
        /* 보스 컷인 (체크리스트 1) — 무대를 확 당겨 잡는다. 강한 초기 줌을 홀드
         * 타이머 동안 유지하고, update 가 이후 전투 프레이밍으로 부드럽게 내린다.
         * 포효는 컷인 시작과 같은 순간에 — 엔진 사건 시점(consumeEvents)이 아니라
         * 무대가 보스를 세우는 이 순간에 울려야 화면과 소리가 맞는다(단계 5). */
        el.arena.classList.add('boss-mode');
        bossFrameT = 0.55;
        camera.frame(CAM_MAX_SCALE, -16, -4);
        sfx('bossIn');
        setTimeout(function () {
          if (!view.alive) return;
          var bp = footPoint(el.enemyArt);
          dustPuff(bp.x, bp.y, true);
          camera.shake(3, 0.26);
          camera.punch(0.09, 0.28);   // 착지 순간 줌 스냅
        }, 250);   // bossIn 55% 지점(≈250ms)이 착지 프레임
      }
    }

    function hideEnemy() {
      view.alive = false;
      view.enemyKey = '';
      el.enemy.hidden = true;
      el.bossRing.hidden = true;
      // 보스 프레이밍·분노 틴트 해제 (update 가 카메라를 1.0 으로 되돌린다)
      if (el.arena.classList.contains('boss-mode')) el.arena.classList.remove('boss-mode');
      if (lastRage) { lastRage = false; el.arena.classList.remove('boss-rage'); }
      bossFrameT = 0;
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
            killBurst(pp.x, pp.y, false);      // 펑 + 파편 + 골드 분출 + 섬광 (캔버스)
            sfx('kill');
          }
          if (!collapsed) floatGold(ev.gold);
          else floatAccum += ev.gold;          // 몰아보기 — queue idle 플러시가 받아 준다
          hideEnemy();
          view.mode = 'advance';
          setLocomotion(true, false);
          break;

        case 'boss_clear':
          if (!collapsed) {
            if (view.alive) { var bp = enemyPoint(); killBurst(bp.x, bp.y, true); }
            if (fxReady()) { camera.shake(4.5, 0.34); camera.punch(0.13, 0.36); confettiBurst(); }  // 막타·돌파 줌 펀치 (체크리스트 2)
            speedLineFlash();
            sfx('clear');   // 돌파 스팅 — 세트피스와 같은 순간(단계 5)
          }
          hideEnemy();
          view.mode = 'advance';
          setLocomotion(true, false);
          break;

        case 'boss_fail':
          if (!collapsed) sfx('fail');   // 시간 초과 — 무대가 물러나는 이 순간(단계 5)
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
     * 단계 3 에서 캐릭터별 다중 프레임 공격·스킬로 교체된다.
     *
     * 숫자의 진실원은 **관측된 적 HP 델타**다 (결정 8) — 표현 계층이 DPS 공식을
     * 재계산하지 않는다. 같은 적이 살아 있는 동안의 감소분을 누적하고, 처치 순간의
     * 잔여 HP 는 그 프레임의 mob_kill/boss_clear 사건으로 확인해 더한다. 한 프레임에
     * 여러 마리가 죽으면 중간 개체 분은 관측 불가라 **덜** 세어진다 — 과장은 없다.
     * 보스 실패는 HP 가 리셋될 뿐 잔여가 깎인 게 아니므로 더하지 않는다. */
    var strikeAccum = 0, strikeGap = 0;
    var obsKey = '', obsHp = 0, dmgObserved = 0, frameKill = false;
    var strikeCount = 0, restoreTimer = 0, poseSwapped = false;
    var strikeAlt = false;                    // 교대타 — 기본타를 한 번 걸러 잽으로 바꾼다
    var lastStrikeInfo = null;                // 연출 변주 검증용 (헤드리스에선 자연 발화를 못 봄)
    var lastReactClass = '';
    var followerTimers = [0, 0];
    var STRIKE_MOTIONS = ['strike', 'jab', 'st-slam', 'st-combo', 'st-spin', 'st-leap', 'st-dash', 'st-flick'];

    function observeDamage(state) {
      var fightingPhase = state.phase !== Combat.PHASE_ADVANCE;
      var key = fightingPhase ? (state.phase + ':' + state.stage + ':' + state.mobIndex) : '';
      var hp = state.enemyHp;
      if (key && key === obsKey) {
        if (hp < obsHp) dmgObserved += obsHp - hp;
        /* hp 가 늘었다 = 보스 재도전 리셋 — 새 기준점만 잡는다 (깎인 게 아니다) */
      } else if (obsKey && frameKill) {
        dmgObserved += obsHp;   // 직전 개체의 잔여 HP — 실제로 깎여 죽었음이 사건으로 확인됨
      }
      obsKey = key;
      obsHp = key ? hp : 0;
      frameKill = false;
    }

    /* 다중 프레임 공격 시트(단계 3 에셋 부채 해소) — 스킬 세트피스는 전용 시트,
     * 기본타는 공격 시트, 둘 다 없으면 기존 단일 포즈 폴백. 플립북 재생은 CSS
     * atkFlip(각 모션 클래스에 함께 선언)이 --atk-steps/--atk-shift 로 한다. */
    function swapToAttackPose(isSkill) {
      var c = Chars.byId(party[0]);
      if (!c) return;
      var sp = isSkill && c.atkSp ? { img: c.atkSp, w: c.atkSpW, n: c.atkSpN }
             : c.atkSheet ? { img: c.atkSheet, w: c.atkSheetW, n: c.atkSheetN }
             : c.atk ? { img: c.atk, w: c.atkW, n: 1 } : null;
      if (!sp) return;
      el.hero.style.backgroundImage = "url('" + sp.img + "')";
      el.hero.style.width = sp.w + 'px';
      el.hero.style.backgroundSize = (sp.w * sp.n) + 'px 220px';
      el.hero.style.setProperty('--atk-shift', '-' + (sp.w * sp.n) + 'px');
      el.hero.style.setProperty('--atk-steps', sp.n);
      /* 프레임 수는 고정 클래스 — steps(var()) 를 Chrome 셔한드가 못 먹는다(실측) */
      el.hero.classList.remove('atk-6', 'atk-8');
      if (sp.n > 1) el.hero.classList.add('atk-' + sp.n);
      poseSwapped = true;
    }
    function restoreWalkPose() {
      if (!poseSwapped) return;
      poseSwapped = false;
      /* 모션 클래스도 함께 걷어낸다 — atkFlip 의 fill(both)이 걷기 시트의
       * background-position 을 물고 있으면 걸음 프레임이 어긋난다 */
      el.hero.classList.remove('alt', 'accent', 'skill', 'atk-6', 'atk-8');
      for (var m = 0; m < STRIKE_MOTIONS.length; m++) el.hero.classList.remove(STRIKE_MOTIONS[m]);
      var c = Chars.byId(party[0]);
      if (c) applySprite(el.hero, c, lastGait);
    }

    /* 타격 접점 통일 — 돌진 거리가 고정이면 캐릭터 폭(139~301px)에 따라 주먹이 적을
     * 뚫거나 허공에 멈춘다. 매 타격 실제 간격을 재서 살짝(12px) 파고드는 지점까지만. */
    function syncLunge(k) {
      var hr = el.hero.getBoundingClientRect();
      var er = el.enemyArt.getBoundingClientRect();
      if (!hr.width || !er.width) return;
      var sc = parseFloat(getComputedStyle(el.hero).getPropertyValue('--sc')) || 0.4;
      var gap = er.left - hr.right;
      var reach = (gap + 12) / sc * (k || 1);   // 스타일별 돌진 배수 (단계 3)
      if (!isFinite(reach)) return;
      reach = Math.max(24, Math.min(200, Math.round(reach)));
      el.hero.style.setProperty('--lunge', reach + 'px');
    }

    function heroStrike(dmg, maxHp) {
      strikeCount++;
      var c = Chars.byId(party[0]);
      var style = styleFor(c);
      strikeAlt = !strikeAlt;

      /* 리듬 계층 (결정 8: crit 이 아니다 — 추가 피해·확률 없음, 연출만 변한다):
       *   skill  매 9타 — 캐릭터 스킬 세트피스 (편성 정체성이 눈에 보인다)
       *   accent 매 5타 — 스타일 모션 강조
       *   basic  그 외 — 교대타: 한 번은 스타일 모션, 한 번은 잽(변주로 반복감 제거)
       * skill·accent 은 스타일 모션을, 기본 잽 차례만 'jab' 을 쓴다. */
      var isSkill = strikeCount % SKILL_EVERY === 0;
      var accent = !isSkill && strikeCount % ACCENT_EVERY === 0;
      var useJab = !isSkill && !accent && !strikeAlt;
      var motion = useJab ? 'jab' : style.cls;
      var big = isSkill || accent;

      // 모션 클래스 — 이전 것들을 싹 지우고 이번 것만 (교대·강조·스킬 마커 포함)
      el.hero.classList.remove('alt', 'accent', 'skill');
      for (var m = 0; m < STRIKE_MOTIONS.length; m++) el.hero.classList.remove(STRIKE_MOTIONS[m]);
      /* 시트 스왑을 클래스보다 먼저 — atkFlip 애니메이션이 시작되는 순간
       * --atk-steps/--atk-shift 가 이미 이번 타격의 시트를 가리켜야 한다 */
      swapToAttackPose(isSkill);
      void el.hero.offsetWidth;
      el.hero.classList.add(motion);
      if (strikeAlt) el.hero.classList.add('alt');
      if (isSkill) el.hero.classList.add('skill');
      else if (accent) el.hero.classList.add('accent');

      syncLunge(useJab ? 0.9 : style.lungeK);
      sfx(isSkill ? 'skill' : 'hit');   // 스킬 발동 = 전용 스팅(단계 5), 기본타 = hit
      var p = enemyPoint();     // 좌표 고정 — 접촉까지 적이 바뀌어도 빈 곳에 안 찍힌다
      var fp = footPoint(el.hero);
      dustPuff(fp.x, fp.y, big);

      /* 접점 통일 — 접촉 타이밍은 스타일 키프레임과 함께 움직인다(dur × contact). */
      var contactMs = Math.round(style.dur * style.contact);
      var ratio = maxHp > 0 ? dmg / maxHp : 0;
      var rc = reactClass(ratio, view.isBoss, strikeAlt);
      lastReactClass = rc;
      lastStrikeInfo = { motion: motion, style: style.cls, tier: isSkill ? 'skill' : accent ? 'accent' : (strikeAlt ? 'a' : 'b'),
        alt: strikeAlt, react: rc, skill: c && c.skill ? c.skill.key : '', sig: motion + '|' + (isSkill ? 'skill' : accent ? 'accent' : 'basic') };

      setTimeout(function () {
        var jx = (Math.random() - 0.5) * 26, jy = (Math.random() - 0.5) * 20;

        // 임팩트·궤적·스파크·섬광 — 캐릭터 정체성 색(style.tint)으로 (단계 1·3)
        impactBurst(p.x + jx, p.y + jy, big, style.tint);
        if (isSkill) heroSkillFx(c, p.x + jx, p.y + jy);
        // 연타형(combo)은 두 번째 잔타가 살짝 늦게 뒤따른다 (피치 정체성)
        if (style.hits > 1) setTimeout(function () {
          impactBurst(p.x - jx * 0.5, p.y + 10, false, style.tint);
        }, 90);

        /* 숫자는 관측된 실제 피해이고 DOM 잔류다 (결정 3·8). 크기·색은 타격 크기에 반응. */
        var cls = 'fx-dmg' + (big ? ' accent' : '')
                + (ratio >= 0.9 ? ' huge' : ratio >= 0.35 ? ' big' : '');
        spawnFx(cls, p.x + jx, p.y + jy - 28, 640, fmt(dmg));

        // 적 피격 반응 다양화 (체크리스트 4번) — 넉백 크기도 타격에 반응
        el.enemy.classList.remove.apply(el.enemy.classList, REACT_CLASSES);
        void el.enemy.offsetWidth;
        el.enemy.classList.add(rc);
        el.enemy.style.setProperty('--knock', (view.isBoss ? 6 : ratio >= 0.5 ? 22 : 12) + 'px');

        hitstop(isSkill ? 0.11 : accent ? 0.09 : 0.055);
        if (big) camera.shake(isSkill ? 3 : 2, 0.16);
      }, contactMs);

      /* 연타 시 이전 복원 타이머가 다음 타격의 공격 포즈를 중간에 되돌리는 경합 방지 */
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(restoreWalkPose, style.dur + 20);
    }

    /* 지원 사격 — 2·3번 동료가 자기 주기로 별을 던진다. 데미지는 이미 편성 보너스로
     * DPS 에 녹아 있으므로 숫자는 띄우지 않는다(두 배로 세 보이면 거짓말이다).
     * WAAPI(onfinish 정리) → 캔버스 탄도로 이관 (결정 5): 시계·수명 관리가 파티클로
     * 일원화되고 FX_CAP(DOM)을 먹지 않는다. 착탄은 projLand — 순수 장식. */
    function followerShot(node) {
      if (node.hidden) return;
      var cr = el.fxCanvas.getBoundingClientRect();
      var nr = node.getBoundingClientRect();
      var sc = camera.scale || 1;
      var from = { x: (nr.left + nr.width * 0.6 - cr.left) / sc, y: (nr.top + nr.height * 0.35 - cr.top) / sc };
      var to = enemyPoint();
      node.classList.remove('cast');
      void node.offsetWidth;
      node.classList.add('cast');
      /* 포물선: y(T)=목표 를 만족하는 초기 vy 에 중력을 더해 정점이 ~1/8·g·T² 뜬다 */
      var T = 0.43, g = 1470;
      emit('proj', from.x, from.y, { sheet: 'star', life: T, size: 40, grow: 1,
        fadeless: true, rotVel: 9, alpha: 1,
        vx: (to.x - from.x) / T,
        vy: (to.y - from.y) / T - 0.5 * g * T,
        grav: g });
    }

    function combatFxUpdate(dt, simDt, state) {
      if (floatCooldown > 0) floatCooldown -= dt;

      /* 숫자의 진실원은 관측 HP 델타 — DPS 공식을 표현 계층에서 재계산하지 않는다 (결정 8) */
      observeDamage(state);

      var fighting = view.mode !== 'advance' && view.alive;
      if (!fighting) return;

      /* 타격 틱: 공속 리듬을 따르되 눈이 따라갈 상한(초당 4회)을 둔다.
       * effAspd 는 **리듬 전용** 엔진 getter 읽기다 — 수치(피해량)에는 관여하지 않는다.
       * (HUD 의 "내 DPS" 표기가 Combat.dps 를 읽는 것과 같은 급의 읽기 — 공속 강화의
       * 시각 피드백을 지키기 위해 결정 8 에서 이 읽기만 남겼다.) */
      var rate = Math.min(4, Combat.effAspd(state));
      strikeGap += dt;
      strikeAccum += dt * rate;
      if (strikeAccum >= 1 && strikeGap >= 0.22 && dmgObserved >= 1) {
        strikeAccum = 0; strikeGap = 0;
        heroStrike(dmgObserved, state.enemyMaxHp);
        dmgObserved = 0;
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
    var queue = Queue.create({ duration: beatDuration, onEvent: playBeat, onIdle: flushPending });

    /* 매 프레임. dt = 실제 프레임 간격(연출 시계), simDt = 엔진에 준 시간(배속 포함).
     * 연출은 dt 로 돌고, "얼마나 아팠나"만 simDt 를 따른다. */
    function update(dt, simDt, state) {
      syncParty(state);
      queue.update(dt);
      if (queue.idle()) syncTo(state);

      var running = view.mode === 'advance' && queue.rate() > 1.25;
      setGait(running);
      parallaxUpdate(dt, running);
      if (running && !reducedMotion) {
        runDustT += dt;
        if (runDustT >= 0.24) {                // 달릴 때만 발밑 먼지가 궤적처럼 남는다
          runDustT = 0;
          var hf = footPoint(el.hero);
          dustPuff(hf.x, hf.y, false);
        }
      } else runDustT = 0;

      ambientUpdate(dt, state);
      combatFxUpdate(dt, simDt, state);

      // 적 HP 는 엔진 진실을 그대로 보여준다(F 기둥 — 가독성은 연출보다 우선)
      if (view.alive && state.enemyMaxHp > 0) {
        var ratio = Math.max(0, state.enemyHp / state.enemyMaxHp);
        el.enemyHpFill.style.width = (ratio * 100) + '%';
      }

      /* 카메라 프레이밍 (단계 4, C·E기둥) — 보스는 무대를 당겨 잡고(컷인 홀드 후
       * 전투 프레이밍으로 정착), 제한시간이 임박하면 분노 페이즈로 긴장이 오른다.
       * 보스 타이머는 엔진 진실(state.bossT / B.bossTimeLimit)을 **읽기만** 한다. */
      if (view.mode === 'boss' && view.alive) {
        var rageRatio = B && B.bossTimeLimit ? (state.bossT || 0) / B.bossTimeLimit : 0;
        var raging = rageRatio >= 0.62;
        if (bossFrameT > 0) bossFrameT -= dt;            // 컷인 홀드 — 강한 초기 줌 유지
        else camera.frame(raging ? 1.18 : 1.08, -10, 0); // 정착: 전투 프레이밍 → 분노 줌 크립
        if (raging !== lastRage) {
          lastRage = raging;
          el.arena.classList.toggle('boss-rage', raging);
          if (raging) sfx('rage');   // 분노 진입 스팅 — 틴트가 켜지는 순간(단계 5)
        }
      } else if (camera.targetScale !== 1 || camera.targetPanX !== 0 || camera.targetPanY !== 0) {
        camera.reset();                                  // 전진·잡몹 — 카메라를 1.0 으로 되돌린다
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
      push: function (events) {
        /* 처치 확인은 엔진과 동기인 이 지점에서 본다 — 큐 지연과 무관하게
         * observeDamage 가 "이번 프레임에 정말 죽었나"를 알 수 있다 (결정 8). */
        if (events) {
          for (var i = 0; i < events.length; i++) {
            var t = events[i] && events[i].type;
            if (t === 'mob_kill' || t === 'boss_clear') frameKill = true;
          }
        }
        queue.push(events);
      },
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
        poofAt: function () { var p = enemyPoint(); killBurst(p.x, p.y, false); },
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
        // 단계 3 회귀용 — 캐릭터별 모션·리듬 변주·적 반응을 밖에서 검증한다
        restorePose: restoreWalkPose,   // 에셋 시트 회귀 — 타이머와 무관하게 동기 복원
        styleFor: function (id) { return styleFor(Chars.byId(id)).cls; },
        lastStrike: function () { return lastStrikeInfo; },
        lastReact: function () { return lastReactClass; },
        reactClass: reactClass,
        skillFx: function (id) { var p = enemyPoint(); heroSkillFx(Chars.byId(id), p.x, p.y); },
        lastSfx: function () { return lastSfx; },   // 단계 5 — 사건별 스팅 배선 검증
        sfxLog: function () { return sfxLog.slice(); },
        resetSfxLog: function () { sfxLog.length = 0; },
      },
    };
  }

  return { create: create, BEAT: BEAT, FX_CAP: FX_CAP, PARTICLE_CAP: PARTICLE_CAP, INFO_RESERVE: INFO_RESERVE, SHEETS: SHEETS };
});
