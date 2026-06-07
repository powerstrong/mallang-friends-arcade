/* PlayScene — 세로 전진 크라우드 러너 (프로토타입)
 *
 * 좌표계: 540x720 고정(FIT). 부대는 화면 하단(squadY)에 머물고 트랙(게이트/적/벽/보스)이
 * 위→아래로 흘러 내려와 부대선을 통과한다. 통과 시점에 상호작용을 해결한다.
 *   - 게이트: 좌/우 절반 중 대장 위치로 택1 → mul/add/pow 적용
 *   - 적(졸개/장갑): 사거리 안이면 자동 사격으로 hp 감소, 부대선 도달 시 부대 피해
 *   - 장벽: 누적 화력으로 부숨, 못 부수면 잔여 hp 비례 피해
 *   - 보스: 미니보스 아레나 — 천천히 접근, 화력으로 hp 격파(접근 시 드레인)
 *
 * 적/보스/배경 이미지는 codex 생성 대기 중 → 우선 인엔진 그래픽 플레이스홀더.
 *   (이미지 도착 시 _enemyDisplay/_bossDisplay/_buildBackground 만 텍스처로 교체) */
(function (global) {
  var SQUAD_Y_RATIO = 0.80;
  var LANE_MIN_R = 0.16, LANE_MAX_R = 0.84;
  var SCROLL = 165;        // px/s
  var SHOOT_RANGE = 380;   // 부대선 위로 이 거리까지 사격
  var MAX_RENDER_UNITS = 60;
  var MOB_CONTACT = 2, ARMOR_CONTACT = 14, BOSS_DRAIN = 14; // 부대 손실량

  function PlayScene() { Phaser.Scene.call(this, { key: 'PlayScene' }); }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    // 프로토타입: 우리편 유닛은 협동대모험의 병아리 시트 임시 재사용(측면).
    if (!this.textures.exists('chick'))
      this.load.spritesheet('chick', '/games/coop-adventure/assets/chick-run.png',
        { frameWidth: 256, frameHeight: 256 });
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

    if (!this.anims.exists('chick-run')) {
      this.anims.create({
        key: 'chick-run', frameRate: 18, yoyo: true, repeat: -1,
        frames: this.anims.generateFrameNumbers('chick',
          { frames: [12, 15, 14, 7, 13, 11, 8, 5, 1, 4, 3, 2, 9, 10, 6] })
      });
    }

    this.squad = new SquadModel(5, 1);
    this.leaderX = W * 0.5;

    this.unitLayer = this.add.container(0, 0);
    this.units = [];
    this.bulletLayer = this.add.container(0, 0);

    this._buildTrack();
    this._buildUI();

    this.traveled = 0;
    this.state = 'run';     // run | boss | win | lose
    this._fireAcc = 0;
    this._drainAcc = 0;

    window.__mar.scene = this;
    window.__mar.squad = this.squad;
  };

  // ---- 배경 ----------------------------------------------------------------
  PlayScene.prototype._buildBackground = function () {
    var W = this.W, H = this.H;
    this.add.rectangle(W / 2, H / 2, W, H, 0xbfe3ff).setDepth(-10); // 물/하늘
    var roadW = W * 0.72;
    this.add.rectangle(W / 2, H / 2, roadW, H, 0xe7ddca).setDepth(-9); // 길
    this.add.rectangle(W / 2 - roadW / 2, H / 2, 8, H, 0xc7b89a).setDepth(-9);
    this.add.rectangle(W / 2 + roadW / 2, H / 2, 8, H, 0xc7b89a).setDepth(-9);
    // 진행감용 중앙 점선 (스크롤됨)
    this.dashes = [];
    var n = 10, gap = H / n;
    for (var i = 0; i < n; i++) {
      var d = this.add.rectangle(W / 2, i * gap, 8, gap * 0.4, 0xffffff, 0.55).setDepth(-8);
      this.dashes.push(d);
    }
    this._dashGap = gap;
  };
  PlayScene.prototype._updateBgScroll = function () {
    var gap = this._dashGap, H = this.H;
    var off = (this.traveled * 0.6) % gap;
    for (var i = 0; i < this.dashes.length; i++) {
      this.dashes[i].y = ((i * gap + off) % (H + gap)) - gap * 0.5;
    }
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
    function half(sign, side) {
      var rect = this.add.rectangle(sign * halfX, 0, gw, gh, side.color, 0.85)
        .setStrokeStyle(3, 0xffffff);
      var t = this.add.text(sign * halfX, 0, side.label, {
        fontFamily: 'sans-serif', fontSize: '26px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5);
      c.add([rect, t]);
      return rect;
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
    var size = kind === 'armor' ? 64 : 34;
    var col = kind === 'armor' ? 0x8a96a8 : 0xb8c2d0;
    var body = this.add.rectangle(0, 0, size, size, col).setStrokeStyle(2, 0x5b6470);
    body.setData && body.setData('r', 1);
    var eye = this.add.circle(0, -size * 0.12, size * 0.13, 0x29e6ff);
    c.add([body, eye]);
    var hpText = null;
    if (kind === 'armor') {
      hpText = this.add.text(0, 0, String(hp), {
        fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5);
      c.add(hpText);
    }
    return { type: 'enemy', kind: kind, dist: dist, x: x, display: c, hp: hp, maxHp: hp, hpText: hpText, dead: false };
  };

  PlayScene.prototype._makeBarrier = function (dist, b) {
    var W = this.W, w = W * 0.66, h = 46;
    var c = this.add.container(W / 2, -200).setDepth(2);
    var rect = this.add.rectangle(0, 0, w, h, 0x9b6b4a, 0.92).setStrokeStyle(3, 0x6e4a31);
    var t = this.add.text(0, 0, String(b.hp), {
      fontFamily: 'sans-serif', fontSize: '24px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5);
    c.add([rect, t]);
    return { type: 'barrier', dist: dist, display: c, rect: rect, hpText: t, hp: b.hp, maxHp: b.hp, dead: false };
  };

  PlayScene.prototype._makeBoss = function (dist, hp) {
    var W = this.W;
    var c = this.add.container(W / 2, -300).setDepth(3).setVisible(false);
    var body = this.add.rectangle(0, 0, 150, 130, 0x6b7384).setStrokeStyle(4, 0x3c4350);
    var core = this.add.circle(0, 0, 22, 0xff5a3c);
    var eyeL = this.add.circle(-34, -34, 10, 0xff8a3d);
    var eyeR = this.add.circle(34, -34, 10, 0xff8a3d);
    c.add([body, core, eyeL, eyeR]);
    return { type: 'boss', dist: dist, display: c, hp: hp, maxHp: hp, dead: false, engaged: false };
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

  // ---- 부대 렌더 -----------------------------------------------------------
  PlayScene.prototype._layoutUnits = function () {
    var want = Math.min(this.squad.count(), MAX_RENDER_UNITS);
    while (this.units.length < want) {
      var s = this.add.sprite(0, 0, 'chick').play('chick-run');
      s.setScale(0.16);
      this.unitLayer.add(s);
      this.units.push(s);
    }
    while (this.units.length > want) {
      this.units.pop().destroy();
    }
    var offs = MARFormation(want);
    var cap = this.squad.activeShooters();
    for (var i = 0; i < want; i++) {
      var u = this.units[i];
      u.x = this.leaderX + offs[i].dx;
      u.y = this.squadY + offs[i].dy;
      // 사수 상한 내 유닛은 살짝 진하게(질 기여), 잉여는 흐리게(체력 흡수) — 가독 보조
      u.setAlpha(i < cap ? 1 : 0.72);
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
    if (f.type === 'enemy' && f.hpText) f.hpText.setText(String(Math.max(0, Math.ceil(f.hp))));
    if (f.type === 'barrier') f.hpText.setText(String(Math.max(0, Math.ceil(f.hp))));
    if (f.hp <= 0 && f.type !== 'boss') this._killTrack(f, true);
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
    var n = Math.min(this.squad.activeShooters(), 12); // 사수 상한(12)까지 시각 반영
    for (var i = 0; i < n; i++) {
      var u = this.units[i] || { x: this.leaderX, y: this.squadY };
      var b = this.add.circle(u.x, u.y - 8, 4, 0xfff15a).setDepth(4);
      this.bulletLayer.add(b);
      this.tweens.add({
        targets: b, y: ty, duration: 130, onComplete: function () { this.destroy(); }, callbackScope: b
      });
    }
  };

  // ---- 상호작용/소멸 -------------------------------------------------------
  PlayScene.prototype._poof = function (x, y, color) {
    var p = this.add.circle(x, y, 10, color || 0xffe08a, 0.9).setDepth(6);
    this.tweens.add({ targets: p, scale: 2.4, alpha: 0, duration: 260, onComplete: function () { p.destroy(); } });
  };
  PlayScene.prototype._killTrack = function (o, byShot) {
    o.dead = true;
    var x = o.display.x, y = o.display.y;
    this._poof(x, y, byShot ? 0xfff15a : 0xff7a7a);
    o.display.destroy();
  };
  PlayScene.prototype._hitSquad = function (n) {
    this.squad.lose(n);
    this.cameras.main.shake(120, 0.006);
  };
  PlayScene.prototype._resolveGate = function (g) {
    g.resolved = true;
    var chooseLeft = this.leaderX < this.W / 2;
    var side = chooseLeft ? g.left : g.right;
    var chosenRect = chooseLeft ? g.leftRect : g.rightRect;
    var otherRect = chooseLeft ? g.rightRect : g.leftRect;
    if (side.op === 'mul') this.squad.mul(side.val);
    else if (side.op === 'add') this.squad.add(side.val);
    else if (side.op === 'pow') this.squad.addPower(side.val);
    this.tweens.add({ targets: chosenRect, scaleX: 1.18, scaleY: 1.18, yoyo: true, duration: 150 });
    if (otherRect) this.tweens.add({ targets: otherRect, alpha: 0.2, duration: 150 });
    var c = side.op === 'pow' ? '#ff8a3d' : '#2e9bff';
    var lbl = this.add.text(this.leaderX, this.squadY - 40,
      side.op === 'pow' ? '무기 강화!' : (side.op === 'mul' ? '×' + side.val : '+' + side.val), {
      fontFamily: 'sans-serif', fontSize: '24px', color: c, fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(8);
    this.tweens.add({ targets: lbl, y: this.squadY - 90, alpha: 0, duration: 600, onComplete: function () { lbl.destroy(); } });
  };

  // ---- 메인 업데이트 -------------------------------------------------------
  PlayScene.prototype.update = function (time, delta) {
    var dt = Math.min(0.05, delta / 1000);
    if (this.input0 && this.input0.update) this.input0.update(dt);

    // 스티어링
    var ratio = this.input0 ? this.input0.targetX : 0.5;
    var tx = Phaser.Math.Linear(this.laneMin, this.laneMax, ratio);
    this.leaderX += (tx - this.leaderX) * Math.min(1, dt * 10);
    this.leaderX = Phaser.Math.Clamp(this.leaderX, this.laneMin, this.laneMax);

    if (this.state === 'run' || this.state === 'boss') {
      if (this.state === 'run') this.traveled += SCROLL * dt;
      this._updateTrack(dt);
      this._layoutUnits();
      this._autoFire(dt);
      this._updateBgScroll();
      this._updateUI();
      if (this.squad.count() <= 0) this._end(false);
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

      if (o.type === 'gate' && !o.resolved && sy >= this.squadY) {
        this._resolveGate(o);
      } else if (o.type === 'enemy' && sy >= this.squadY) {
        this._hitSquad(o.kind === 'armor' ? ARMOR_CONTACT : MOB_CONTACT);
        this._killTrack(o, false);
      } else if (o.type === 'barrier' && sy >= this.squadY) {
        if (o.hp > 0) this._hitSquad(Math.ceil(o.hp / 12));
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
    // boss 상태: 접근 + 화력 격파 (접근이 빨라 드레인이 실제 압박이 됨 → "질" 검문소)
    b.dist -= 42 * dt; // 접근
    var by = Math.min(this.squadY - 60, this.squadY - (b.dist - this.traveled));
    b.display.y = by;
    b.display.x = this.W / 2;
    if (by >= this.squadY - 64) { // 접근 드레인
      this._drainAcc += BOSS_DRAIN * dt;
      if (this._drainAcc >= 1) { var n = Math.floor(this._drainAcc); this._drainAcc -= n; this._hitSquad(n); }
    }
    if (b.hp <= 0) { this._killTrack(b, true); this._end(true); }
  };

  // ---- 종료 ----------------------------------------------------------------
  PlayScene.prototype._end = function (win) {
    if (this.state === 'win' || this.state === 'lose') return;
    this.state = win ? 'win' : 'lose';
    var W = this.W, H = this.H;
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55).setDepth(30);
    this.add.text(W / 2, H / 2 - 30, win ? '클리어! 🎉' : '전멸… 💥', {
      fontFamily: 'sans-serif', fontSize: '44px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(31);
    this.add.text(W / 2, H / 2 + 30, '탭하면 다시 시작', {
      fontFamily: 'sans-serif', fontSize: '22px', color: '#ffe08a'
    }).setOrigin(0.5).setDepth(31);
    this.input.once('pointerdown', function () { this.scene.restart(); }, this);
  };

  global.PlayScene = PlayScene;
})(window);
