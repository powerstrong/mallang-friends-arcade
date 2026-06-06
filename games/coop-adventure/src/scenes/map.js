/* MapScene — 월드맵/스테이지 선택 (S7)
 * ProgressStore 기반으로 해금 상태·별 평가를 렌더하고, 탭하면 해당 스테이지로 PlayScene 시작.
 * 반응형: _layout()에서 현재 캔버스 크기에 맞춰 노드 재배치. */
function coopStarStr(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }

var MapScene = new Phaser.Class({
  Extends: Phaser.Scene,

  initialize: function MapScene() { Phaser.Scene.call(this, { key: 'map' }); },

  create: function () {
    var self = this;
    this.cameras.main.setBackgroundColor('#bfe3ff');

    this.title = this.add.text(0, 0, '🗺️ 스테이지 선택', {
      fontFamily: 'sans-serif', fontSize: '30px', color: '#2a3a4a', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.hint = this.add.text(0, 0, '스테이지를 골라 시작해요!', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#5a6a7a'
    }).setOrigin(0.5);

    var stages = window.COOP_STAGES || [];
    var prog = window.ProgressStore ? ProgressStore.get() : { maxStage: 1, stars: {} };

    this.nodes = stages.map(function (st) {
      var unlocked = st.index <= prog.maxStage;
      var stars = (prog.stars && prog.stars[st.id]) || 0;
      var circle = self.add.circle(0, 0, 40, unlocked ? 0xff7ea8 : 0x9aa3ad).setStrokeStyle(4, 0xffffff);
      var label = self.add.text(0, 0, unlocked ? String(st.index) : '🔒', {
        fontFamily: 'sans-serif', fontSize: '30px', color: '#fff', fontStyle: 'bold'
      }).setOrigin(0.5);
      var nameTxt = self.add.text(0, 0, st.name, {
        fontFamily: 'sans-serif', fontSize: '14px', color: unlocked ? '#3a4a5a' : '#9aa3ad', fontStyle: 'bold'
      }).setOrigin(0.5);
      var starTxt = self.add.text(0, 0, unlocked ? coopStarStr(stars) : '', {
        fontSize: '18px', color: '#f5a623'
      }).setOrigin(0.5);

      var node = { st: st, unlocked: unlocked, circle: circle, label: label, nameTxt: nameTxt, starTxt: starTxt };
      if (unlocked) {
        var zone = self.add.zone(0, 0, 96, 110).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', function () {
          self.scene.start('play', { stageId: st.id, stageIndex: st.index, stageName: st.name });
        });
        node.zone = zone;
      }
      return node;
    });

    this._layout();
    this.scale.on('resize', this._layout, this);
    this.events.once('shutdown', function () { self.scale.off('resize', self._layout, self); });
  },

  _layout: function () {
    var W = this.scale.width, H = this.scale.height;
    this.title.setPosition(W / 2, Math.max(56, H * 0.16));
    this.hint.setPosition(W / 2, Math.max(96, H * 0.27));

    var n = this.nodes.length || 1;
    var gap = Math.min(150, (W - 80) / n);
    var startX = W / 2 - gap * (n - 1) / 2;
    var y = H * 0.56;
    this.nodes.forEach(function (node, i) {
      var x = startX + gap * i;
      node.circle.setPosition(x, y);
      node.label.setPosition(x, y);
      node.starTxt.setPosition(x, y - 58);
      node.nameTxt.setPosition(x, y + 58);
      if (node.zone) node.zone.setPosition(x, y);
    });
  }
});

window.MapScene = MapScene;
