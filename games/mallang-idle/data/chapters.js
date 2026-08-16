/*
 * 말랑프렌즈 키우기 — 챕터 데이터
 *
 * 스테이지 구간 → 테마 / 적 / 배경. 전투 규칙은 챕터가 바뀌어도 그대로이고,
 * 바뀌는 것은 외형과 이름뿐이다. 그래서 챕터는 계속 덧붙일 수 있다.
 *
 * 톤 설계(../CORE_LOOP.md 7절): 초반은 평화롭게 — 첫 3분에 위협을 주지 않는다.
 * 중반부터 기계 부품이 섞이고, 후반에 기계군단이 주요 적 세력으로 등장한다.
 *
 * `to: null` 은 "이후 전부"를 뜻한다. 새 챕터를 추가할 때 마지막 챕터의 to 를
 * 채우고 뒤에 이어 붙이면 된다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleChapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CHAPTERS = [
    {
      id: 'meadow',
      name: '말랑 들판',
      tagline: '오늘도 평화로운 산책길',
      from: 1, to: 30,
      bg: 'assets/bg-meadow.jpg',
      fg: 'assets/fg-meadow.png',
      accent: '#7fc99a',
      mobs: [
        { id: 'acorn',     name: '말썽 도토리', art: 'assets/mob-acorn.png' },
        { id: 'jelly',     name: '탱글 젤리',   art: 'assets/mob-jelly.png' },
        { id: 'cloudpuff', name: '심술 구름',   art: 'assets/mob-cloudpuff.png' },
      ],
      boss: { id: 'cottoncandy', name: '솜사탕 대왕', art: 'assets/boss-cottoncandy.png' },
    },
    {
      id: 'gears',
      name: '삐걱이는 언덕',
      tagline: '어딘가에서 톱니 소리가 들린다',
      from: 31, to: 70,
      bg: 'assets/bg-gears.jpg',
      fg: 'assets/fg-meadow.png',
      accent: '#c9a87f',
      mobs: [
        { id: 'gearbug',    name: '톱니 벌레',   art: 'assets/mob-gearbug.png' },
        { id: 'springmouse', name: '태엽 생쥐',  art: 'assets/mob-springmouse.png' },
        { id: 'bolthopper', name: '볼트 뭉치',   art: 'assets/mob-bolthopper.png' },
      ],
      boss: { id: 'clocktower', name: '시계탑 거인', art: 'assets/boss-clocktower.png' },
    },
    {
      id: 'machine',
      name: '기계군단 전선',
      tagline: '말랑한 것들을 지켜야 한다',
      from: 71, to: 130,
      bg: 'assets/bg-machine.jpg',
      fg: 'assets/fg-machine.png',
      accent: '#8fa6c9',
      mobs: [
        { id: 'mech-chick',   name: '기계 병아리', art: 'assets/enemy-mech-chick.png' },
        { id: 'mech-hamster', name: '기계 햄스터', art: 'assets/enemy-mech-hamster.png' },
        { id: 'mech-latte',   name: '기계 퍼피',   art: 'assets/enemy-mech-latte.png' },
      ],
      boss: { id: 'mech-rabbit', name: '기계 토끼', art: 'assets/boss-mech-rabbit.png' },
    },
    {
      id: 'core',
      name: '군단 심장부',
      tagline: '대장이 기다리고 있다',
      from: 131, to: 180,
      bg: 'assets/bg-machine.jpg',
      fg: 'assets/fg-machine.png',
      accent: '#7f8fc9',
      mobs: [
        { id: 'mech-hamster', name: '강화 햄스터', art: 'assets/enemy-mech-hamster.png' },
        { id: 'mech-latte',   name: '강화 퍼피',   art: 'assets/enemy-mech-latte.png' },
        { id: 'mech-chick',   name: '강화 병아리', art: 'assets/enemy-mech-chick.png' },
      ],
      boss: { id: 'mech-general', name: '기계군단 대장', art: 'assets/boss-mechgeneral.png' },
    },
    {
      id: 'garden',
      name: '되찾은 하늘 정원',
      tagline: '다시 찾아온 평화, 그 위로',
      from: 181, to: 210,
      bg: 'assets/bg-garden.jpg',
      fg: 'assets/fg-meadow.png',
      accent: '#ef9fc0',
      mobs: [
        { id: 'petalfairy', name: '꽃잎 요정',   art: 'assets/mob-petalfairy.png' },
        { id: 'honeybee',   name: '꿀벌 아기',   art: 'assets/mob-honeybee.png' },
        { id: 'cloudsheep', name: '구름 양',     art: 'assets/mob-cloudsheep.png' },
      ],
      boss: { id: 'flowerqueen', name: '꽃의 여왕', art: 'assets/boss-flowerqueen.png' },
    },
    /* ── 2막: 별조각의 근원을 찾아서 ─────────────────────────────
     * 정원 에필로그 뒤에 새 궁금증을 연다: 그 많던 별조각과 기계군단은
     * 어디서 왔는가. 별빛 바다를 건너 달의 고장난 공장에 닿는다 —
     * moonfactory 가 무한 꼬리 챕터인 것도 서사가 설명한다("공장은 멈추지 않는다"). */
    {
      id: 'starsea',
      name: '별빛 바다',
      tagline: '별조각이 가리키는 곳으로',
      from: 211, to: 270,
      bg: 'assets/bg-starsea.jpg',
      fg: 'assets/fg-starsea.png',
      accent: '#7f9ce0',
      mobs: [
        { id: 'stardrop',  name: '별똥 아기',   art: 'assets/mob-stardrop.png' },
        { id: 'moonjelly', name: '달빛 해파리', art: 'assets/mob-moonjelly.png' },
        { id: 'comet',     name: '꼬마 혜성',   art: 'assets/mob-comet.png' },
      ],
      boss: { id: 'starwhale', name: '별고래', art: 'assets/boss-starwhale.png' },
    },
    {
      id: 'moonfactory',
      name: '고장난 달 공장',
      tagline: '기계군단이 태어난 곳',
      from: 271, to: null,
      bg: 'assets/bg-moonfactory.jpg',
      fg: 'assets/fg-moonfactory.png',
      accent: '#a89bc9',
      mobs: [
        { id: 'scrapscout',  name: '부서진 정찰기', art: 'assets/mob-scrapscout.png' },
        { id: 'boltsprite',  name: '나사 요정',     art: 'assets/mob-boltsprite.png' },
        { id: 'dustpuff',    name: '달먼지 뭉치',   art: 'assets/mob-dustpuff.png' },
      ],
      boss: { id: 'moonoverseer', name: '달의 감독관', art: 'assets/boss-moonoverseer.png' },
    },
  ];

  function chapterFor(stage) {
    for (var i = 0; i < CHAPTERS.length; i++) {
      var c = CHAPTERS[i];
      if (stage >= c.from && (c.to == null || stage <= c.to)) return c;
    }
    return CHAPTERS[CHAPTERS.length - 1];
  }

  /* 스테이지 안에서 몇 번째 몹인지에 따라 결정론적으로 외형을 고른다.
   * 무작위를 쓰지 않으므로 같은 스테이지는 언제 봐도 같은 순서로 나온다. */
  function mobFor(stage, index) {
    var c = chapterFor(stage);
    return c.mobs[(stage + index) % c.mobs.length];
  }

  function bossFor(stage) { return chapterFor(stage).boss; }

  return { CHAPTERS: CHAPTERS, chapterFor: chapterFor, mobFor: mobFor, bossFor: bossFor };
});
