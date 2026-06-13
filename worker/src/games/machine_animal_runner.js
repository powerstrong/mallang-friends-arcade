/* 말랑프렌즈 러너 — 2인 협동 서버 모듈 (M5, 서버 권위).
 *
 * 협동 설계(games/machine-animal-runner/DESIGN.md):
 *  - 같은 트랙 좌/우 레인 부대 2개. 각자 자기 부대를 로컬 시뮬레이션(게이트/떼/장벽)하고,
 *    서버는 "위조되면 안 되는 것"만 소유한다: 보스 HP·phase, 새장(부활) 소비, 하이파이브 판정,
 *    플레이어별 인정 amount/power(클램프), 이벤트 시퀀스.
 *  - 클라는 boss_damage 생값을 보낼 수 없다 — {amount, power, dt} 보고를 서버가
 *    스테이지별 최대 DPS 로 클램프해 적산한다(DESIGN codex P0).
 *  - 진행 동기화: 서버가 start ts 를 정하고 traveled = SCROLL × elapsed 로 양쪽이 같은
 *    시계를 쓴다(진행 드리프트 최소화). 보스 진입은 첫 유효 보고가 phase 를 올린다.
 *
 * 알려진 한계(v1 — DESIGN "알려진 구멍" 중 이연 항목):
 *  - DO 하이버네이션/재시작으로 in-memory 상태가 사라지면 'reset' 으로 응답하고
 *    클라가 재시작 안내를 띄운다(중간 복구 없음).
 *  - 중도 이탈 시 남은 한 명은 솔로로 계속(파트너 슬롯은 비움). 재접속 복귀는 미지원.
 *
 * 프로토콜(클라 → {type:'mod', payload:{a, ...}}):
 *  lobby/ready/gate/pos/boss_enter/dps/wipe/cage_hit  (아래 핸들러 참고)
 * 서버 → {type:'mod', event:...} 브로드캐스트/개별 응답.
 */

const SCROLL = 165;                  // px/s — 클라와 동일(진행 시계 공유)
const SHOOTER_CAP = 12;
const DMG_PER_SHOOTER = 7;
const MAX_DMG_MUL = 1.25;            // 민트 고양이(시크릿) ×1.25 가 정당한 최대 — 클라 characters.js 와 동기화
const HIGHFIVE_WINDOW_MS = 1500;     // 두 부대가 같은 게이트쌍을 "같은 타이밍"에 통과
const POS_REBROADCAST_MIN_MS = 150;  // 고스트 좌표 중계 다운샘플(≈6.7Hz 상한)
const CAGE_REVIVE_AMOUNT = 8;

/* 스테이지별 서버 권위 파라미터 — 클라 stages.js 와 일치해야 한다.
 * maxPower = 시작 1 + 해당 스테이지 pow 게이트 총합(정당하게 도달 가능한 상한). */
const STAGE_CAPS = {
  1: { bossHp: 900, maxPower: 10, bossAt: 12000 },
  2: { bossHp: 1500, maxPower: 10, bossAt: 12200 },
  3: { bossHp: 2000, maxPower: 11, bossAt: 12600 },
};

function now() { return Date.now(); }

/* ── 상태 영속 ───────────────────────────────────────────────────────────────
 * 하이버네이션 DO 는 ws 가 살아있어도 인스턴스가 재생성될 수 있다 → in-memory(ctx.state)만
 * 쓰면 게임 중 상태가 통째로 사라진다(로컬 dev 에서 즉시 재현). 그래서:
 *  - 읽기: in-memory 가 비어 있으면 storage 에서 복원(lazy)
 *  - 쓰기: 상태 변화 액션마다 persist(dps 는 1s 스로틀 — bossHp 1s 손실은 허용)
 *  - 종료 상태(win/lose)가 복원되면 새 게임으로 리셋(같은 코드 재사용 대비) */
const SKEY = 'marCoop:v1';

async function loadState(ctx) {
  const st = ctx.state;
  if (st.phase) return st;
  if (ctx.storage) {
    try {
      const saved = await ctx.storage.get(SKEY);
      if (saved && saved.phase) Object.assign(st, saved);
    } catch { /* storage 불가 시 in-memory 만으로 동작 */ }
  }
  return st;
}

