/* SelectScene — 캐릭터 선택 (부트 첫 화면)
 * 5종이 각자 달리는 미리보기를 보여주고, 탭으로 고른 뒤 '시작'하면 MapScene으로.
 * 선택은 registry('coopCharId') + localStorage(CoopCharStore)에 저장 → PlayScene이 읽어 플레이어로 사용.
 * 반응형: _layout()에서 캔버스 크기에 맞춰 재배치(맵/플레이 씬과 동일 패턴).
 */
var SelectScene = new Phaser.Class({
  Extends: Phaser.Scene,

  initialize: function SelectScene() { Phaser.Scene.call(this, { key: 'select' }); },

  preload: function () { if (window.CoopCharAssets) CoopCharAssets.preload(this); },

  create: function () {
    var self = this;
    this.cameras.main.setBackgroundColor('#bfe3ff');
    if (window.CoopCharAssets) CoopCharAssets.ensureAnims(this);

    this.title = this.add.text(0, 0, '🐾 캐릭터 선택', {
      fontFamily: 'sans-serif', fontSize: '30px', color: '#2a3a4a', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.hint = this.add.text(0, 0, '함께 달릴 친구를 골라요!', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#5a6a7a'
    }).setOrigin(0.5);

    this.selectedId = (window.CoopCharStore && CoopCharStore.get()) || 'chick';

    var chars = window.COOP_CHARS || [];
    this.cards = chars.map(function (c) {
      var key = c.id + '-run';
      var ring = self.add.circle(0, 0, 56, 0xffffff, 0).setStrokeStyle(5, 0xffd24a).setVisible(false);
      var pad = self.add.ellipse(0, 0, 92, 20, 0x000000, 0.12);
      var spr = self.add.sprite(0, 0, key, 0).setOrigin(0.5, 1).setDisplaySize(92, 92);
      if (self.anims.exists(key)) spr.play(key, true); // 각자 달리는 미리보기
      var name = self.add.text(0, 0, c.name, {
        fontFamily: 'sans-serif', fontSize: '15px', color: '#3a4a5a', fontStyle: 'bold'
      }).setOrigin(0.5);
      var zone = self.add.zone(0, 0, 116, 150).setInteractive({ useHandCursor: true });
      var card = { c: c, ring: ring, pad: pad, spr: spr, name: name, zone: zone };
      zone.on('pointerdown', function () { self.select(c.id); });
      return card;
    });

    this.startBtn = this.add.text(0, 0, '이 친구로 시작 ▶', {
      fontFamily: 'sans-serif', fontSize: '20px', color: '#fff', fontStyle: 'bold',
      backgroundColor: '#ff7ea8', padding: { x: 20, y: 11 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.startBtn.on('pointerover', function () { self.startBtn.setScale(1.05); });
    this.startBtn.on('pointerout', function () { self.startBtn.setScale(1); });
    this.startBtn.on('pointerdown', function () {
      if (window.CoopCharStore) CoopCharStore.set(self.selectedId);
      self.registry.set('coopCharId', self.selectedId);
      self.scene.start('map');
    });

    this.select(this.selectedId);
    this._layout();
    this.scale.on('resize', this._layout, this);
    this.events.once('shutdown', function () { self.scale.off('resize', self._layout, self); });
  },

  // 선택 표시: 링 표시 + 살짝 크게 + 이름 강조
  select: function (id) {
    this.selectedId = id;
    this.cards.forEach(function (card) {
      var on = card.c.id === id;
      card.ring.setVisible(on);
      card.spr.setDisplaySize(on ? 112 : 92, on ? 112 : 92);
      card.name.setColor(on ? '#d6336c' : '#3a4a5a');
    });
  },

  _layout: function () {
    var W = this.scale.width, H = this.scale.height;
    this.title.setPosition(W / 2, Math.max(52, H * 0.12));
    this.hint.setPosition(W / 2, Math.max(88, H * 0.20));

    var n = this.cards.length || 1;
    var gap = Math.min(132, (W - 60) / n);
    var startX = W / 2 - gap * (n - 1) / 2;
    var y = H * 0.52;
    this.cards.forEach(function (card, i) {
      var x = startX + gap * i;
      card.ring.setPosition(x, y - 40);
      card.pad.setPosition(x, y + 4);
      card.spr.setPosition(x, y + 4);   // origin(0.5,1) → 발이 pad에
      card.name.setPosition(x, y + 30);
      card.zone.setPosition(x, y - 16);
    });
    this.startBtn.setPosition(W / 2, Math.min(H - 56, y + 132));
  }
});

window.SelectScene = SelectScene;
