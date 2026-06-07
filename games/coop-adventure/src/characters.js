/* 협동대모험 — 캐릭터 정의 / 에셋 로딩 공통 모듈
 * 선택 씬(select.js)과 플레이 씬(play.js)이 함께 쓴다. 전역 1벌로 유지해 중복/불일치 방지.
 *
 * order = 달리기 16프레임 시트(4x4, frame0=idle, 1~15=run)의 "유사도 정렬 순서".
 *   디퓨전 시트는 시간순이 아니라 1→15 재생 시 다리가 튄다 → _gen/_order.py로 인접 최소변화 순서를
 *   산출하고 yoyo:true로 양끝 끊김 없이 재생한다. (캐릭터별 상이)
 */
(function () {
  var CHARS = [
    { id: 'chick',   name: '병아리', emoji: '🐤', order: [12, 15, 14, 7, 13, 11, 8, 5, 1, 4, 3, 2, 9, 10, 6] },
    { id: 'cat',     name: '고양이', emoji: '🐱', order: [4, 14, 2, 10, 12, 8, 3, 6, 1, 15, 7, 5, 13, 9, 11] },
    { id: 'puppy',   name: '강아지', emoji: '🐶', order: [1, 9, 5, 13, 11, 4, 14, 15, 3, 12, 6, 8, 7, 2, 10] },
    { id: 'rabbit',  name: '토끼',   emoji: '🐰', order: [5, 14, 8, 11, 2, 9, 7, 1, 12, 3, 10, 6, 15, 4, 13] },
    { id: 'hamster', name: '햄스터', emoji: '🐹', order: [7, 8, 15, 6, 9, 1, 14, 2, 11, 3, 10, 4, 12, 5, 13] }
  ];
  var MAP = {};
  CHARS.forEach(function (c) { MAP[c.id] = c; });

  window.COOP_CHARS = CHARS;
  window.COOP_CHAR_MAP = MAP;

  // 선택 캐릭터 저장/조회 (localStorage). 기본값 = 병아리.
  window.CoopCharStore = {
    KEY: 'coop.charId',
    get: function () {
      try { var v = localStorage.getItem(this.KEY); return (v && MAP[v]) ? v : 'chick'; }
      catch (e) { return 'chick'; }
    },
    set: function (id) { try { if (MAP[id]) localStorage.setItem(this.KEY, id); } catch (e) {} }
  };

  // 친구(고스트) 캐릭터: 내 캐릭터와 다른 한 종(시각 구분용). 멀티에서만 보임.
  window.CoopFriendOf = function (id) { return id === 'cat' ? 'chick' : 'cat'; };

  // 씬 공통: 시트 로드 + anims 등록 (이미 있으면 건너뜀 → 씬 재진입/중복 안전)
  window.CoopCharAssets = {
    preload: function (scene) {
      CHARS.forEach(function (c) {
        var key = c.id + '-run';
        if (!scene.textures.exists(key))
          scene.load.spritesheet(key, './assets/' + c.id + '-run.png', { frameWidth: 256, frameHeight: 256 });
      });
    },
    ensureAnims: function (scene, frameRate) {
      frameRate = frameRate || 18;
      CHARS.forEach(function (c) {
        var key = c.id + '-run';
        if (!scene.anims.exists(key))
          scene.anims.create({
            key: key, frameRate: frameRate, yoyo: true, repeat: -1,
            frames: scene.anims.generateFrameNumbers(key, { frames: c.order })
          });
      });
    }
  };
})();
