/* STAGE 1 — 손배치 레이아웃 (프로토타입)
 * 스펙/리뷰 권고: 랜덤 남발 금지, 손배치 8~12 게이트쌍 + 수장벽1 + 장갑적1 + 미니보스1,
 * 그리고 "큰 수가 정답이 아닌" 구간이 2개 이상.
 *
 * dist = 시작점에서의 거리(px). 스크롤 속도 약 165px/s.
 * gate.left/right.op = 'mul' | 'add' | 'pow'  (택1 통과)
 *   - 수 유리 구간(떼/생존) 직전엔 ×N/+N 이 좋고,
 *   - 질 유리 구간(장갑/벽/보스) 직전엔 무기 강화가 좋다 → 상황마다 정답이 바뀜.
 * 의도적 "애매 게이트"(at:3900, 8300)는 바로 뒤 구간 성격에 따라 정답이 갈린다. */
(function (global) {
  global.MAR_STAGE1 = {
    bossAt: 12000,
    bossHp: 900,
    events: [
      { at: 700,   gate: { left: { op: 'mul', val: 2, label: '×2',    color: 0x4fa3ff },
                           right:{ op: 'pow', val: 1, label: '무기+1', color: 0xff8a3d } } },
      { at: 1500,  mob: { count: 6, hp: 6, spread: 1.0 } },                 // 가벼운 떼 (튜토리얼)
      { at: 2300,  gate: { left: { op: 'add', val: 6, label: '+6',     color: 0x4fa3ff },
                           right:{ op: 'pow', val: 1, label: '무기+1', color: 0xff8a3d } } },
      { at: 3100,  armor: { hp: 240 } },                                    // 질 유리: 장갑 → 화력
      { at: 3900,  gate: { left: { op: 'mul', val: 2, label: '×2',    color: 0x4fa3ff },
                           right:{ op: 'pow', val: 2, label: '무기+2', color: 0xff8a3d } } }, // 애매①
      { at: 4700,  barrier: { hp: 360, label: '장벽' } },                   // 부수면 질, 못부수면 수로 버팀
      { at: 5600,  mob: { count: 10, hp: 5, spread: 1.0 } },               // 수 유리: 떼
      { at: 6500,  gate: { left: { op: 'add', val: 12, label: '+12',   color: 0x4fa3ff },
                           right:{ op: 'pow', val: 1,  label: '무기+1', color: 0xff8a3d } } },
      { at: 7400,  armor: { hp: 420 } },                                    // 질 유리
      { at: 8300,  gate: { left: { op: 'mul', val: 2, label: '×2',    color: 0x4fa3ff },
                           right:{ op: 'pow', val: 2, label: '무기+2', color: 0xff8a3d } } }, // 애매②
      { at: 9300,  mob: { count: 14, hp: 6, spread: 1.0 } },               // 수 유리: 큰 떼
      { at: 10300, barrier: { hp: 520, label: '강벽' } },
      { at: 11200, gate: { left: { op: 'add', val: 20, label: '+20',   color: 0x4fa3ff },
                           right:{ op: 'pow', val: 3,  label: '무기+3', color: 0xff8a3d } } }  // 보스 직전
    ]
  };
})(window);
