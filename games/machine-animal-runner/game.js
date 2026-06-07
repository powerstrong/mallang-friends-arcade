/* 기계동물 러너 — 부트 (무빌드 Phaser)
 * 세로 전진 크라우드 러너 프로토타입. portrait 고정 좌표계(540x720, FIT).
 * 전역 오염 방지 IIFE. */
(function () {
  var input = new RunnerInput();
  input.attachKeyboard();

  var config = {
    type: Phaser.AUTO,
    parent: 'game',
    width: 540,
    height: 720,
    backgroundColor: '#bfe3ff',
    scale: {
      // portrait 고정: 게임 전체를 화면에 맞춰 균일 축소(좌표계 항상 540x720).
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [PlayScene]
  };

  var game = new Phaser.Game(config);
  game.registry.set('input', input);

  // 디버그 전역 (프로토타입 한정).
  window.__mar = { game: game, input: input };
})();
