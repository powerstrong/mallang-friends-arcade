/* PlayScene — S1~S3 + 반응형(RESIZE) 레이아웃
 * S1 손맛(이동/코요테/버퍼/가변점프/좌측 바이어스 카메라)
 * S2 스테이지(별/체크포인트/낙사/골인)
 * S3 더미 2P 보간 고스트 + 진행도 인디케이터
 * 화면 고정 UI는 _layout()에서 현재 캔버스 크기에 맞춰 재배치(가로/세로 회전 대응).
 * 비주얼은 전부 플레이스홀더(사각형/이모지). 이미지는 나중에 일괄 적용. */
var PlayScene = new Phaser.Class({
  Extends: Phaser.Scene,

  initialize: function PlayScene() {
    Phaser.Scene.call(this, { key: 'play' });
  },

  // 손맛 파라미터 (튜닝 대상) — 점프 상향(-560 → -700)
  MOVE: 250, ACCEL: 2400, AIR_ACCEL: 1600, FRICTION: 2200,
  JUMP_V: -700, COYOTE: 100, BUFFER: 200, CUT: 0.45,
  // S5 공유 기믹: 스위치를 밟으면 문이 GATE_OPEN_MS 동안 열림(관대한 유지시간)
  GATE_OPEN_MS: 4000,
  // S8 DDA: 같은 스테이지에서 DDA_DEATHS회 죽으면 도움 모드(코요테/버퍼 관대 + 리스폰 무적)
  DDA_DEATHS: 3, INVULN_MS: 1200,

  init: function (data) {
    data = data || {};
    this.stageId = data.stageId || '1-1';
    this.stageIndex = data.stageIndex || 1;
    this.stageName = data.stageName || '스테이지';
  },

  // 캐릭터 스프라이트(선택 캐릭터=나, 친구=고스트). 무빌드라 씬 preload로 로드.
  // 달리기=4x4=16프레임 시트(프레임 256, frame0=idle). 5종 전체를 공통 모듈에서 로드/등록.
  preload: function () {
    if (window.CoopCharAssets) CoopCharAssets.preload(this);
  },

  create: function () {
    this.inp = this.game.registry.get('input');

    this.WORLD_W = 3600;
    this.WORLD_H = 760;
    this.physics.world.setBounds(0, 0, this.WORLD_W, this.WORLD_H);
    this.cameras.main.setBounds(0, 0, this.WORLD_W, this.WORLD_H);

    var self = this;

    // ===== 지면 / 플랫폼 (플레이스홀더). 가운데 구덩이(낙사) 포함 =====
    this.solids = this.physics.add.staticGroup();
    this.spawn = { x: 120, y: 540 };
    this.checkpoint = null;

    var groundTop = 700;
    this._solid(1350, groundTop + 40, 2700, 80, 0x6b4f3a);  // 바닥 좌측 (0~2700)
    this._solid(3240, groundTop + 40, 720, 80, 0x6b4f3a);   // 바닥 우측 (2880~3600)
    this._solid(640, 600, 170, 26, 0x8a674b);
    this._solid(920, 510, 150, 26, 0x8a674b);
    this._solid(1200, 580, 130, 26, 0x8a674b);
    this._solid(1500, 470, 130, 26, 0x8a674b);
    this._solid(1780, 590, 210, 26, 0x8a674b);
    this._solid(2120, 380, 130, 26, 0x8a674b);
    this._solid(2420, 590, 170, 26, 0x8a674b);
    this._solid(2780, 520, 120, 26, 0x8a674b);

    // ===== 별 (수집) =====
    this.starCount = 0;
    this.stars = [];
    var starPts = [
      [640, 560], [920, 470], [1200, 540], [1500, 430],
      [1780, 550], [2120, 340], [2420, 550], [2780, 480], [3150, 640]
    ];
    starPts.forEach(function (pt) {
      var t = self.add.text(pt[0], pt[1], '⭐', { fontSize: '28px' }).setOrigin(0.5);
      self.stars.push({ obj: t, x: pt[0], y: pt[1], got: false });
    });
    this.totalStars = this.stars.length;

    // ===== 체크포인트 =====
    this.cpX = 1780;
    this.cpReached = false;
    this.cpFlag = this.add.text(this.cpX, 545, '🚩', { fontSize: '34px' }).setOrigin(0.5).setAlpha(0.5);

    // ===== 골인 깃발 =====
    this.goalX = 3320;
    this.cleared = false;
    this.add.text(this.goalX, 630, '🏁', { fontSize: '46px' }).setOrigin(0.5);

    // ===== 플레이어 =====
    // 물리 바디는 검증된 사각형(30x40) 그대로 유지하고 보이지 않게 한 뒤,
    // 그 위에 말랑 병아리 스프라이트를 입힌다(S10). → 손맛/충돌 회귀 없이 비주얼만 교체.
    this.player = this.add.rectangle(this.spawn.x, this.spawn.y, 30, 40, 0xff7ea8)
      .setStrokeStyle(3, 0xffffff).setVisible(false);
    this.physics.add.existing(this.player);
    this.player.body.setMaxVelocity(this.MOVE, 1500);
    this.physics.add.collider(this.player, this.solids);
    this.facing = 1;
    // 선택 캐릭터 결정: registry('coopCharId') 우선 → localStorage → 기본 병아리. 친구(고스트)는 다른 종.
    this.charId = this.registry.get('coopCharId') || (window.CoopCharStore && CoopCharStore.get()) || 'chick';
    this.playerKey = this.charId + '-run';
    this.ghostKey = (window.CoopFriendOf ? CoopFriendOf(this.charId) : 'cat') + '-run';
    // 달리기 애니메이션 16프레임(5종 전체를 게임 전역 anims에 1회 등록)
    // frame0 = idle. 달리기 1~15는 디퓨전이라 시간순이 아님 → 유사도 정렬 순서로 재배열(인접 프레임 비슷)
    // + yoyo로 양끝 끊김 없이. (순서는 characters.js, _gen/_order.py로 산출, 캐릭터별 상이)
    if (window.CoopCharAssets) CoopCharAssets.ensureAnims(this);
    // origin (0.5,1)=발바닥 기준 → 스프라이트 y를 바디 바닥에 맞추면 발이 지면에. 스쿼시도 발 기준으로 눌림.
    this._footY = this.player.height / 2; // 바디 절반 높이(player.y + footY = 바디 바닥). 하드코딩 대신 유도(리뷰)
    this.playerSprite = this.add.sprite(this.spawn.x, this.spawn.y + this._footY, this.playerKey, 0)
      .setOrigin(0.5, 1).setDepth(7).setDisplaySize(96, 96);
    // juice: 스쿼시/스트레치 스프링 기준 스케일. 단일 시트(frame0=idle, 1~15=run)라 스케일 일정.
    this._sBaseX = this.playerSprite.scaleX;
    this._sBaseY = this.playerSprite.scaleY;
    this._wasGrounded = true;
    this._pose = 'idle';
    this._lastSquash = -9999; // 착지 스쿼시 쿨다운(발판 가장자리 떨림 과트리거 방지)
    this._IDLE_FRAME = 0; this._AIR_FRAME = 3; // 정지=f0, 공중=단일 프레임(정점 snap 방지). 점프/하강감은 스쿼시/스트레치가 담당

    // ===== 카메라 따라가기 (offset은 _layout에서 화면폭 기준) =====
    this.cameras.main.startFollow(this.player, true, 0.18, 0.16);

    // ===== S5: 비대칭 스위치 → 문(게이트) =====
    // 솔로: 밟고 빠르게 통과. 2인(추후): 파트너가 밟아줌. 게이트 뒤에 보상 별이 위치.
    this.gateX = 2600;
    this.gateOpenUntil = -1;          // 이 시각까지 열림(로컬 time). S4: 추후 서버 권위 시각으로 대체
    this.gateClosedY = 626;           // 닫힘 위치(길 막음)
    this.gateOpenY = 470;             // 열림 위치(위로 올라감)
    this._gateState = 'closed';       // 'open' | 'closing'(겹침→재활성 보류) | 'closed'
    this.gate = this.add.rectangle(this.gateX, this.gateClosedY, 26, 168, 0x9b6cff)
      .setStrokeStyle(3, 0xffffff).setDepth(4);
    this.physics.add.existing(this.gate, true); // static body
    this.gateCollider = this.physics.add.collider(this.player, this.gate);
    // 문 위 자물쇠/타이머 표시
    this.gateIcon = this.add.text(this.gateX, this.gateClosedY - 100, '🔒', { fontSize: '24px' })
      .setOrigin(0.5).setDepth(5);
    // 스위치 발판 (밟으면 점등)
    this.switchX = 2350;
    this.switchPlate = this.add.rectangle(this.switchX, 690, 76, 16, 0xcf9a3a)
      .setStrokeStyle(2, 0x6e4e18).setDepth(3);
    this.switchHint = this.add.text(this.switchX, 656, '밟으면 문이 열려요', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#5a4a2a', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(3);

    // ===== S4: 원격 친구(고스트) — NetClient 중계 또는 솔로(숨김) =====
    // 친구 비주얼은 항상 만들되 기본 숨김. 피어 스냅이 들어오면 표시(솔로면 안 보임).
    this.ghost = this.add.sprite(this.spawn.x, 660, this.ghostKey, 0)
      .setOrigin(0.5, 1).setAlpha(0.85).setDepth(5).setDisplaySize(92, 92).setVisible(false);
    this._ghostPrevX = this.spawn.x;
    this._hasPeer = false;
    this.ghostTag = this.add.text(this.spawn.x, 626, '친구', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#fff', fontStyle: 'bold',
      backgroundColor: 'rgba(70,120,200,0.85)', padding: { x: 4, y: 1 }
    }).setOrigin(0.5, 1).setDepth(6).setVisible(false);

    // 전송계층 팩토리(coopTransportFactory)가 주입돼 있으면 멀티, 없으면 솔로.
    // HIGH 리뷰 반영: 인스턴스가 아니라 "팩토리"를 받아 매 PlayScene마다 새 transport를 생성한다.
    //   → 소유권이 PlayScene에 명확. 맵 갔다 재진입해도 닫힌 transport를 재사용하지 않는다.
    // now는 scene 시간축으로 통일 → sample(id, this.time.now)와 일관(보간/clock 도메인).
    // DummyPeer/RemotePlayer 직접 운용은 NetClient 내부로 이동(피어별 RemoteClock+RemotePlayer).
    this.net = null; this._transport = null; this._netReady = false;
    var makeTransport = this.registry.get('coopTransportFactory');
    if (typeof makeTransport === 'function' && window.NetClient) {
      this._transport = makeTransport();
      if (this._transport) {
        this.net = new NetClient(this._transport, { now: function () { return self.time.now; } });
        this.net.ready.then(function () { self._netReady = true; }); // MED 리뷰: ready 후에만 송신
      }
    }

    // ===== 손맛 타이머 상태 =====
    this._lastGrounded = -9999;
    this._lastJumpReq = -9999;
    this._didCut = false;
    this._jumping = false;
    this.deaths = 0;

    // ===== S8: DDA(도움 모드) + 리스폰 무적 상태 =====
    this.assist = false;
    this.coyoteMs = this.COYOTE;   // DDA로 관대해질 수 있어 인스턴스 변수로 보관
    this.bufferMs = this.BUFFER;
    this.invulnUntil = -1;

    // ===== S8: 이모트 말풍선 + 버튼 배선 =====
    this.EMOTES = { come: '🙋 빨리 와!', sorry: '🙇 미안!', good: '👍 굿!' };
    this.emoteBubble = this.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#2a3a4a', fontStyle: 'bold',
      backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 8, y: 4 }
    }).setOrigin(0.5, 1).setDepth(20).setAlpha(0);
    this._emoteBtns = [];
    var emoteEls = document.querySelectorAll('.emote-btn');
    Array.prototype.forEach.call(emoteEls, function (el) {
      var handler = function (e) { e.preventDefault(); self._emote(el.getAttribute('data-emote')); };
      el.addEventListener('pointerdown', handler);
      self._emoteBtns.push({ el: el, handler: handler });
    });
    this._emoteBar = document.getElementById('emoteBar');
    if (this._emoteBar) this._emoteBar.classList.add('is-active'); // 플레이 중에만 표시

    // ===== 화면 고정 UI (위치는 _layout에서) =====
    this.starHud = this.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '22px', color: '#7a4a00', fontStyle: 'bold',
      backgroundColor: 'rgba(255,255,255,0.7)', padding: { x: 8, y: 4 }
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    this.toast = this.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '24px', color: '#fff', fontStyle: 'bold',
      backgroundColor: 'rgba(0,0,0,0.45)', padding: { x: 12, y: 6 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);

    this.hud = this.add.text(8, 8, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#06402b',
      backgroundColor: 'rgba(255,255,255,0.6)', padding: { x: 5, y: 3 }
    }).setScrollFactor(0).setDepth(100);

    // 진행도 바
    this.pbBg = this.add.rectangle(0, 0, 100, 8, 0x000000, 0.25).setScrollFactor(0).setDepth(98);
    this.pbFriend = this.add.circle(0, 0, 6, 0x6ca8ff).setStrokeStyle(2, 0xffffff).setScrollFactor(0).setDepth(99);
    this.pbMe = this.add.circle(0, 0, 7, 0xff7ea8).setStrokeStyle(2, 0xffffff).setScrollFactor(0).setDepth(100);

    this._updateStarHud();
    this._layout();
    this.scale.on('resize', this._layout, this);
    this.events.once('shutdown', function () {
      self.scale.off('resize', self._layout, self);
      // 이모트 버튼 DOM 리스너 정리(씬 재시작 시 중복 방지) + 바 숨김(맵에선 비활성)
      self._emoteBtns.forEach(function (b) { b.el.removeEventListener('pointerdown', b.handler); });
      self._emoteBtns.length = 0;
      if (self._emoteBar) self._emoteBar.classList.remove('is-active');
      // S4: 전송계층 이탈(이 PlayScene이 만든 transport만 정리 — 팩토리 소유권)
      if (self._transport && self._transport.leave) self._transport.leave();
    });

    // 클리어 후 탭 → 지도(스테이지 선택)로
    this.input.on('pointerdown', function () { if (self.cleared) self.scene.start('map'); });
  },

  // 현재 캔버스 크기에 맞춰 화면 고정 UI 재배치(반응형/회전 대응)
  _layout: function () {
    var W = this.scale.width, H = this.scale.height;
    this.cameras.main.setFollowOffset(-W * 0.18, H * 0.04);
    this.starHud.setPosition(W - 12, 64); // 우상단 이모트 버튼(상단 14~60px) 아래로
    this.toast.setPosition(W / 2, Math.max(56, H * 0.1));
    var w = Math.max(120, W - 120), x0 = 60, y = 40;
    this.pbX0 = x0; this.pbW = w; this.pbY = y;
    this.pbBg.setPosition(x0 + w / 2, y).setSize(w, 8);
    this.pbMe.y = y; this.pbFriend.y = y;
    if (this.clearText) this.clearText.setPosition(W / 2, H / 2);
  },

  _solid: function (cx, cy, w, h, color) {
    var r = this.add.rectangle(cx, cy, w, h, color);
    this.solids.add(r);
    if (r.body && r.body.updateFromGameObject) r.body.updateFromGameObject();
    return r;
  },

  _updateStarHud: function () {
    this.starHud.setText('⭐ ' + this.starCount + ' / ' + this.totalStars);
  },

  _showToast: function (msg) {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 800, duration: 500 });
  },

  // S8: 이모트 — 캐릭터 머리 위 말풍선 팝(추후 파트너에게도 전송)
  _emote: function (type) {
    var msg = this.EMOTES[type];
    if (!msg || this.cleared) return;
    this.emoteBubble.setText(msg).setAlpha(1).setScale(0.7);
    this.tweens.killTweensOf(this.emoteBubble);
    this.tweens.add({ targets: this.emoteBubble, scale: 1, duration: 140, ease: 'Back.out' });
    this.tweens.add({ targets: this.emoteBubble, alpha: 0, delay: 1100, duration: 350 });
    // 추후: this.net && this.net.sendEmote(type)
  },

  // juice: 등장/소멸 뿅 연출
  _poof: function (x, y) {
    var p = this.add.text(x, y, '💨', { fontSize: '32px' }).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: p, scale: 1.8, alpha: 0, duration: 380,
      onComplete: function (tw, tg) { tg[0].destroy(); } });
  },

  // 클리어 꽃가루 (화면 고정 좌표, 가벼운 사각형 다발)
  _confetti: function () {
    var W = this.scale.width, H = this.scale.height;
    var colors = [0xff7ea8, 0x6ca8ff, 0xffd84d, 0x8ef0a0, 0xb98cff, 0xffa94d];
    for (var i = 0; i < 22; i++) {
      var c = this.add.rectangle(W / 2 + (Math.random() * 160 - 80), H * 0.3, 8, 13, colors[i % colors.length])
        .setScrollFactor(0).setDepth(220).setAngle(Math.random() * 360);
      this.tweens.add({ targets: c, y: H * 0.95, x: c.x + (Math.random() * 240 - 120),
        angle: c.angle + (Math.random() * 540 - 270), alpha: 0,
        duration: 1100 + Math.random() * 700, ease: 'Quad.in',
        onComplete: function (tw, tg) { tg[0].destroy(); } });
    }
  },

  _respawn: function () {
    var sp = this.checkpoint || this.spawn;
    this.player.body.reset(sp.x, sp.y);
    this._jumping = false;
    this._didCut = false;
    this._poof(sp.x, sp.y); // 재등장 뿅
    // S8: 리스폰 무적 + 깜빡임 연출 (보이는 스프라이트를 대상으로)
    this.invulnUntil = this.time.now + this.INVULN_MS;
    this.tweens.killTweensOf(this.playerSprite);
    this.playerSprite.setAlpha(1);
    // 한 사이클(yoyo)=240ms. 무적시간에 맞춰 repeat 보정(초과 깜빡임 방지)
    this.tweens.add({ targets: this.playerSprite, alpha: 0.35, duration: 120, yoyo: true,
      repeat: Math.max(0, Math.floor(this.INVULN_MS / 240) - 1),
      onComplete: function (tw, tg) { tg[0].setAlpha(1); } });
  },

  // S5: 게이트 상태 반영 (정적 바디 토글 + 비주얼).
  // 이 함수는 "상태를 적용/렌더"만 한다. 상태 계산(언제 열림)은 호출부가 결정 → S4에서 서버 권위로 교체 용이.
  // HIGH 리뷰 반영: 닫을 때 플레이어가 게이트와 겹쳐 있으면 끼임/튕김 방지를 위해
  // 바디 재활성화를 보류('closing')하고, 빠져나간 뒤 실제로 닫는다.
  _setGateOpen: function (open) {
    if (open) {
      if (this._gateState === 'open') return;
      this._gateState = 'open';
      this.gate.y = this.gateOpenY;
      this.gate.setAlpha(0.25);
      if (this.gate.body) { this.gate.body.enable = false; this.gate.body.updateFromGameObject(); }
      return;
    }
    // 닫기 요청
    if (this._gateState === 'closed') return;
    if (this._overlapsGate()) {
      // 플레이어가 게이트 영역 안 → 바디는 아직 끄고, 비주얼만 '닫히는 중'(반투명 경고)
      if (this._gateState !== 'closing') {
        this.gate.y = this.gateClosedY;
        this.gate.setAlpha(0.6);
        if (this.gate.body) this.gate.body.enable = false;
        this._gateState = 'closing';
      }
      return;
    }
    // 안전하게 닫기(겹침 없음)
    this._gateState = 'closed';
    this.gate.y = this.gateClosedY;
    this.gate.setAlpha(1);
    if (this.gate.body) { this.gate.body.enable = true; this.gate.body.updateFromGameObject(); }
  },

  // 플레이어 body가 닫힌 게이트 사각형과 겹치는지(끼임 방지 판정)
  _overlapsGate: function () {
    var pb = this.player.body;
    var hw = this.gate.width / 2, hh = this.gate.height / 2;
    return pb.right > this.gateX - hw && pb.left < this.gateX + hw &&
           pb.bottom > this.gateClosedY - hh && pb.top < this.gateClosedY + hh;
  },

  _clear: function () {
    this.cleared = true;
    this.player.body.setVelocity(0, 0);
    this.player.body.moves = false;

    // 별 평가: 1★ 클리어 / 2★ 별 절반↑ / 3★ 별 전부 + 무사망
    var earned = 1;
    if (this.starCount >= Math.ceil(this.totalStars / 2)) earned = 2;
    if (this.starCount === this.totalStars && this.deaths === 0) earned = 3;
    this.earnedStars = earned;
    if (window.ProgressStore) ProgressStore.recordClear(this.stageId, this.stageIndex, earned);

    // 합류/클리어 연출: 꽃가루 + 환호 바운스(친구가 있으면 함께 점프 — "함께 골인" 보상)
    this._confetti();
    // MED 리뷰: update 정지 후라 스프링이 안 돌므로, 스쿼시 잔상(scaleX)·무적 깜빡임(alpha)을
    // base로 고정하고 진행 중 트윈을 정리한 뒤 연출(좌우 잔상/깜빡임 경합 방지).
    this.tweens.killTweensOf(this.playerSprite);
    this.playerSprite.anims.stop();
    this.playerSprite.setAlpha(1).setScale(this._sBaseX, this._sBaseY);
    this.tweens.add({ targets: this.playerSprite, y: this.playerSprite.y - 28,
      scaleY: this._sBaseY * 1.15, duration: 240, yoyo: true, repeat: 2, ease: 'Quad.out' });
    if (this._hasPeer && this.ghost.visible) {
      this.tweens.add({ targets: [this.ghost, this.ghostTag], y: '-=24',
        duration: 240, yoyo: true, repeat: 2, ease: 'Quad.out' });
    }

    var starLine = '★'.repeat(earned) + '☆'.repeat(3 - earned);
    var msg = '🎉 클리어!\n' + starLine +
      '\n별 ' + this.starCount + '/' + this.totalStars + '   죽음 ' + this.deaths +
      '\n\n탭하면 지도로';
    this.clearText = this.add.text(this.scale.width / 2, this.scale.height / 2, msg, {
      fontFamily: 'sans-serif', fontSize: '28px', color: '#fff', fontStyle: 'bold',
      align: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: { x: 24, y: 18 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  },

  update: function (time, delta) {
    if (this.cleared) return;
    var inp = this.inp;
    var b = this.player.body;
    var grounded = b.blocked.down || b.touching.down;
    if (grounded) { this._lastGrounded = time; this._didCut = false; }
    // juice: 착지 스쿼시(공중→접지 전이 시 납작하게 → 스프링이 복원). 쿨다운으로 가장자리 떨림 방지.
    if (grounded && !this._wasGrounded && (time - this._lastSquash) > 150) {
      this.playerSprite.scaleX = this._sBaseX * 1.32;
      this.playerSprite.scaleY = this._sBaseY * 0.7;
      this._lastSquash = time;
    }
    this._wasGrounded = grounded;

    var dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir !== 0) this.facing = dir; // S10: 바라보는 방향(스프라이트 flip용)
    var accel = grounded ? this.ACCEL : this.AIR_ACCEL;
    if (dir !== 0) { b.setAccelerationX(dir * accel); b.setDragX(0); }
    else { b.setAccelerationX(0); b.setDragX(this.FRICTION); }

    if (inp.consumeJump()) this._lastJumpReq = time;
    var canCoyote = (time - this._lastGrounded) <= this.coyoteMs;
    var buffered = (time - this._lastJumpReq) <= this.bufferMs;
    if (buffered && canCoyote) {
      b.setVelocityY(this.JUMP_V);
      this._lastJumpReq = -9999; this._lastGrounded = -9999;
      this._didCut = false; this._jumping = true;
      // juice: 점프 스트레치(위로 길쭉 → 스프링 복원)
      this.playerSprite.scaleX = this._sBaseX * 0.82;
      this.playerSprite.scaleY = this._sBaseY * 1.24;
    }
    if (this._jumping && !inp.jumpHeld && b.velocity.y < 0 && !this._didCut) {
      b.setVelocityY(b.velocity.y * this.CUT);
      this._didCut = true;
    }
    if (b.velocity.y >= 0) this._jumping = false;

    var px = this.player.x, py = this.player.y;
    for (var i = 0; i < this.stars.length; i++) {
      var st = this.stars[i];
      if (st.got) continue;
      if (Math.abs(px - st.x) < 26 && Math.abs(py - st.y) < 30) {
        st.got = true; this.starCount++;
        this.tweens.add({ targets: st.obj, y: st.y - 30, alpha: 0, scale: 1.6, duration: 300,
          onComplete: function (tw, tg) { tg[0].destroy(); } });
        // S8 연출: "+1" 팝 + HUD 펀치
        var pop = this.add.text(st.x, st.y - 6, '+1', {
          fontFamily: 'sans-serif', fontSize: '20px', color: '#f5a623', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(15);
        this.tweens.add({ targets: pop, y: st.y - 46, alpha: 0, duration: 520,
          onComplete: function (tw, tg) { tg[0].destroy(); } });
        this.tweens.killTweensOf(this.starHud); this.starHud.setScale(1);
        this.tweens.add({ targets: this.starHud, scale: 1.25, duration: 90, yoyo: true });
        this._updateStarHud();
      }
    }

    if (!this.cpReached && px >= this.cpX) {
      this.cpReached = true;
      this.checkpoint = { x: this.cpX, y: 545 };
      this.cpFlag.setAlpha(1);
      this._showToast('체크포인트 통과!');
    }

    // S5: 스위치 밟음 판정(실제 bounds 기반) → 게이트 열림 타이머 갱신
    var sb = this.switchPlate.getBounds();
    var onSwitch = grounded && b.right > sb.x && b.left < sb.right &&
      Math.abs(b.bottom - sb.top) < 24;
    this.switchPlate.fillColor = onSwitch ? 0xffd84d : 0xcf9a3a;
    if (onSwitch) {
      if (this.gateOpenUntil < time) this._showToast('문이 열렸어요!');
      this.gateOpenUntil = time + this.GATE_OPEN_MS;
    }
    var gateOpen = time < this.gateOpenUntil;
    this._setGateOpen(gateOpen);
    // LOW 리뷰 반영: 밟는 중엔 열린 자물쇠(유지 중), 내려온 뒤부터 초 카운트다운
    if (gateOpen) {
      this.gateIcon.setText(onSwitch ? '🔓' : (Math.ceil((this.gateOpenUntil - time) / 1000) + 's'));
      this.gateIcon.y = this.gateOpenY - 100;
    } else {
      this.gateIcon.setText('🔒');
      this.gateIcon.y = this.gateClosedY - 100;
    }

    if (!this.cleared && px >= this.goalX) { this._clear(); return; }

    if (py > this.WORLD_H + 100) {
      this.deaths++;
      // S8 DDA: 반복 사망 시 도움 모드 1회 발동(코요테/버퍼 관대 — "투명+무적"은 리스폰 무적으로)
      if (!this.assist && this.deaths >= this.DDA_DEATHS) {
        this.assist = true;
        this.coyoteMs = this.COYOTE + 80;
        this.bufferMs = this.BUFFER + 100;
        this._showToast('천천히 해도 괜찮아! 도와줄게 ✨');
      } else {
        this._showToast('앗! 다시!');
      }
      this._respawn();
    }

    // 애니 상태머신(단일 시트 프레임만 사용): 공중=점프(f6)/낙하(f12), 접지+이동=달리기(1~15), 접지+정지=idle(f0)
    var spr = this.playerSprite;
    if (!grounded) {
      // 공중 내내 단일 프레임 → 정점(상승↔하강)에서 프레임이 안 바뀌어 끊김 없음
      if (this._pose !== 'air') { spr.anims.stop(); spr.setFrame(this._AIR_FRAME); this._pose = 'air'; }
    } else if (dir !== 0) {
      this._pose = 'run';
      spr.play(this.playerKey, true); // ignoreIfPlaying — 달리는 동안 사이클 유지
    } else {
      if (this._pose !== 'idle') { spr.anims.stop(); spr.setFrame(this._IDLE_FRAME); this._pose = 'idle'; }
    }
    // 스쿼시/스트레치 스프링 복원(프레임 애니와 별개 속성) + 위치(발바닥 origin)/방향 동기화
    spr.scaleX += (this._sBaseX - spr.scaleX) * 0.22;
    spr.scaleY += (this._sBaseY - spr.scaleY) * 0.22;
    spr.x = this.player.x;
    spr.y = this.player.y + this._footY;
    spr.setFlipX(this.facing < 0);
    // 공중 상승/하강 구분: 속도 기반 기울기(연속 → 정점에서 끊김 없음). 상승=뒤로 젖힘, 하강=앞으로 다이브.
    var targetRot = 0;
    if (!grounded) {
      var lean = Phaser.Math.Clamp(b.velocity.y * 0.0003, -0.06, 0.10); // 아주 살짝만(상승 ~3°/하강 ~6°)
      targetRot = (this.facing < 0) ? -lean : lean; // 좌향이면 시각적으로 같은 방향 되도록 부호 반전
    }
    spr.rotation += (targetRot - spr.rotation) * 0.25; // 부드럽게 들어가고 착지 시 0으로 복귀

    // S8: 이모트 말풍선이 캐릭터를 따라다님
    this.emoteBubble.x = this.player.x;
    this.emoteBubble.y = this.player.y - 30;

    // S4: 멀티면 내 위치 송신 + 원격 친구 보간 렌더. 솔로면 친구 숨김.
    var rs = null;
    if (this.net) {
      if (this._netReady) { // ready(WS open) 전 송신은 relay에서 드롭되므로 게이트
        this.net.sendPos({ x: px, y: py, vx: b.velocity.x, vy: b.velocity.y,
          grounded: grounded, facing: this.facing, name: '나' });
      }
      var pid = this.net.firstPeerId();
      rs = pid ? this.net.sample(pid, time) : null;
    }
    this._hasPeer = !!rs;
    if (rs) {
      this.ghost.setVisible(true); this.ghostTag.setVisible(true);
      this.ghost.play(this.ghostKey, true); // 친구도 달리기 사이클
      this.ghost.x = rs.x; this.ghost.y = rs.y + this._footY; // 발바닥 origin
      this.ghost.setFlipX(rs.x < this._ghostPrevX - 0.5); // 진행 방향 따라 flip
      this._ghostPrevX = rs.x;
      this.ghostTag.x = rs.x; this.ghostTag.y = this.ghost.y - 84;
    } else if (this.ghost.visible) {
      this.ghost.setVisible(false); this.ghostTag.setVisible(false);
    }
    // 진행도 인디케이터: 나는 항상, 친구는 피어 있을 때만
    this.pbMe.x = this.pbX0 + this.pbW * Phaser.Math.Clamp(px / this.goalX, 0, 1);
    this.pbFriend.setVisible(this._hasPeer);
    if (this._hasPeer) {
      this.pbFriend.x = this.pbX0 + this.pbW * Phaser.Math.Clamp(this.ghost.x / this.goalX, 0, 1);
    }

    this.hud.setText(
      'vx ' + b.velocity.x.toFixed(0) + ' vy ' + b.velocity.y.toFixed(0) +
      ' | g ' + (grounded ? 1 : 0) + ' | deaths ' + this.deaths + ' x ' + px.toFixed(0)
    );
  }
});

window.PlayScene = PlayScene;
