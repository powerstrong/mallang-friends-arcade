# 매칭 시작 패턴: anyone-can-start 전환 계획

> 목표: host-only 권한 모델을 제거하고 READY seated 멤버 누구나 시작 가능.
> 서버 first-wins 락으로 race 차단. 카운트다운/veto/confirm 같은 흐름 끊는 장치는 없음.
>
> Codex + Gemini 합의 결과 (이 세션 directly above).

## 진행 체크리스트

### 1순위 — 서버 first-wins 락 + hostId 권한 제거 ★

파일: `worker/src/world.js`

- [ ] `_handleMatchStart` (line ~585) 수정:
  - [ ] `proposal.hostId !== attach.sessionId` 분기 **삭제** (NOT_HOST 에러 제거)
  - [ ] 요청자가 현재 seated 멤버인지 검증 (proposal.lastMemberIds 에 포함) — 아니면 `NOT_MEMBER` 에러
  - [ ] proposal 에 이미 `phase === 'launching'` 이면 silent ok (first-wins, 늦은 클릭은 그냥 무시 — match_starting 은 이미 받았으니 모달 잠겨있음)
  - [ ] seated 재계산 + min 검증 **이전에** `proposal.phase = 'launching'`, `proposal.startedBy = attach.sessionId` 세팅 (첫 await 전!)
  - [ ] min 미달 시 phase 되돌리고 MIN_PLAYERS 에러
- [ ] 새 메시지 `match_starting` 추가:
  - [ ] `_handleMatchStart` 가 phase='launching' 세팅 직후 **모든 seated 멤버에게** broadcast
  - [ ] payload: `{ matchId, startedBy: { id, name, characterId } }`
- [ ] `_syncProposalForZone` (line ~476):
  - [ ] `phase === 'launching'` 인 proposal 은 멤버 변경에 반응 안 함 (이미 발사 중)
  - [ ] proposal 생성 시 `hostId` 는 유지하되 의미를 "leader" (UI 표시용) 로 격하 — 코드 자체는 유지, 권한 검사만 제거
- [ ] `_launchProposal` (line ~685):
  - [ ] phase='launching' 이 아닌 proposal 은 무시 (방어)

### 2순위 — 클라 UI 변경

파일: `world/world.js`

- [ ] `refreshMatchActions` (line ~895):
  - [ ] `const isHost = ...` 제거
  - [ ] `matchAcceptBtn.style.display = isHost ? '' : 'none'` → 항상 노출
  - [ ] 상태 텍스트: "준비되면 누구나 시작할 수 있어요" (인원 충족 시)
- [ ] `sendMatchStart` (line ~919):
  - [ ] `if (!me || activeProposal.hostId !== me.id) return;` → seated 멤버 검사로 교체 (activeProposal.members 에 me.id 포함)
- [ ] `onMessage` switch (line ~553):
  - [ ] `case 'match_starting'` 추가 → `handleMatchStarting`
- [ ] `handleMatchStarting(d)` 신규:
  - [ ] activeProposal.matchId 일치 검증
  - [ ] `matchAcceptBtn.disabled = true`, `matchDeclineBtn.disabled = true`
  - [ ] matchStatus: `${startedBy.name}님이 시작합니다!`
  - [ ] (선택) 1초 트랜지션 — Gemini 권장. 지금은 텍스트만 해도 충분, go_to_game 도착하면 자동 이동
- [ ] `handleMatchProposal` / `handleMatchMembersUpdated`:
  - [ ] `hostId` → 그대로 받지만 UI 라벨용으로만 사용 (왕관 배지는 유지)
- [ ] `handleServerError` 에 `NOT_MEMBER` 케이스 추가 (혹시 stale UI 로 클릭한 경우)

### 3순위 — 테스트 추가

파일: `worker/tests/match-start.test.mjs` (신규)

- [ ] 동시 두 클릭 first-wins: 두 명이 같은 proposal 에 거의 동시 클릭 → 한 명만 launch, 다른 한 명은 silent ok
- [ ] 클릭 직전 멤버 이탈로 MIN_PLAYERS: 멤버가 ROAM 으로 바뀐 직후 host 가 클릭 → MIN_PLAYERS 에러, phase 복구
- [ ] launch 중 leave/move 영향 없음: phase='launching' 인 proposal 은 _syncProposalForZone 호출에 반응 안 함

