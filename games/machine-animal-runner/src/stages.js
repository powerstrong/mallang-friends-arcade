/* MAR_STAGES — 3스테이지 손배치 정의 (M2)
 *
 * 난이도 목표(DESIGN.md): 첫 시도 클리어율 80 / 65 / 45 (±10%p) — 텔레메트리로 추적·재튜닝.
 * 룰: 랜덤 금지(전부 손배치), 매 게이트 "명백한 오답 없음", 큰 수가 정답이 아닌 구간 2+.
 * 스테이지1은 튜토리얼 — 게이트 좌=수(파랑)/우=질(주황) 고정으로 학습시키고,
 * 스테이지2·3부터는 좌우를 섞어 "위치 외우기"를 깬다(읽고 골라야 함).
 *
 * [튜닝 대기 — 텔레메트리로 검증할 것(codex P1)]: risk ×3 이후엔 사수상한 때문에 수 게이트가
 * DPS 기여를 못 해 후반 선택이 질로 기울 수 있다. 후반 수 게이트(+20/+24)는 보스 드레인·조준탄
 * 생존 버퍼로 설계했으나, gate 텔레메트리에서 한쪽 선택률이 80%+ 면 수치 재조정.
 *
 * 이벤트 종류:
 *   gate    — 좌/우 택1. op: mul(×N)/add(+N)/pow(무기+N)/neg(−N+무적 invulnSec초)
 *   mob     — 떼(접촉당 2). armor — 장갑(접촉 14). barrier — 수평벽(잔여 비례 피해)
 *   risk    — 리스크 레인: 좁은 통로 통과 ×mult, 벽에 걸리면 −graze (실력 기반, 운빨 없음)
 * neg 게이트는 스테이지당 1회, 직후에 떼/장벽을 배치해 무적 이득을 즉시 보여준다(codex 권고).
 *
 * 팔레트: 절차적 배경의 색만 교체(낮/노을/밤). flowers 는 밤에는 별처럼 보인다. */
(function (global) {
  var BLUE = 0x4fa3ff, ORANGE = 0xff8a3d, PURPLE = 0x9a6bd0;

  function g(at, left, right) { return { at: at, gate: { left: left, right: right } }; }
  function num(op, val) {
    return { op: op, val: val, label: (op === 'mul' ? '×' + val : '+' + val), color: BLUE };
  }
  function pow(val) { return { op: 'pow', val: val, label: '무기+' + val, color: ORANGE }; }
  function neg(val, sec) {
    return { op: 'neg', val: val, invulnSec: sec, label: '−' + val + ' 무적' + sec + '초', color: PURPLE };
  }

  global.MAR_STAGES = [
    {
      id: 'stage1', name: '낮의 들판', targetClear: 0.80,
      palette: {
        grass: 0xb5e8a3, road: 0xf2e8d0, rail: 0xd8c9a4, deco: 0xc4b28c,
        flowers: [0xffc4d6, 0xfff3b0, 0xffffff]
      },
      bossAt: 12000, bossHp: 900, bossShotEvery: 1.1, bossDrain: 10,
      events: [
        g(700, num('mul', 2), pow(1)),
        { at: 1500, mob: { count: 6, hp: 6 } },
        g(2300, num('add', 6), pow(1)),
        { at: 3100, armor: { hp: 240 } },
        g(3900, num('mul', 2), pow(2)),              // 애매①
        { at: 4700, barrier: { hp: 360 } },
        { at: 5600, mob: { count: 10, hp: 5 } },
        g(6500, num('add', 12), pow(1)),
        { at: 7400, armor: { hp: 420 } },
        g(8300, num('mul', 2), pow(2)),              // 애매②
        { at: 9300, mob: { count: 14, hp: 6 } },
        { at: 10300, barrier: { hp: 520 } },
        g(11200, num('add', 20), pow(3))
      ]
    },
    {
      id: 'stage2', name: '노을 언덕', targetClear: 0.65,
      palette: {
        grass: 0xcfc98a, road: 0xf5ddc0, rail: 0xd8a98a, deco: 0xc08a6a,
        flowers: [0xffb0a0, 0xffd9a0, 0xfff0d0]
      },
      bossAt: 12200, bossHp: 1500, bossShotEvery: 1.0, bossDrain: 10,
      events: [
        g(700, num('mul', 2), pow(1)),
        { at: 1500, mob: { count: 8, hp: 6 } },
        g(2300, pow(1), num('add', 8)),              // 좌우 섞기 시작
        { at: 3100, armor: { hp: 300 } },
        { at: 3900, risk: { gapR: 0.36, gapW: 110, mult: 3, graze: 10 } },
        g(4700, num('mul', 2), pow(2)),              // 애매
        { at: 5500, barrier: { hp: 480 } },
        { at: 6300, mob: { count: 12, hp: 6 } },
        // 네거티브 직후는 떼가 아니라 장벽 — 떼 접촉(−2×n)으론 −5 비용 대비 손익이 안 맞아
        // "명백한 오답 없음"이 깨진다(codex). 장벽 잔여피해는 −5 이상을 막을 수 있는 위협.
        g(7100, neg(5, 3), num('add', 4)),           // 네거티브(스테이지당 1회)
        // 게이트→장벽 간격은 무적 시간 안이어야 한다: 460px/165px·s ≈ 2.8s < 3s
        { at: 7560, barrier: { hp: 560 } },          // 무적이면 무피해 통과 — 이득 가시화
        g(8500, num('add', 14), pow(2)),
        { at: 9300, armor: { hp: 560 } },
        { at: 10200, barrier: { hp: 620 } },
        g(11100, pow(3), num('add', 20))             // 섞기
      ]
    },
    {
      id: 'stage3', name: '달빛 숲', targetClear: 0.45,
      palette: {
        grass: 0x3d5a73, road: 0x8a93b3, rail: 0x5a6480, deco: 0x707a99,
        flowers: [0xfff3b0, 0xb3e6ff, 0xffffff]
      },
      bossAt: 12600, bossHp: 2000, bossShotEvery: 0.85, bossDrain: 12,
      events: [
        g(700, num('mul', 2), pow(1)),
        { at: 1400, mob: { count: 10, hp: 6 } },
        g(2100, pow(2), num('add', 8)),              // 섞기
        { at: 2900, armor: { hp: 380 } },
        { at: 3600, risk: { gapR: 0.66, gapW: 100, mult: 3, graze: 10 } },
        g(4300, num('mul', 2), pow(2)),
        { at: 5000, barrier: { hp: 600 } },
        { at: 5800, mob: { count: 14, hp: 7 } },
        g(6500, neg(6, 3), num('add', 5)),
        { at: 6960, barrier: { hp: 500 } },          // 무적으로 통과 이득 (460px ≈ 2.8s < 3s)
        g(7900, num('add', 16), pow(2)),
        { at: 8700, armor: { hp: 700 } },
        { at: 9400, risk: { gapR: 0.5, gapW: 88, mult: 3, graze: 10 } },
        { at: 10200, mob: { count: 18, hp: 6 } },
        g(11000, pow(3), num('add', 24))             // 섞기
      ]
    }
  ];
})(window);
