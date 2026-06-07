/* 말랑프렌즈 협동대모험 — 부트 (무빌드 Phaser)
 * 입력 인스턴스 생성 → 가상패드/키보드 연결 → Phaser.Game 시작.
 * 전역 오염 방지를 위해 IIFE로 감싼다. */
(function () {
  // 세로 폰 친화 설계 해상도(가로 스크롤은 카메라가 처리). FIT으로 화면에 맞춤.
  var GAME_W = 540;
  var GAME_H = 720;

  var input = new CoopInput();
  input.attachKeyboard();
  input.attachButton(document.getElementById('btnLeft'), 'left');
  input.attachButton(document.getElementById('btnRight'), 'right');
  input.attachButton(document.getElementById('btnJump'), 'jump');

  var config = {
    type: Phaser.AUTO,
    parent: 'game',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#bfe3ff',
    scale: {
      // 반응형: 캔버스가 기기/창을 꽉 채우고, 가로모드일수록 전방 시야가 넓어진다.
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: 1400 }, fps: 60, debug: false }
    },
    scene: [SelectScene, MapScene, PlayScene]
  };

  var game = new Phaser.Game(config);
  game.registry.set('input', input);
  game.registry.set('design', { GAME_W: GAME_W, GAME_H: GAME_H });

  // 디버그용 전역 노출 (프로토타입 한정). window.__coop.input 으로 입력 주입 가능.
  window.__coop = { game: game, input: input };
})();
