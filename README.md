![말랑프렌즈 아케이드 배너](./games/jump-climber/assets/main%20banner.png)

# 말랑프렌즈 아케이드

로그인 없이 방 코드나 광장에서 바로 모여 즐기는 웹 미니게임 아케이드.  
주말에 AI 툴로 같이 미니게임 만들어볼 분 환영합니다.

![말랑프렌즈 광장](./docs/media/plaza.png)
<!-- TODO: 스크린샷 추가 -->

## 바로 플레이

[https://web-game-lab.powerstrong.workers.dev/](https://web-game-lab.powerstrong.workers.dev/)

## 게임 목록

| 게임 | 인원 | 방식 |
|------|------|------|
| [말랑프렌즈 점프](./docs/games/jump-climber.md) | 1~2명 | 로컬 동시 플레이 |
| [말랑프렌즈 퀴즈배틀](./docs/games/mallang-quiz-battle.md) | 2~6명 | 온라인 실시간 |
| [말랑프렌즈 쓱쓱](./docs/games/sseuk-sseuk.md) | 2~6명 | 온라인 실시간 |

## 기여하기

새 게임을 만들거나 버그를 고치고 싶다면:

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — 기여 흐름 한눈에 보기
- **[docs/ADD_GAME.md](./docs/ADD_GAME.md)** — 게임 추가 단계별 매뉴얼 (사람·AI 도구 모두 그대로 활용 가능)

`games/_template/` 복사 → 개발 → registry에 DRAFT 등록 → PR 흐름입니다.

## 기술 스택

순수 HTML/CSS/JavaScript (빌드 도구 없음) · Cloudflare Workers + Durable Objects · Cloudflare Pages 자동 배포

## 라이선스

코드: [MIT License](./LICENSE)  
말랑프렌즈 캐릭터·브랜드 에셋: [ASSET_POLICY.md](./ASSET_POLICY.md)
