/* 서버 권위형 게임 모듈 레지스트리.
 *
 * GameRoom DO 는 내장 게임(jump-climber/mallang-quiz-battle/sseuk-sseuk)을 거대 switch 로
 * 직접 처리한다. 그 외 "서버 권위형" 신규 게임은 여기에 모듈로 등록하면, 코어 switch 를
 * 건드리지 않고 join/message/leave 가 모듈로 라우팅된다(추가형 확장점).
 *
 * 새 서버 게임 추가:
 *   1) worker/src/games/<id>.js 에 모듈 작성 (interface 는 example_server_game.js 참고).
 *   2) 아래 SERVER_GAME_MODULES 에 등록.
 *   3) 클라이언트는 join_game {gameId} 후 {type:'mod', payload} 로 통신.
 * 서버 권위형 게임은 코어(worker/) 변경이라 관리자 리뷰 필수 — docs/SERVER_GAMES.md 참고.
 *
 * 주의: 예약 id(jump-climber / mallang-quiz-battle / sseuk-sseuk)는 등록 금지.
 */
import { exampleServerGame } from './games/example_server_game.js';
import { machineAnimalRunnerCoop } from './games/machine_animal_runner.js';
import { choiceHoldem } from './games/choice_holdem.js';

const RESERVED = new Set(['jump-climber', 'mallang-quiz-battle', 'sseuk-sseuk']);

const MODULES = [
  exampleServerGame,
  machineAnimalRunnerCoop,
  choiceHoldem,
];

export const SERVER_GAME_MODULES = new Map();
for (const mod of MODULES) {
  if (!mod || typeof mod.id !== 'string') continue;
  if (RESERVED.has(mod.id)) {
    throw new Error(`gameModules: 예약된 게임 id "${mod.id}" 는 모듈로 등록할 수 없습니다.`);
  }
  if (SERVER_GAME_MODULES.has(mod.id)) {
    throw new Error(`gameModules: 중복된 게임 id "${mod.id}" — 한 id 당 모듈 하나만 등록하세요.`);
  }
  SERVER_GAME_MODULES.set(mod.id, mod);
}