> 참고: 현재 `worker/tests/` 는 matcher.test.mjs 위주. WorldChannel 클래스 인스턴스 + WebSocket mock 필요. 시간 부족하면 1, 2번만 단위 테스트로 작성하고 3번은 수동 검증.

### 4순위 — 배포

- [ ] sw.js CACHE 버전 bump
- [ ] commit + push to main (atomic 으로 1순위, 2순위, 3순위 분리 가능)
- [ ] Cloudflare 배포 후 새로고침으로 검증

## 코드 위치 빠른 참조

| 파일 | 라인 | 역할 |
|---|---|---|
| worker/src/world.js:585 | _handleMatchStart | 핵심 변경 지점 |
| worker/src/world.js:476 | _syncProposalForZone | hostId 의미 격하 |
| worker/src/world.js:516 | proposal 생성 | hostId 유지 (UI용) |
| worker/src/world.js:685 | _launchProposal | phase 검증 추가 |
| world/world.js:895 | refreshMatchActions | isHost 분기 제거 |
| world/world.js:919 | sendMatchStart | hostId 검사 → seated 검사 |
| world/world.js:553 | onMessage switch | match_starting 케이스 |
| world/world.js:963 | handleServerError | NOT_MEMBER 케이스 |

## 락 디자인 핵심 (Codex 경고)

```
async _handleMatchStart(ws, attach, d) {
  if (!attach.sessionId) return;
  const matchId = ...;
  if (!matchId) return this._sendError(ws, 'BAD_REQUEST', ...);
  const proposal = this.proposals.get(matchId);
  if (!proposal) return this._sendError(ws, 'NO_PROPOSAL', ...);

  // first-wins: 이미 발사 중이면 silent ok (늦은 클릭 무시)
  if (proposal.phase === 'launching') return;

  // 요청자가 현재 seated 멤버인지 검증
  if (!proposal.lastMemberIds.has(attach.sessionId)) {
    return this._sendError(ws, 'NOT_MEMBER', '매칭 멤버가 아닙니다.');
  }

  const zone = getZone(proposal.zoneId);
  if (!zone) return this._cancelProposal(proposal, 'invalid');

  // ★ 첫 await 전에 클레임 — 동시 클릭의 두 번째는 위에서 차단됨
  proposal.phase = 'launching';
  proposal.startedBy = attach.sessionId;

  // 모든 seated 멤버에게 즉시 잠금 broadcast
  this._broadcastMatchStarting(proposal, attach);

  // seated 재계산
  const ready = [...];
  ready.sort(compareReadyForSeat);
  const seatedIds = ready.slice(0, zone.maxPlayers).map(r => r.id);

  if (seatedIds.length < zone.minPlayers) {
    proposal.phase = null; // 락 해제
    proposal.startedBy = null;
    this._broadcastMatchUnstarting(proposal); // 잠금 풀라고 알림
    this._sendError(ws, 'MIN_PLAYERS', `최소 ${zone.minPlayers}명이 필요합니다.`);
    return;
  }

  proposal.players = seatedIds;
  await this._launchProposal(proposal);
}
```

`match_unstarting` 까지 두는 게 안전. 락은 잡았는데 min 미달이면 다른 멤버들 모달도 풀어줘야 함.

## 위험 포인트

1. **Phase=launching 인 proposal 이 hibernate 후 깨어나면?** — Codex 의 이전 지적과 연관. constructor 에서 proposal 재구성 안 함. 일단 phase 상태가 in-memory 라서 깨어나면 phase 도 사라짐. 다행히 깨어나는 순간은 어차피 새 client request 가 들어올 때이므로 self-healing 으로 처리 가능. 별도 작업.
2. **match_starting 받은 후 go_to_game 안 옴** — room launch 실패 케이스. match_unstarting 으로 잠금 풀고 에러 표시 필요.
3. **클라가 match_starting 받기 전 onClose 발생** — WS 끊김으로 onClose 가 모달 정리. 그 후 reconnect 시 zone_progress 다시 받으면 정상 복귀.

## 진행 상태 (실시간 업데이트)

- [ ] 1-1. _handleMatchStart 락 도입 + hostId 분기 제거
- [ ] 1-2. match_starting 브로드캐스트
- [ ] 1-3. match_unstarting (락 해제 알림)
- [ ] 1-4. _launchProposal 방어 추가
- [ ] 2-1. 클라 isHost 분기 제거
- [ ] 2-2. match_starting 핸들러
- [ ] 2-3. NOT_MEMBER 에러 처리
- [ ] 3. 테스트
- [ ] 4. SW bump + push