async function persist(ctx, force) {
  const st = ctx.state;
  if (!ctx.storage || !st.phase) return;
  const t = now();
  if (!force && t - (st._lastPersist || 0) < 1000) return;
  st._lastPersist = t;
  const save = {};
  for (const k of Object.keys(st)) { if (k[0] !== '_') save[k] = st[k]; }
  // await — 마지막 이탈 delete 와 pending put 의 순서 역전(삭제된 게임 부활) 방지
  try { await ctx.storage.put(SKEY, save); } catch { /* storage 실패는 무시(다음 persist 가 복구) */ }
}

function initFreshState(st) {
  st.phase = 'lobby';
  st.stage = 1;
  st.players = {};
  st.seats = {};
  st.highfived = {};
  st.rejected = {};  // full 거절된 id — 자가치유로 좌석을 받지 못하게
  st.cage = null;
  st.bossHp = 0; st.bossMax = 0;
  st._lastHpSent = 0; st._lastPosFwd = {};
}

function clearState(st) {
  for (const k of Object.keys(st)) delete st[k];
}

function seatOf(ctx, id) {
  const st = ctx.state;
  if (st.seats?.L === id) return 'L';
  if (st.seats?.R === id) return 'R';
  return null;
}

function otherSeat(seat) { return seat === 'L' ? 'R' : 'L'; }

function playersBySeat(ctx) {
  const st = ctx.state;
  const out = {};
  for (const [id, p] of Object.entries(st.players || {})) out[p.seat] = { id, ...p };
  return out;
}

/* 게임 진행 중 상태가 없으면(하이버네이션 등) reset 신호 */
function ensureState(ctx, ws) {
  if (ctx.state.phase) return true;
  ctx.sendTo(ws, { type: 'mod', event: 'reset', reason: 'state-lost' });
  return false;
}

function broadcastLobby(ctx) {
  const st = ctx.state;
  ctx.broadcast({
    type: 'mod', event: 'lobby',
    stage: st.stage,
    seats: Object.fromEntries(
      Object.entries(st.players).map(([id, p]) => [p.seat, { id, name: p.name, ready: p.ready }])
    ),
  });
}

async function endGame(ctx, win) {
  ctx.state.phase = win ? 'win' : 'lose';
  ctx.broadcast({ type: 'mod', event: win ? 'win' : 'lose', bossHp: Math.max(0, Math.round(ctx.state.bossHp)) });
  await persist(ctx, true);
}

