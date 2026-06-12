/* PlayScene — 말랑프렌즈 러너: 세로 전진 크라우드 러너
 *
 * 좌표계: 540x720 고정(FIT). 부대는 화면 하단(squadY)에 머물고 트랙(게이트/적/벽/보스)이
 * 위→아래로 흘러 내려와 부대선을 통과한다. 통과 시점에 상호작용을 해결한다.
 *   - 게이트: 좌/우 절반 중 대장 위치로 택1 → mul/add/pow 적용
 *   - 적(졸개/장갑): 사거리 안이면 자동 사격으로 hp 감소, 부대선 도달 시 부대 피해
 *   - 장벽: 누적 화력으로 부숨, 못 부수면 잔여 hp 비례 피해
 *   - 보스: 미니보스 아레나 — 접근 드레인 + 조준탄(스티어링으로 회피)
 *
 * 톤: "죽인다"가 아니라 "고장난 장난감 로봇을 멈춘다" — 격파 연출은 나사·별·스프링. */
(function (global) {
  var SQUAD_Y_RATIO = 0.80;
  var LANE_MIN_R = 0.16, LANE_MAX_R = 0.84;
  var SCROLL = 165;        // px/s
  var SHOOT_RANGE = 380;   // 부대선 위로 이 거리까지 사격
  var MAX_RENDER_UNITS = 60;
  var MOB_CONTACT = 2, ARMOR_CONTACT = 14;
  var BOSS_DRAIN = 10;     // 접근 드레인(부대/초) — 조준탄 추가로 14→10 완화
  var BOSS_SHOT_EVERY = 1.1, BOSS_SHOT_SPEED = 230, BOSS_SHOT_DMG = 6, BOSS_SHOT_HIT_W = 56;
  var BOSS_TELEGRAPH = 0.5;  // 조준탄 경고선 노출 시간(s) — 이 동안 착탄점이 고정된다
  var EVOLVE_AT = [15, 35]; // 진화 마일스톤(머릿수, 한 판 내 단방향)
  var UNIT_H = [30, 35, 40];          // 진화 단계별 유닛 표시 높이
  var BULLET_STYLE = [                 // 진화 단계별 탄환 시각
    { r: 4, color: 0xfff15a },
    { r: 5, color: 0xffb13d },
    { r: 6, color: 0xff7a3d }
  ];

  function PlayScene() { Phaser.Scene.call(this, { key: 'PlayScene' }); }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    // 정식 유닛: 후방뷰 병아리 3프레임 스트립(말랑프렌즈 하우스 스타일, codex 생성).
    if (!this.textures.exists('unit-chick'))
      this.load.spritesheet('unit-chick', './assets/unit-chick-back.png',
        { frameWidth: 256, frameHeight: 256 });
    // 최종 진화(35+) 골드 외형: 왕관 쓴 황금 병아리 후방뷰 3프레임.
    if (!this.textures.exists('unit-chick-gold'))
      this.load.spritesheet('unit-chick-gold', './assets/unit-chick-gold-back.png',
        { frameWidth: 256, frameHeight: 256 });
    // 폴백: 후방뷰가 없으면 협동대모험 측면 시트 임시 사용.
    if (!this.textures.exists('chick'))
      this.load.spritesheet('chick', '/games/coop-adventure/assets/chick-run.png',
        { frameWidth: 256, frameHeight: 256 });
    if (!this.textures.exists('enemy-mech')) this.load.image('enemy-mech', './assets/enemy-mech-chick.png');
    if (!this.textures.exists('boss-mech')) this.load.image('boss-mech', './assets/boss-mech.png');
    if (!this.textures.exists('barrier-fence')) this.load.image('barrier-fence', './assets/barrier-fence.png');
    if (!this.textures.exists('gate-arch')) this.load.image('gate-arch', './assets/gate-arch.png');
    if (!this.textures.exists('warn-stripe')) this.load.image('warn-stripe', './assets/warn-stripe.png');
    this.load.on('loaderror', function (file) {
      if (file && file.key === 'unit-chick') this._unitChickFailed = true;
    }, this);
  };

  PlayScene.prototype.create = function () {
    var W = this.scale.width, H = this.scale.height;
    this.W = W; this.H = H;
    this.squadY = H * SQUAD_Y_RATIO;
    this.laneMin = W * LANE_MIN_R;
    this.laneMax = W * LANE_MAX_R;

    this.input0 = this.game.registry.get('input');
    if (this.input0 && this.game.canvas) this.input0.attachPointer(this.game.canvas);
    if (this.input0) this.input0.targetX = 0.5; // restart 시 중앙 출발 보장

    this._buildBackground();
    this._buildAnims();

    this.squad = new SquadModel(5, 1);
    this.leaderX = W * 0.5;
    this.evolveTier = 0;

    this.unitLayer = this.add.container(0, 0).setDepth(5);
    this.units = [];
    this.bulletLayer = this.add.container(0, 0).setDepth(4);
    this.bossShots = [];
    this.telegraphs = [];

    this._buildTrack();
    this._buildUI();

    this.traveled = 0;
    this.state = 'ready';   // ready | run | boss | finish | win | lose
    this._gateSeq = 0;
    this._lastHitCause = null;
    // startRun 은 여기(create)가 아니라 실제 시작 탭에서 — 준비 화면 체류가
    // duration 에 섞이고 run_start 단독 런이 전송되는 오염 방지(codex 리뷰).
    this._fireAcc = 0;
    this._drainAcc = 0;
    this._bossShotAcc = 0;
    this._bossTime = 0;

    this._buildStartOverlay();

    window.__mar.scene = this;
    window.__mar.squad = this.squad;
  };

  PlayScene.prototype._buildAnims = function () {
    this._useBackView = this.textures.exists('unit-chick') && !this._unitChickFailed;
    this._hasGold = this.textures.exists('unit-chick-gold');
    if (this._useBackView) {
      if (!this.anims.exists('unit-run'))
        this.anims.create({
          key: 'unit-run', frameRate: 10, yoyo: true, repeat: -1,
          frames: this.anims.generateFrameNumbers('unit-chick', { frames: [0, 1, 2] })
        });
      if (this._hasGold && !this.anims.exists('unit-run-gold'))
        this.anims.create({
          key: 'unit-run-gold', frameRate: 10, yoyo: true, repeat: -1,
          frames: this.anims.generateFrameNumbers('unit-chick-gold', { frames: [0, 1, 2] })
        });
    } else if (!this.anims.exists('chick-run')) {
      this.anims.create({
        key: 'chick-run', frameRate: 18, yoyo: true, repeat: -1,
        frames: this.anims.generateFrameNumbers('chick',
          { frames: [12, 15, 14, 7, 13, 11, 8, 5, 1, 4, 3, 2, 9, 10, 6] })
      });
    }
  };

  // ---- 배경 (절차적 파스텔 들판 + 길: 완전 seamless) ------------------------
  PlayScene.prototype._buildBackground = function () {
    var W = this.W, H = this.H;
    var roadW = W * 0.66; this._roadW = roadW;
    var railL = W / 2 - roadW / 2, railR = W / 2 + roadW / 2;
    this.add.rectangle(W / 2, H / 2, W, H, 0xb5e8a3).setDepth(-10);          // 잔디
    this.add.rectangle(W / 2, H / 2, roadW, H, 0xf2e8d0).setDepth(-9);       // 길
    this.add.rectangle(railL, H / 2, 12, H, 0xd8c9a4).setDepth(-8);          // 좌 난간
    this.add.rectangle(railR, H / 2, 12, H, 0xd8c9a4).setDepth(-8);          // 우 난간
    // 스크롤 데코(전진감) — 전부 traveled 기반 래핑이라 이음새 없음.
    this.scrollDeco = [];
    var gap = 84, n = Math.ceil(H / gap) + 2;
    for (var i = 0; i < n; i++) {
      this.scrollDeco.push(this.add.rectangle(railL, 0, 18, 24, 0xc4b28c).setDepth(-7));
      this.scrollDeco.push(this.add.rectangle(railR, 0, 18, 24, 0xc4b28c).setDepth(-7));
    }
    this._decoGap = gap;
    // 잔디 꽃: 고정 시드 손배치(좌우 갓길), 색은 파스텔 3종.
    this.flowers = [];
    var cols = [0xffc4d6, 0xfff3b0, 0xffffff];
    var fGap = 64, fn = Math.ceil(H / fGap) + 2;
    for (var j = 0; j < fn; j++) {
      var lx = railL * (0.25 + 0.5 * ((j * 7919) % 100) / 100);
      var rx = railR + (W - railR) * (0.25 + 0.5 * ((j * 104729) % 100) / 100);
      this.flowers.push(this.add.circle(lx, 0, 6, cols[j % 3]).setDepth(-7));
      this.flowers.push(this.add.circle(rx, 0, 6, cols[(j + 1) % 3]).setDepth(-7));
    }
    this._flowerGap = fGap;
    this._updateBgScroll();
  };
  PlayScene.prototype._updateBgScroll = function () {
    var H = this.H;
    function wrap(list, gap, off) {
      for (var i = 0; i < list.length; i++) {
        var base = Math.floor(i / 2) * gap;
        list[i].y = ((base + off) % (H + gap)) - gap;
      }
    }
    wrap(this.scrollDeco, this._decoGap, this.traveled % this._decoGap);
    wrap(this.flowers, this._flowerGap, this.traveled % this._flowerGap);
  };

  // ---- 트랙 빌드 -----------------------------------------------------------
  PlayScene.prototype._buildTrack = function () {
    var S = global.MAR_STAGE1, W = this.W;
    this.track = [];
    var self = this;
    S.events.forEach(function (ev) {
      if (ev.gate) self.track.push(self._makeGate(ev.at, ev.gate));
      else if (ev.mob) {
        // 웨이브는 ev.at 에서 시작해 앞(+)으로 펼친다(이전 구간 침범 방지). 간격은 좁게.
        for (var i = 0; i < ev.mob.count; i++) {
          var x = Phaser.Math.Linear(self.laneMin + 20, self.laneMax - 20, Math.random());
          self.track.push(self._makeEnemy(ev.at + i * 64 * (ev.mob.spread || 1), x, 'mob', ev.mob.hp));
        }
      } else if (ev.armor) {
        self.track.push(self._makeEnemy(ev.at, W / 2, 'armor', ev.armor.hp));
      } else if (ev.barrier) {
        self.track.push(self._makeBarrier(ev.at, ev.barrier));
      }
    });
    // 보스
    this.boss = this._makeBoss(S.bossAt, S.bossHp);
    this.track.push(this.boss);
    this.bossAt = S.bossAt;
  };

  PlayScene.prototype._makeGate = function (dist, g) {
    var W = this.W, halfX = W * 0.18, gw = W * 0.32, gh = 70;
    var c = this.add.container(W / 2, -200).setDepth(2);
    var useArch = this.textures.exists('gate-arch');
    function half(sign, side) {
      var body, labelY = 0;
      var icon = side.op === 'pow' ? '⚔ ' : '🐤 ';
      if (useArch) {
        // 장난감 아치(크림색 원본)에 진영색 틴트 + 배너 위 라벨
        body = this.add.image(sign * halfX, 0, 'gate-arch');
        var ah = gw * (body.height / body.width);
        body.setDisplaySize(gw, ah).setTint(side.color);
        labelY = -ah * 0.27; // 배너 중앙
        c.add(body);
      } else {
        var glow = this.add.rectangle(sign * halfX, 0, gw + 10, gh + 10, side.color, 0.30);
        body = this.add.rectangle(sign * halfX, 0, gw, gh, side.color, 0.88)
          .setStrokeStyle(3, 0xffffff);
        c.add([glow, body]);
        this.tweens.add({ targets: glow, alpha: 0.08, duration: 600, yoyo: true, repeat: -1 });
      }
      var t = this.add.text(sign * halfX, labelY, icon + side.label, {
        fontFamily: 'sans-serif', fontSize: '24px', color: '#5b3a1e', fontStyle: 'bold',
        stroke: '#ffffff', strokeThickness: useArch ? 4 : 0
      }).setOrigin(0.5);
      if (!useArch) t.setColor('#ffffff');
      c.add(t);
      return body;
    }
    var leftRect = half.call(this, -1, g.left);
    var rightRect = half.call(this, 1, g.right);
    return {
      type: 'gate', dist: dist, display: c, left: g.left, right: g.right,
      leftRect: leftRect, rightRect: rightRect, resolved: false, dead: false
    };
  };

  PlayScene.prototype._makeEnemy = function (dist, x, kind, hp) {
    var c = this.add.container(x, -200).setDepth(2);
    var size = kind === 'armor' ? 96 : 48;
    var spr = null;
    if (this.textures.exists('enemy-mech')) {
      spr = this.add.image(0, 0, 'enemy-mech').setDisplaySize(size, size);
      if (kind === 'armor') spr.setTint(0xbfd4ff); // 장갑은 살짝 푸른 금속 톤
      c.add(spr);
    } else {
      var col = kind === 'armor' ? 0x8a96a8 : 0xb8c2d0;
      c.add(this.add.rectangle(0, 0, size, size, col).setStrokeStyle(2, 0x5b6470));
      c.add(this.add.circle(0, -size * 0.12, size * 0.13, 0x29e6ff));
    }
    var hpText = null;
    if (kind === 'armor') {
      hpText = this.add.text(0, size * 0.05, String(hp), {
        fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3
      }).setOrigin(0.5);
      c.add(hpText);
    }
    return {
      type: 'enemy', kind: kind, dist: dist, x: x, display: c, spr: spr,
      hp: hp, maxHp: hp, hpText: hpText, dead: false, _flash: 0
    };
  };

  PlayScene.prototype._makeBarrier = function (dist, b) {
    var W = this.W, w = W * 0.66, h = 46;
    var c = this.add.container(W / 2, -200).setDepth(2);
    var spr = null;
    if (this.textures.exists('barrier-fence')) {
      spr = this.add.image(0, 0, 'barrier-fence');
      spr.setDisplaySize(w, w * (spr.height / spr.width));
      c.add(spr);
    } else {
      c.add(this.add.rectangle(0, 0, w, h, 0x9b6b4a, 0.92).setStrokeStyle(3, 0x6e4a31));
    }
    // 팻말(이미지 중앙 원판) 위에 HP 숫자
    var t = this.add.text(0, 0, String(b.hp), {
      fontFamily: 'sans-serif', fontSize: '24px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#6e4a31', strokeThickness: 4
    }).setOrigin(0.5);
    c.add(t);
    return { type: 'barrier', dist: dist, display: c, spr: spr, hpText: t, hp: b.hp, maxHp: b.hp, dead: false };
  };

  PlayScene.prototype._makeBoss = function (dist, hp) {
    var W = this.W;
    var c = this.add.container(W / 2, -300).setDepth(3).setVisible(false);
    var spr = null;
    if (this.textures.exists('boss-mech')) {
      spr = this.add.image(0, 0, 'boss-mech').setDisplaySize(200, 180);
      c.add(spr);
    } else {
      var body = this.add.rectangle(0, 0, 150, 130, 0x6b7384).setStrokeStyle(4, 0x3c4350);
      var core = this.add.circle(0, 0, 22, 0xff5a3c);
      c.add([body, core,
        this.add.circle(-34, -34, 10, 0xff8a3d), this.add.circle(34, -34, 10, 0xff8a3d)]);
    }
    return { type: 'boss', dist: dist, display: c, spr: spr, hp: hp, maxHp: hp, dead: false, engaged: false };
  };

  // ---- UI ------------------------------------------------------------------
  PlayScene.prototype._buildUI = function () {
    var W = this.W;
    this.uiAmount = this.add.text(14, 12, '', {
      fontFamily: 'sans-serif', fontSize: '26px', color: '#1b2a3a', fontStyle: 'bold'
    }).setDepth(20);
    this.uiPower = this.add.text(W - 14, 12, '', {
      fontFamily: 'sans-serif', fontSize: '22px', color: '#b3471a', fontStyle: 'bold'
    }).setOrigin(1, 0).setDepth(20);
    // 진행 바
    this.add.rectangle(W / 2, 54, W * 0.6, 10, 0x000000, 0.18).setDepth(19);
    this.progFill = this.add.rectangle(W * 0.2, 54, 0, 10, 0x36c275).setOrigin(0, 0.5).setDepth(20);
    this._progW = W * 0.6;
    // 보스 HP 바(숨김)
    this.bossBarBg = this.add.rectangle(W / 2, 84, W * 0.7, 16, 0x000000, 0.25).setDepth(19).setVisible(false);
    this.bossBar = this.add.rectangle(W * 0.15, 84, 0, 16, 0xff5a3c).setOrigin(0, 0.5).setDepth(20).setVisible(false);
    this._bossBarW = W * 0.7;
  };
  PlayScene.prototype._updateUI = function () {
    this.uiAmount.setText('🐤 ' + this.squad.count());
    this.uiPower.setText('⚔ Lv ' + this.squad.power);
    var p = Phaser.Math.Clamp(this.traveled / this.bossAt, 0, 1);
    this.progFill.width = this._progW * p;
    if (this.state === 'boss' && !this.boss.dead) {
      this.bossBarBg.setVisible(true); this.bossBar.setVisible(true);
      this.bossBar.width = this._bossBarW * Phaser.Math.Clamp(this.boss.hp / this.boss.maxHp, 0, 1);
    }
  };

  // ---- 시작 오버레이 -------------------------------------------------------
  PlayScene.prototype._buildStartOverlay = function () {
    var W = this.W, H = this.H;
    var dim = this.add.rectangle(W / 2, H / 2, W, H, 0x1b2a3a, 0.45).setDepth(30);
    var t1 = this.add.text(W / 2, H * 0.34, '말랑프렌즈 러너', {
      fontFamily: 'sans-serif', fontSize: '42px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#1b2a3a', strokeThickness: 6
    }).setOrigin(0.5).setDepth(31);
    var t2 = this.add.text(W / 2, H * 0.42, '기계군단을 막아라!', {
      fontFamily: 'sans-serif', fontSize: '22px', color: '#ffe08a', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(31);
    var t3 = this.add.text(W / 2, H * 0.55, '좌우로 드래그해서 부대를 조종하세요\n게이트를 골라 부대를 키우세요 🐤', {
      fontFamily: 'sans-serif', fontSize: '19px', color: '#ffffff', align: 'center', lineSpacing: 8
    }).setOrigin(0.5).setDepth(31);
    var t4 = this.add.text(W / 2, H * 0.66, '▶ 탭해서 시작', {
      fontFamily: 'sans-serif', fontSize: '26px', color: '#8ef0a8', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(31);
    this.tweens.add({ targets: t4, alpha: 0.35, duration: 550, yoyo: true, repeat: -1 });
    var self = this;
    this.input.once('pointerdown', function () {
      if (window.MARSfx) MARSfx.init(); // 첫 제스처에서 오디오 잠금 해제
      if (window.MARTelemetry) MARTelemetry.startRun(1, 'chick');
      [dim, t1, t2, t3, t4].forEach(function (o) { o.destroy(); });
      self.state = 'run';
    });
  };

  // ---- 부대 렌더 + 진화 ----------------------------------------------------
  // 진화 단계별 유닛 애니메이션 키(최종 단계 = 골드 외형, 한 판 내 단방향)
  PlayScene.prototype._unitAnimKey = function () {
    if (this._useBackView && this._hasGold && this.evolveTier >= 2) return 'unit-run-gold';
    return this._useBackView ? 'unit-run' : 'chick-run';
  };
  PlayScene.prototype._checkEvolve = function () {
    var n = this.squad.count();
    while (this.evolveTier < EVOLVE_AT.length && n >= EVOLVE_AT[this.evolveTier]) {
      this.evolveTier++;
      if (window.MARSfx) MARSfx.play('evolve');
      // 최종 진화: 부대 전원 골드 외형으로 스왑
      if (this.evolveTier >= 2 && this._useBackView && this._hasGold) {
        for (var k = 0; k < this.units.length; k++) {
          this.units[k].play({ key: 'unit-run-gold', startFrame: k % 3 });
        }
      }
      var lbl = this.add.text(this.leaderX, this.squadY - 70, '진화! ✨', {
        fontFamily: 'sans-serif', fontSize: '34px', color: '#ffd24a', fontStyle: 'bold',
        stroke: '#7a4d00', strokeThickness: 5
      }).setOrigin(0.5).setDepth(8);
      this.tweens.add({
        targets: lbl, y: this.squadY - 140, alpha: 0, scale: 1.3, duration: 900,
        onComplete: function () { lbl.destroy(); }
      });
      this.cameras.main.flash(180, 255, 240, 160);
      // 유닛 팝 연출 — _layoutUnits 의 매 프레임 setScale 과 경합하지 않게 플래그를 세운다
      for (var i = 0; i < this.units.length; i++) {
        var u = this.units[i];
        u.scaleTweening = true;
        this.tweens.add({
          targets: u, scale: this._unitScale() * 1.25, duration: 120, yoyo: true,
          onComplete: (function (uu) { return function () { uu.scaleTweening = false; }; })(u)
        });
      }
    }
  };
  PlayScene.prototype._unitScale = function () {
    return UNIT_H[this.evolveTier] / 256;
  };
  PlayScene.prototype._layoutUnits = function () {
    var want = Math.min(this.squad.count(), MAX_RENDER_UNITS);
    while (this.units.length < want) {
      var s;
      if (this._useBackView) {
        s = this.add.sprite(0, 0, 'unit-chick');
        // 유닛마다 위상을 흩어 "살아있는 군단" 느낌 (골드 진화 후엔 골드로 합류)
        s.play({ key: this._unitAnimKey(), startFrame: this.units.length % 3 });
      } else {
        s = this.add.sprite(0, 0, 'chick').play('chick-run');
      }
      s.setScale(this._unitScale());
      this.unitLayer.add(s);
      this.units.push(s);
    }
    while (this.units.length > want) {
      this.units.pop().destroy();
    }
    var offs = MARFormation(want);
    var cap = this.squad.activeShooters();
    var sc = this._unitScale();
    for (var i = 0; i < want; i++) {
      var u = this.units[i];
      u.x = this.leaderX + offs[i].dx;
      u.y = this.squadY + offs[i].dy;
      if (!u.scaleTweening) u.setScale(sc);
      // 사수 상한 내 유닛은 진하게(화력 기여), 잉여는 살짝 흐리게(체력 흡수) — 가독 보조
      u.setAlpha(i < cap ? 1 : 0.78);
    }
  };

  // ---- 자동 사격 -----------------------------------------------------------
  PlayScene.prototype._focusTarget = function () {
    if (this.state === 'boss' && this.boss && !this.boss.dead) return this.boss;
    var best = null, bestY = -1;
    for (var i = 0; i < this.track.length; i++) {
      var o = this.track[i];
      if (o.dead) continue;
      if (o.type !== 'enemy' && o.type !== 'barrier') continue;
      var sy = this.squadY - (o.dist - this.traveled);
      if (sy < this.squadY - SHOOT_RANGE || sy > this.squadY) continue;
      if (sy > bestY) { bestY = sy; best = o; }
    }
    return best;
  };
  PlayScene.prototype._autoFire = function (dt) {
    var f = this._focusTarget();
    if (!f) return;
    f.hp -= this.squad.dps() * dt;
    if (f.hpText) f.hpText.setText(String(Math.max(0, Math.ceil(f.hp))));
    if (f.hp <= 0 && f.type !== 'boss') this._killTrack(f, true);
    // 피격 플래시(이미지 스프라이트가 있을 때만)
    if (!f.dead && f.spr && f.spr.setTintFill) {
      f._flash = (f._flash || 0) + dt;
      if (f._flash >= 0.22) {
        f._flash = 0;
        var spr = f.spr;
        spr.setTintFill(0xffffff);
        this.time.delayedCall(50, function () {
          if (spr.active) { spr.clearTint(); if (f.kind === 'armor') spr.setTint(0xbfd4ff); }
        });
      }
    }
    // 총알 비주얼
    this._fireAcc += dt;
    if (this._fireAcc >= 0.07) {
      this._fireAcc = 0;
      this._spawnBullets(f);
    }
  };
  PlayScene.prototype._spawnBullets = function (target) {
    var ty = this.squadY - (target.dist - this.traveled);
    if (target.type === 'boss') ty = target.display.y;
    var st = BULLET_STYLE[this.evolveTier];
    var n = this.squad.activeShooters(); // 사수 상한까지만 시각 반영
    for (var i = 0; i < n; i++) {
      var u = this.units[i] || { x: this.leaderX, y: this.squadY };
      var b = this.add.circle(u.x, u.y - 8, st.r, st.color).setDepth(4);
      this.bulletLayer.add(b);
      this.tweens.add({
        targets: b, y: ty, x: target.display.x + Phaser.Math.Between(-14, 14),
        duration: 130, onComplete: function () { this.destroy(); }, callbackScope: b
      });
    }
  };

  // ---- 격파 연출(장난감 고장 톤: 나사·별·스프링) -----------------------------
  PlayScene.prototype._breakFx = function (x, y, big) {
    var parts = ['⚙', '★', '✦', '〰'];
    var n = big ? 16 : 6;
    for (var i = 0; i < n; i++) {
      var p = this.add.text(x, y, parts[i % parts.length], {
        fontFamily: 'sans-serif', fontSize: (big ? 26 : 17) + 'px',
        color: i % 2 ? '#ffd24a' : '#9aa6b5'
      }).setOrigin(0.5).setDepth(6);
      this.tweens.add({
        targets: p,
        x: x + Phaser.Math.Between(-70, 70) * (big ? 1.6 : 1),
        y: y + Phaser.Math.Between(-80, 30) * (big ? 1.6 : 1),
        angle: Phaser.Math.Between(-200, 200),
        alpha: 0, scale: 0.5,
        duration: big ? 700 : 420,
        ease: 'Cubic.easeOut',
        // var 클로저는 마지막 파티클만 잡으므로(누수) scope로 각자 destroy
        onComplete: function () { this.destroy(); },
        callbackScope: p
      });
    }
  };
  PlayScene.prototype._killTrack = function (o, byShot) {
    o.dead = true;
    var x = o.display.x, y = o.display.y;
    this._breakFx(x, y, o.type === 'boss');
    o.display.destroy();
  };
  PlayScene.prototype._hitSquad = function (n, cause) {
    this._lastHitCause = cause || 'unknown'; // 사망 원인 텔레메트리(마지막 피해 출처)
    this.squad.lose(n);
    this.cameras.main.shake(120, 0.006);
  };
  PlayScene.prototype._resolveGate = function (g) {
    g.resolved = true;
    var chooseLeft = this.leaderX < this.W / 2;
    var side = chooseLeft ? g.left : g.right;
    var chosenRect = chooseLeft ? g.leftRect : g.rightRect;
    var otherRect = chooseLeft ? g.rightRect : g.leftRect;
    var beforeAmount = this.squad.count(), beforePower = this.squad.power;
    if (side.op === 'mul') this.squad.mul(side.val);
    else if (side.op === 'add') this.squad.add(side.val);
    else if (side.op === 'pow') this.squad.addPower(side.val);
    if (window.MARTelemetry) MARTelemetry.log('gate', {
      seq: ++this._gateSeq, side: chooseLeft ? 'L' : 'R', op: side.op, val: side.val,
      beforeAmount: beforeAmount, beforePower: beforePower,
      afterAmount: this.squad.count(), afterPower: this.squad.power
    });
    if (window.MARSfx) MARSfx.play('gate');
    this.tweens.add({ targets: chosenRect, scaleX: 1.18, scaleY: 1.18, yoyo: true, duration: 150 });
    if (otherRect) this.tweens.add({ targets: otherRect, alpha: 0.2, duration: 150 });
    var c = side.op === 'pow' ? '#ff8a3d' : '#2e9bff';
    var lbl = this.add.text(this.leaderX, this.squadY - 40,
      side.op === 'pow' ? '무기 강화!' : (side.op === 'mul' ? '×' + side.val : '+' + side.val), {
      fontFamily: 'sans-serif', fontSize: '24px', color: c, fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(8);
    this.tweens.add({ targets: lbl, y: this.squadY - 90, alpha: 0, duration: 600, onComplete: function () { lbl.destroy(); } });
    this._checkEvolve();
  };

  // ---- 메인 업데이트 -------------------------------------------------------
  PlayScene.prototype.update = function (time, delta) {
    var dt = Math.min(0.05, delta / 1000);
    if (this.input0 && this.input0.update) this.input0.update(dt);
    if (this.state === 'ready') return;

    // 스티어링 (피니시 연출 중엔 부대 고정 — 드래그해도 안 움직인다)
    if (this.state !== 'finish') {
      var ratio = this.input0 ? this.input0.targetX : 0.5;
      var tx = Phaser.Math.Linear(this.laneMin, this.laneMax, ratio);
      this.leaderX += (tx - this.leaderX) * Math.min(1, dt * 10);
      this.leaderX = Phaser.Math.Clamp(this.leaderX, this.laneMin, this.laneMax);
    }

    if (this.state === 'run' || this.state === 'boss') {
      if (this.state === 'run') this.traveled += SCROLL * dt;
      this._time = time;
      this._updateTrack(dt);
      this._updateTelegraphs(dt);
      this._updateBossShots(dt);
      this._layoutUnits();
      this._autoFire(dt);
      this._updateBgScroll();
      this._updateUI();
      if (this.squad.count() <= 0) this._end(false);
    } else if (this.state === 'finish') {
      // 피니시 연출 중: 부대는 제자리 유지(연출 트윈만 진행)
      this._layoutUnits();
      this._updateUI();
    }
  };

  PlayScene.prototype._updateTrack = function (dt) {
    var H = this.H;
    for (var i = 0; i < this.track.length; i++) {
      var o = this.track[i];
      if (o.dead) continue;

      if (o.type === 'boss') { this._updateBoss(o, dt); continue; }

      var sy = this.squadY - (o.dist - this.traveled);
      o.display.y = sy;
      if (o.type === 'gate') o.display.x = this.W / 2;
      // 졸개는 살짝 뒤뚱거리며 내려온다(삐걱 모션)
      if (o.type === 'enemy' && o.kind === 'mob') {
        o.display.x = o.x + Math.sin((this._time || 0) / 250 + o.dist) * 6;
        o.display.angle = Math.sin((this._time || 0) / 200 + o.dist) * 6;
      }

      if (o.type === 'gate' && !o.resolved && sy >= this.squadY) {
        this._resolveGate(o);
      } else if (o.type === 'enemy' && sy >= this.squadY) {
        this._hitSquad(o.kind === 'armor' ? ARMOR_CONTACT : MOB_CONTACT, o.kind);
        this._killTrack(o, false);
      } else if (o.type === 'barrier' && sy >= this.squadY) {
        if (o.hp > 0) this._hitSquad(Math.ceil(o.hp / 12), 'barrier');
        this._killTrack(o, o.hp <= 0);
      }

      // 화면 아래로 빠지면 정리
      if (!o.dead && sy > H + 140) { o.dead = true; o.display.destroy(); }
    }
  };

  PlayScene.prototype._updateBoss = function (b, dt) {
    var arenaY = this.squadY - 230;
    var sy = this.squadY - (b.dist - this.traveled);
    if (this.state === 'run') {
      if (sy >= arenaY) { this.state = 'boss'; b.engaged = true; }
      b.display.y = Math.min(sy, arenaY);
      b.display.setVisible(sy > -120);
      return;
    }
    // boss 상태: 좌우로 흔들며 접근 + 조준탄. 화력으로 hp 격파(접근 시 드레인).
    this._bossTime += dt;
    b.dist -= 42 * dt; // 접근
    var by = Math.min(this.squadY - 60, this.squadY - (b.dist - this.traveled));
    b.display.y = by;
    b.display.x = this.W / 2 + Math.sin(this._bossTime * 1.4) * this.W * 0.16;
    // 조준탄: 경고선이 먼저 깔리고(착탄점 고정) BOSS_TELEGRAPH 후 발사 → 경고선을 보고 비킨다.
    this._bossShotAcc += dt;
    if (this._bossShotAcc >= BOSS_SHOT_EVERY && b.hp > 0) {
      this._bossShotAcc = 0;
      this._startTelegraph(b, this.leaderX);
    }
    if (by >= this.squadY - 64) { // 접근 드레인
      this._drainAcc += BOSS_DRAIN * dt;
      if (this._drainAcc >= 1) { var n = Math.floor(this._drainAcc); this._drainAcc -= n; this._hitSquad(n, 'drain'); }
    }
    if (b.hp <= 0) this._startFinish(b);
  };

  // ---- 조준탄 경고선 -------------------------------------------------------
  PlayScene.prototype._startTelegraph = function (boss, targetX) {
    var ty = this.squadY + 30;
    var gfx;
    if (this.textures.exists('warn-stripe')) {
      gfx = this.add.image(0, 0, 'warn-stripe').setOrigin(0, 0.5).setDepth(3);
      gfx.setDisplaySize(100, 26); // 길이는 매 프레임 갱신
    } else {
      gfx = this.add.rectangle(0, 0, 100, 8, 0xff8a3d, 0.8).setOrigin(0, 0.5).setDepth(3);
    }
    var ring = this.add.circle(targetX, ty, 16).setStrokeStyle(4, 0xff8a3d).setDepth(3);
    this.telegraphs.push({ gfx: gfx, ring: ring, boss: boss, targetX: targetX, t: 0 });
    if (window.MARSfx) MARSfx.play('bossWarn');
  };
  PlayScene.prototype._updateTelegraphs = function (dt) {
    var ty = this.squadY + 30;
    for (var i = this.telegraphs.length - 1; i >= 0; i--) {
      var tg = this.telegraphs[i];
      tg.t += dt;
      var ox = tg.boss.display.x, oy = tg.boss.display.y + 60;
      var dx = tg.targetX - ox, dy = ty - oy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      tg.gfx.x = ox; tg.gfx.y = oy;
      tg.gfx.rotation = Math.atan2(dy, dx);
      if (tg.gfx.setDisplaySize) tg.gfx.setDisplaySize(len, 26);
      else tg.gfx.width = len;
      // 발사가 다가올수록 빠르게 점멸 + 링 수축
      var urgency = tg.t / BOSS_TELEGRAPH;
      var a = 0.30 + 0.40 * Math.abs(Math.sin(tg.t * (14 + urgency * 18)));
      tg.gfx.setAlpha(a);
      tg.ring.setScale(1.6 - 0.8 * urgency).setAlpha(0.5 + 0.5 * urgency);
      if (tg.t >= BOSS_TELEGRAPH) {
        this._spawnBossShot(ox, oy, tg.targetX);
        tg.gfx.destroy(); tg.ring.destroy();
        this.telegraphs.splice(i, 1);
      }
    }
  };
  PlayScene.prototype._clearTelegraphs = function () {
    for (var i = 0; i < this.telegraphs.length; i++) {
      this.telegraphs[i].gfx.destroy();
      this.telegraphs[i].ring.destroy();
    }
    this.telegraphs = [];
  };

  // ---- 보스 피니시 연출: 전원 일제사격 + 슬로모 + 폭발 ------------------------
  // 사수상한은 게임 룰로 유지하되, 격파가 "확정된 뒤"의 연출에서만 전원이 쏜다(다구리 카타르시스).
  PlayScene.prototype._startFinish = function (b) {
    if (this.state !== 'boss') return;
    this.state = 'finish';
    this._clearTelegraphs();
    for (var i = 0; i < this.bossShots.length; i++) this.bossShots[i].obj.destroy();
    this.bossShots = [];
    this.bossBar.width = 0;
    var self = this, cam = this.cameras.main;
    // 슬로모: 트윈/타이머만 늦추면 발사 스태거·탄속이 함께 늘어져 슬로모로 보인다.
    this.tweens.timeScale = 0.45;
    this.time.timeScale = 0.45;
    cam.zoomTo(1.1, 250);
    // 보스 백색 점멸
    if (b.spr && b.spr.setTintFill) {
      this.time.addEvent({
        delay: 90, repeat: 8, callback: function () {
          if (!b.spr.active) return;
          if (b.spr.isTinted) b.spr.clearTint(); else b.spr.setTintFill(0xffffff);
        }
      });
    }
    // 전원 일제사격(렌더 유닛 전부, 잉여 포함)
    // 발사 위치는 진입 시점 스냅샷 — 연출 중 부대가 못 움직이긴 하지만 레이아웃 변화와도 무관하게.
    // 스태거 총길이는 폭발(1100ms)보다 짧게 압축(유닛이 많아도 "일제사격 → 폭발" 순서 보장).
    var st = BULLET_STYLE[this.evolveTier];
    var nUnits = this.units.length;
    var stag = Math.min(26, nUnits > 1 ? 700 / (nUnits - 1) : 0);
    for (var j = 0; j < nUnits; j++) {
      (function (u, idx) {
        var ux = u.x, uy = u.y; // 위치 스냅샷
        self.time.delayedCall(idx * stag, function () {
          if (self.state !== 'finish') return;
          var bb = self.add.circle(ux, uy - 8, st.r + 1, st.color).setDepth(6);
          self.tweens.add({
            targets: bb,
            x: b.display.x + Phaser.Math.Between(-50, 50),
            y: b.display.y + Phaser.Math.Between(-40, 40),
            duration: 240,
            onComplete: function () {
              this.destroy();
              if (idx % 4 === 0) {
                self._breakFx(this.x, this.y, false);
                cam.shake(60, 0.003);
              }
            },
            callbackScope: bb
          });
        });
      })(this.units[j], j);
    }
    // 폭발 + 정상 속도 복귀 + 클리어 (slow된 타이머라 실시간 약 2.4s 뒤)
    this.time.delayedCall(1100, function () {
      // 같은 프레임 드레인 전멸 등으로 이미 lose가 됐다면 승리 연출 중단(P0)
      if (self.state !== 'finish') return;
      self.tweens.timeScale = 1;
      self.time.timeScale = 1;
      cam.flash(300, 255, 255, 255);
      cam.shake(260, 0.012);
      cam.zoomTo(1, 200);
      self._killTrack(b, true); // 내부에서 big breakFx 수행
      self.time.delayedCall(450, function () { self._end(true); });
    });
  };

  PlayScene.prototype._spawnBossShot = function (x, y, targetX) {
    var core = this.add.circle(x, y, 13, 0x3c4350).setStrokeStyle(3, 0xff8a3d).setDepth(4);
    var dx = (targetX - x);
    var dy = (this.squadY + 30 - y);
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    this.bossShots.push({
      obj: core,
      vx: dx / len * BOSS_SHOT_SPEED,
      vy: dy / len * BOSS_SHOT_SPEED,
      dead: false
    });
  };
  PlayScene.prototype._updateBossShots = function (dt) {
    for (var i = this.bossShots.length - 1; i >= 0; i--) {
      var s = this.bossShots[i];
      if (s.dead) { this.bossShots.splice(i, 1); continue; }
      s.obj.x += s.vx * dt;
      s.obj.y += s.vy * dt;
      // 부대선 도달: 대장 주변에 맞으면 피해, 아니면 통과
      if (s.obj.y >= this.squadY - 6) {
        if (Math.abs(s.obj.x - this.leaderX) < BOSS_SHOT_HIT_W) {
          this._hitSquad(BOSS_SHOT_DMG, 'shot');
          this._breakFx(s.obj.x, this.squadY, false);
        }
        s.dead = true; s.obj.destroy(); this.bossShots.splice(i, 1);
      } else if (s.obj.y > this.H + 30) {
        s.dead = true; s.obj.destroy(); this.bossShots.splice(i, 1);
      }
    }
  };

  // ---- 종료 ----------------------------------------------------------------
  PlayScene.prototype._end = function (win) {
    if (this.state === 'win' || this.state === 'lose') return;
    this.state = win ? 'win' : 'lose';
    // 남은 보스탄·경고선 정리 + 연출 속도 복구
    for (var i = 0; i < this.bossShots.length; i++) this.bossShots[i].obj.destroy();
    this.bossShots = [];
    this._clearTelegraphs();
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;
    if (window.MARTelemetry) {
      if (!win) MARTelemetry.log('death', {
        cause: this._lastHitCause || 'unknown',
        traveled: Math.round(this.traveled),
        bossEngaged: !!(this.boss && this.boss.engaged)
      });
      MARTelemetry.endRun({
        win: win, amount: this.squad.count(), power: this.squad.power,
        bossHp: this.boss ? Math.max(0, Math.ceil(this.boss.hp)) : null,
        assistTier: 0 // M2 숨김 어시스트에서 실제 값 연결
      });
    }
    if (win && window.MARSfx) MARSfx.play('clear');
    var W = this.W, H = this.H;
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55).setDepth(30);
    this.add.text(W / 2, H / 2 - 60, win ? '클리어! 🎉' : '전멸… 🔩', {
      fontFamily: 'sans-serif', fontSize: '44px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(31);
    this.add.text(W / 2, H / 2 + 2,
      '남은 부대원 🐤 ' + this.squad.count() + '   무기 ⚔ Lv ' + this.squad.power, {
      fontFamily: 'sans-serif', fontSize: '22px', color: '#ffe08a', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(31);
    this.add.text(W / 2, H / 2 + 56, '탭하면 다시 시작', {
      fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff'
    }).setOrigin(0.5).setDepth(31);
    if (win) {
      // 별 콘페티
      for (var j = 0; j < 18; j++) {
        var p = this.add.text(Phaser.Math.Between(40, W - 40), -20 - j * 24, '★', {
          fontFamily: 'sans-serif', fontSize: '22px',
          color: j % 2 ? '#ffd24a' : '#8ef0a8'
        }).setOrigin(0.5).setDepth(32);
        this.tweens.add({
          targets: p, y: H + 40, angle: Phaser.Math.Between(-300, 300),
          duration: Phaser.Math.Between(1400, 2400), delay: j * 60,
          onComplete: function () { this.destroy(); }, callbackScope: p
        });
      }
    }
    this.time.delayedCall(350, function () {
      this.input.once('pointerdown', function () { this.scene.restart(); }, this);
    }, [], this);
  };

  global.PlayScene = PlayScene;
})(window);
