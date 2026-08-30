/* 서버 권위형 게임 모듈 예시 — "선착순 버튼".
 *
 * 이 파일은 서버 권위형(server-authoritative) 게임을 모듈로 추가하는 방법의 레퍼런스다.
 * 게임 로직이 서버(이 모듈)에 있고, 클라이언트는 요청만 보낸다 — 그래서 클라가 결과를
 * 위조할 수 없다(릴레이와의 핵심 차이). 모듈은 GameRoom DO 의 거대 switch 를 건드리지 않고
 * gameModules.js 레지스트리에 등록되어 라우팅된다.
 *
 * 모듈 인터페이스:
 *   id: string                              // gameId (예약 id 금지: jump-climber/sseuk-sseuk)
 *   onJoin(ctx, ws, msg): void|Promise      // 참가자 합류
 *   onMessage(ctx, ws, payload): void|Promise // 클라가 보낸 {type:'mod', payload} 의 payload
 *   onLeave(ctx, player): void|Promise      // 참가자 이탈
 *
 * ctx (GameRoom 이 주입):
 *   ctx.gameId            : string
 *   ctx.state             : object          // 이 게임의 in-memory 상태(모듈이 자유롭게 사용)
 *   ctx.storage           : DO storage       // 영속 저장이 필요할 때
 *   ctx.sessions()        : [{ws, player}]   // 이 게임의 모듈 세션들
 *   ctx.roster()          : [{id, name}]
 *   ctx.broadcast(msg)    : 같은 게임 모든 세션에 전송
 *   ctx.sendTo(ws, msg)   : 특정 세션에만 전송
 *
 * 클라이언트 → 서버: { type: 'mod', payload: {...} }
 * 서버 → 클라이언트: ctx.broadcast / ctx.sendTo 가 보내는 임의 형태(관례상 { type:'mod', event, ... }).
 */
export const exampleServerGame = {
  id: 'example-first-button',

  onJoin(ctx, ws, msg) {
    if (ctx.state.winner === undefined) {
      ctx.state.winner = null;   // 아직 승자 없음
      ctx.state.armed = false;   // 라운드 시작(arm) 전
    }
    const me = ws.deserializeAttachment();
    ctx.sendTo(ws, { type: 'mod', event: 'joined', you: me.id, armed: ctx.state.armed, winner: ctx.state.winner });
    ctx.broadcast({ type: 'mod', event: 'roster', roster: ctx.roster() });
  },

  onMessage(ctx, ws, payload) {
    const me = ws.deserializeAttachment();
    const action = payload && payload.action;

    if (action === 'arm') {
      // 라운드 무장(누구나 시작 가능 — 데모 단순화). 서버가 상태를 소유한다.
      ctx.state.winner = null;
      ctx.state.armed = true;
      ctx.broadcast({ type: 'mod', event: 'armed' });
      return;
    }

    if (action === 'claim') {
      // 서버 권위: armed 상태에서 "가장 먼저 도착한" claim 만 승자. 클라가 위조 불가.
      if (ctx.state.armed && !ctx.state.winner) {
        ctx.state.winner = me.id;
        ctx.state.armed = false;
        ctx.broadcast({ type: 'mod', event: 'winner', winnerId: me.id, winnerName: me.name });
      }
    }
  },

  onLeave(ctx, _player) {
    ctx.broadcast({ type: 'mod', event: 'roster', roster: ctx.roster() });
  },
};