export const machineAnimalRunnerCoop = {
  id: 'machine-animal-runner',

  async onJoin(ctx, ws, _msg) {
    const st = await loadState(ctx);
    // 종료된 게임이 복원됐거나 첫 합류면 새 로비로
    if (!st.phase || st.phase === 'win' || st.phase === 'lose') initFreshState(st);
    const me = ws.deserializeAttachment();
    // 좌석 배정: L → R. 이미 차 있으면 관전 거절(v1 은 2인 고정).
    if (st.phase !== 'lobby' || Object.keys(st.players).length >= 2) {
      if (st.rejected) st.rejected[me.id] = true; // 자가치유 좌석 획득 차단
      ctx.sendTo(ws, { type: 'mod', event: 'full' });
      return;
    }
    const seat = st.seats.L ? 'R' : 'L';
    st.seats[seat] = me.id;
    st.players[me.id] = { seat, name: me.name, ready: false, amount: 5, power: 1, alive: true, lastGate: null };
    ctx.sendTo(ws, { type: 'mod', event: 'joined', you: me.id, seat, stage: st.stage });
    broadcastLobby(ctx);
    await persist(ctx, true);
  },

  async onMessage(ctx, ws, payload) {
    if (!payload || typeof payload !== 'object') return;
    const me = ws.deserializeAttachment();
    const st = await loadState(ctx);
    if (!ensureState(ctx, ws)) return;
    let p = st.players[me.id];
    // 자가치유: DO 메모리 초기화(하이버네이션/dev 리로드)로 in-memory 상태만 날아가면
    // ws 는 살아있는데 players 에서 사라진 "유령 세션"이 생긴다. 로비 단계에서 빈 좌석이
    // 있으면 다음 메시지에서 조용히 재등록한다(운영 중 끊김은 ensureState 의 reset 이 처리).
    if (!p && st.phase === 'lobby' && Object.keys(st.players).length < 2 &&
        !(st.rejected && st.rejected[me.id])) {
      const seat = st.seats.L ? 'R' : 'L';
      st.seats[seat] = me.id;
      p = st.players[me.id] = { seat, name: me.name, ready: false, amount: 5, power: 1, alive: true, lastGate: null };
      ctx.sendTo(ws, { type: 'mod', event: 'joined', you: me.id, seat, stage: st.stage });
      broadcastLobby(ctx);
    }
    if (!p) return; // 좌석 없는 연결(full 거절 등)의 메시지는 무시
    const a = payload.a;

    if (a === 'lobby' && st.phase === 'lobby') {
      // 호스트(L)가 스테이지 변경 가능
      const stage = payload.stage | 0;
      if (p.seat === 'L' && STAGE_CAPS[stage]) { st.stage = stage; broadcastLobby(ctx); await persist(ctx, true); }
      return;
    }

    if (a === 'ready' && st.phase === 'lobby') {
      p.ready = true;
      broadcastLobby(ctx);
      const ps = Object.values(st.players);
      if (ps.length === 2 && ps.every((q) => q.ready)) {
        const caps = STAGE_CAPS[st.stage];
        st.phase = 'run';
        st.startTs = now();
        st.bossHp = caps.bossHp; st.bossMax = caps.bossHp;
        st.cage = null; st.highfived = {};
        for (const q of Object.values(st.players)) { q.amount = 5; q.power = 1; q.alive = true; q.lastGate = null; }
        ctx.broadcast({ type: 'mod', event: 'start', ts: st.startTs, stage: st.stage, scroll: SCROLL });
      }
      await persist(ctx, true);
      return;
    }

    if (st.phase !== 'run' && st.phase !== 'boss') return; // 이하 액션은 진행 중에만

    if (a === 'gate') {
      // 게이트 통과 보고: 인정 amount/power 갱신(클램프) + 하이파이브 판정.
      const caps = STAGE_CAPS[st.stage];
      const seq = payload.seq | 0;
      // 같은/과거 seq 재보고 무시 — 리플레이 스팸·에코 루프·하이파이브 재시도 차단
      if (p.lastGate && seq <= p.lastGate.seq) return;
      p.amount = Math.max(0, Math.min(999, Number(payload.amount) || 0));
      p.power = Math.max(1, Math.min(caps.maxPower, Number(payload.power) || 1));
      p.lastGate = { seq, ts: now() };
      // 파트너가 같은 seq 게이트를 윈도 안에 통과했으면 하이파이브(쌍당 1회)
      const partnerSeat = otherSeat(p.seat);
      const partnerId = st.seats[partnerSeat];
      const partner = partnerId ? st.players[partnerId] : null;
      if (partner && partner.lastGate && partner.lastGate.seq === seq &&
          Math.abs(partner.lastGate.ts - p.lastGate.ts) <= HIGHFIVE_WINDOW_MS &&
          !st.highfived[seq]) {
        st.highfived[seq] = true;
        // 클라가 적용하는 보너스(+15%, 최소 +2)를 인정값에도 반영 — dps 권위와 어긋나지 않게
        for (const q of [p, partner]) {
          q.amount = Math.min(999, q.amount + Math.max(2, Math.round(q.amount * 0.15)));
        }
        ctx.broadcast({ type: 'mod', event: 'highfive', seq });
      }
      // 게이트 선택은 파트너 고스트 갱신용으로도 중계
      ctx.broadcast({ type: 'mod', event: 'gate', seat: p.seat, seq, amount: p.amount, power: p.power });
      await persist(ctx, true);
      return;
    }

    if (a === 'pos') {
      // 고스트 좌표 — 다운샘플해서 파트너에게만 중계(브로드캐스트 폭주 방지)
      const t = now();
      if (t - (st._lastPosFwd[p.seat] || 0) < POS_REBROADCAST_MIN_MS) return;
      st._lastPosFwd[p.seat] = t;
      ctx.broadcast({
        type: 'mod', event: 'pos', seat: p.seat,
        x: Math.max(0, Math.min(1, Number(payload.x) || 0.5)),
        amount: Math.max(0, Math.min(999, payload.amount | 0)),
        tier: Math.max(0, Math.min(2, payload.tier | 0)),
      });
      return;
    }

    if (a === 'boss_enter' && st.phase === 'run') {
      // 첫 유효 보고가 boss phase 를 올린다 — elapsed 가 그럴듯한지 검증(드리프트 ±3s 허용)
      const caps = STAGE_CAPS[st.stage];
      const expectMs = (caps.bossAt / SCROLL) * 1000;
      const elapsed = now() - st.startTs;
      if (elapsed < expectMs - 3000) return; // 너무 이른 보고는 위조/버그로 간주
      st.phase = 'boss';
      st.bossTs = now();
      ctx.broadcast({ type: 'mod', event: 'boss', hp: st.bossHp, max: st.bossMax, ts: st.bossTs });
      await persist(ctx, true);
      return;
    }

    if (a === 'dps' && st.phase === 'boss') {
      // 보스 피해 적산 — 보고값을 그대로 믿지 않고 "서버가 인정한"(게이트 보고로 갱신된)
      // amount/power 를 상한으로 쓴다(codex P0: 보고값만 클램프하면 스펙 위조 가능).
      // 실제 보유량은 드레인/피탄으로 인정값보다 낮을 수 있으므로 min(보고, 인정).
      if (!p.alive) return;
      const caps = STAGE_CAPS[st.stage];
      const dt = Math.max(0, Math.min(0.3, Number(payload.dt) || 0));
      const amount = Math.max(0, Math.min(p.amount, Number(payload.amount) || 0));
      const power = Math.max(1, Math.min(p.power, Math.min(caps.maxPower, Number(payload.power) || 1)));
      const dmg = Math.min(amount, SHOOTER_CAP) * power * DMG_PER_SHOOTER * MAX_DMG_MUL * dt;
      st.bossHp -= dmg;
      if (st.bossHp <= 0) { await endGame(ctx, true); return; }
      const t = now();
      if (t - st._lastHpSent > 250) { // HP 브로드캐스트 ≤4Hz
        st._lastHpSent = t;
        ctx.broadcast({ type: 'mod', event: 'hp', hp: Math.max(0, Math.round(st.bossHp)) });
      }
      await persist(ctx, false); // 1s 스로틀 — 하이버네이션 시 bossHp 최대 1s 손실 허용
      return;
    }

    if (a === 'wipe') {
      // 전멸 보고 → 파트너 생존 시 새장 드랍(구출 가능), 둘 다 죽으면 패배.
      if (!p.alive) return;
      p.alive = false;
      const partnerId = st.seats[otherSeat(p.seat)];
      const partner = partnerId ? st.players[partnerId] : null;
      if (partner && partner.alive) {
        st.cage = { seat: p.seat, x: Math.max(0, Math.min(1, Number(payload.x) || 0.5)), consumed: false };
        ctx.broadcast({ type: 'mod', event: 'cage', seat: p.seat, x: st.cage.x });
        await persist(ctx, true);
      } else {
        await endGame(ctx, false);
      }
      return;
    }

    if (a === 'cage_hit') {
      // 구출 — 소비는 서버가 1회만 인정(중복 사용 차단).
      if (!st.cage || st.cage.consumed) return;
      if (p.seat === st.cage.seat || !p.alive) return; // 본인 새장/죽은 자는 못 연다
      st.cage.consumed = true;
      const rescuedId = st.seats[st.cage.seat];
      const rescued = rescuedId ? st.players[rescuedId] : null;
      if (rescued) { rescued.alive = true; rescued.amount = CAGE_REVIVE_AMOUNT; }
      ctx.broadcast({ type: 'mod', event: 'revive', seat: st.cage.seat, amount: CAGE_REVIVE_AMOUNT });
      st.cage = null;
      await persist(ctx, true);
      return;
    }
  },

  async onLeave(ctx, player) {
    const st = await loadState(ctx);
    if (!st.phase || !st.players || !st.players[player.id]) return;
    const seat = st.players[player.id].seat;
    delete st.players[player.id];
    if (st.seats[seat] === player.id) delete st.seats[seat];
    // 모두 떠나면 영속+in-memory 모두 정리(같은 방/DO 재사용 시 유령 게임·full 잠김 방지)
    if (Object.keys(st.players).length === 0) {
      if (ctx.storage) { try { await ctx.storage.delete(SKEY); } catch { /* ignore */ } }
      clearState(st);
      return;
    }
    await persist(ctx, true);
    if (st.phase === 'lobby') { broadcastLobby(ctx); return; }
    // 진행 중 이탈: 남은 쪽은 솔로로 계속. 단, 남은 쪽이 새장에 갇혀 있으면
    // 구출자가 없으므로 영구 대기 대신 패배 처리(codex P1).
    ctx.broadcast({ type: 'mod', event: 'partner_left', seat });
    const remaining = Object.values(st.players)[0];
    if (remaining && !remaining.alive) await endGame(ctx, false);
  },
};
