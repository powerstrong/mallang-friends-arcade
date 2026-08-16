/*
 * 말랑프렌즈 키우기 — 스토리 데이터
 *
 * 방치형의 서사 문법: 짧고, 스킵 가능하고, 진행을 오래 막지 않는다.
 * 비트는 세 종류다.
 *   chapter — 챕터 첫 진입 시 3줄 안팎의 컷신 (전투 일시정지)
 *   join    — 동료 합류 시 한두 줄 (전투 일시정지)
 *   boss    — 챕터 보스 첫 조우 시 도발 한 줄 (말풍선, 정지 없음)
 *
 * 핵심 훅: 기계군단의 기계 병아리·햄스터·퍼피는 "잡혀가 개조된 들판 친구들"이다.
 * 싸우는 이유가 숫자가 아니라 구출이 된다 — 기존 적 아트가 그대로 서사가 된다.
 *
 * 화자(who)는 캐릭터 id 또는 'narr'(내레이션). 컷신 화자는 그 챕터 시작 스테이지에서
 * 이미 합류한 친구만 쓴다(피치 5 · 푸딩 15 · 라떼 30 · 민트 50 해금과 챕터 경계
 * 31/71/131/181 을 맞춰 검증 테스트가 지킨다).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleStory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCENES = [
    {
      id: 'ch-meadow', trigger: { type: 'chapter', chapter: 'meadow' },
      lines: [
        { who: 'rabbit', text: '오늘도 산책하기 딱 좋은 날이야!' },
        { who: 'narr',   text: '…그런데 들판 친구들의 표정이 어딘가 이상하다.' },
        { who: 'rabbit', text: '도토리가 화를 내네? 무슨 일인지 가 보자!' },
      ],
    },
    {
      id: 'ch-gears', trigger: { type: 'chapter', chapter: 'gears' },
      lines: [
        { who: 'chick',  text: '어…? 땅에 톱니바퀴가 박혀 있어!' },
        { who: 'hamster', text: '이거 자연산 아니야. 누가 들판을 바꾸고 있어.' },
        { who: 'rabbit', text: '쇠 냄새가 점점 진해져. 조심해서 가자.' },
      ],
    },
    {
      id: 'ch-machine', trigger: { type: 'chapter', chapter: 'machine' },
      lines: [
        { who: 'latte',  text: '멍…! 저기 봐. 병아리가… 기계가 됐어.' },
        { who: 'chick',  text: '내 친구들이야!! 기계군단이 데려간 거야!' },
        { who: 'rabbit', text: '개조된 친구들을 원래대로 돌려놓자. 가자!' },
      ],
    },
    {
      id: 'ch-core', trigger: { type: 'chapter', chapter: 'core' },
      lines: [
        { who: 'mintcat', text: '…심장부야. 대장이 여기 있어.' },
        { who: 'latte',  text: '멍! 큰 녀석은 내가 먼저 문다!' },
        { who: 'rabbit', text: '다들 준비됐지? 말랑 파워로 끝내자!' },
      ],
    },
    {
      id: 'ch-garden', trigger: { type: 'chapter', chapter: 'garden' },
      lines: [
        { who: 'chick',  text: '우와아… 하늘 위에 정원이 있었어!' },
        { who: 'mintcat', text: '기계군단이 숨겨 두었던 곳인가 봐.' },
        { who: 'hamster', text: '친구들도 전부 말랑말랑하게 돌아왔어~' },
        { who: 'rabbit', text: '평화를 되찾았어. …그래도 산책은 계속된다!' },
      ],
    },
    {
      id: 'join-chick', trigger: { type: 'join', char: 'chick' },
      lines: [{ who: 'chick', text: '나도 갈래! 콕콕 쪼아 줄 거야!' }],
    },
    {
      id: 'join-hamster', trigger: { type: 'join', char: 'hamster' },
      lines: [{ who: 'hamster', text: '볼주머니에 골드 가득 담아 올게~' }],
    },
    {
      id: 'join-latte', trigger: { type: 'join', char: 'latte' },
      lines: [{ who: 'latte', text: '멍! 큰 녀석은 나한테 맡겨!' }],
    },
    {
      id: 'join-mintcat', trigger: { type: 'join', char: 'mintcat' },
      lines: [{ who: 'mintcat', text: '…따라와 주지. 빠르게 가자.' }],
    },
  ];

  /* 보스 첫 조우 도발 — 말풍선 한 줄, 전투를 멈추지 않는다 */
  var BOSS_LINES = {
    meadow:  '달콤한 맛 좀 볼래?',
    gears:   '똑딱… 똑딱… 시간이 없을 텐데?',
    machine: '말랑한 것은 전부 부품이 된다.',
    core:    '여기까지 온 말랑이는 네가 처음이다.',
    garden:  '이 정원의 아름다움, 견딜 수 있겠니?',
  };

  function sceneFor(type, key) {
    for (var i = 0; i < SCENES.length; i++) {
      var t = SCENES[i].trigger;
      if (t.type !== type) continue;
      if (type === 'chapter' && t.chapter === key) return SCENES[i];
      if (type === 'join' && t.char === key) return SCENES[i];
    }
    return null;
  }

  function bossLine(chapterId) { return BOSS_LINES[chapterId] || null; }

  return { SCENES: SCENES, BOSS_LINES: BOSS_LINES, sceneFor: sceneFor, bossLine: bossLine };
});
