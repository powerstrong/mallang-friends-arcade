#!/usr/bin/env node
// scripts/validate-games.js
// 의존성 0 — Node 내장 모듈(node:fs, node:path, node:vm)만 사용.
// 어디서 실행해도 동작: __dirname(=scripts/)의 부모를 저장소 루트로 계산.

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');

const ROOT         = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'games', 'registry.js');

// ── 허용 값 화이트리스트 ──────────────────────────────────────────────────────
const VALID_STATUS      = new Set(['PLAYABLE', 'DRAFT', 'REVIEW', 'HIDDEN', 'ARCHIVED']);
const VALID_VISIBILITY  = new Set(['PUBLIC', 'DIRECT_ONLY', 'HIDDEN']);
const VALID_REVIEW      = new Set(['NOT_SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED']);
const ID_PATTERN        = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ── registry.js 로드 (브라우저용 파일이라 가짜 window 컨텍스트에서 평가) ───────
let registry;
try {
  const src     = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 5000 });
  registry = sandbox.window.GAME_REGISTRY;
} catch (e) {
  console.error(`[오류] games/registry.js 로드 실패: ${e.message}`);
  process.exit(1);
}

// ── 검증 상태 추적 ────────────────────────────────────────────────────────────
let errors   = 0;
let warnings = 0;

function fail(msg) {
  console.error(`[실패] ${msg}`);
  errors++;
}

function warn(msg) {
  console.warn(`[경고] ${msg}`);
  warnings++;
}

// ── 검사 1: 배열이고 비어있지 않음 ───────────────────────────────────────────
if (!Array.isArray(registry) || registry.length === 0) {
  fail('GAME_REGISTRY 가 비어 있거나 배열이 아닙니다.');
  process.exit(1);
}

// ── 검사 2: id 중복 없음 ──────────────────────────────────────────────────────
const seenIds = new Set();
for (const game of registry) {
  if (seenIds.has(game.id)) {
    fail(`id 중복 발견: "${game.id}"`);
  }
  seenIds.add(game.id);
}

for (const game of registry) {
  const tag = `게임 "${game.id}"`;

  // 검사 2b: UI 필수 메타데이터 (비어 있으면 목록/결과 화면이 깨짐)
  for (const field of ['title', 'description', 'type']) {
    if (typeof game[field] !== 'string' || game[field].trim() === '') {
      fail(`${tag}: 필수 필드 "${field}" 가 비어 있거나 문자열이 아닙니다.`);
    }
  }

  // 검사 3: id 형식
  if (!game.id || !ID_PATTERN.test(game.id)) {
    fail(`${tag}: id 형식이 올바르지 않습니다 (허용: ^[a-z0-9]+(-[a-z0-9]+)*$). 실제값: "${game.id}"`);
  }

  // 검사 4: path 형식
  const expectedPath = `/games/${game.id}/index.html`;
  if (game.path !== expectedPath) {
    fail(`${tag}: path 가 "${expectedPath}" 이어야 하는데 "${game.path}" 입니다.`);
  }

  // 검사 5: index.html 파일이 디스크에 실제 존재
  const absPath = path.join(ROOT, 'games', game.id, 'index.html');
  if (!fs.existsSync(absPath)) {
    fail(`${tag}: index.html 파일이 존재하지 않습니다 (확인 경로: ${absPath})`);
  }

  // 검사 6: status / visibility / reviewState 화이트리스트
  if (!VALID_STATUS.has(game.status)) {
    fail(`${tag}: status 값이 올바르지 않습니다. 허용: ${[...VALID_STATUS].join(', ')}. 실제값: "${game.status}"`);
  }
  if (!VALID_VISIBILITY.has(game.visibility)) {
    fail(`${tag}: visibility 값이 올바르지 않습니다. 허용: ${[...VALID_VISIBILITY].join(', ')}. 실제값: "${game.visibility}"`);
  }
  if (!VALID_REVIEW.has(game.reviewState)) {
    fail(`${tag}: reviewState 값이 올바르지 않습니다. 허용: ${[...VALID_REVIEW].join(', ')}. 실제값: "${game.reviewState}"`);
  }

  // 검사 7: PLAYABLE → PUBLIC + APPROVED 필수
  if (game.status === 'PLAYABLE') {
    if (game.visibility !== 'PUBLIC') {
      fail(`${tag}: status=PLAYABLE 이면 visibility=PUBLIC 이어야 합니다. 실제값: "${game.visibility}"`);
    }
    if (game.reviewState !== 'APPROVED') {
      fail(`${tag}: status=PLAYABLE 이면 reviewState=APPROVED 이어야 합니다. 실제값: "${game.reviewState}"`);
    }
  }

  // 검사 7b: PUBLIC 노출은 승인된 PLAYABLE 게임만 (DRAFT/REVIEW 가 PUBLIC+APPROVED로 위장 통과하는 것 차단)
  if (game.visibility === 'PUBLIC' && (game.status !== 'PLAYABLE' || game.reviewState !== 'APPROVED')) {
    fail(`${tag}: visibility=PUBLIC 은 status=PLAYABLE && reviewState=APPROVED 일 때만 허용됩니다. (현재 status=${game.status}, reviewState=${game.reviewState})`);
  }

  // 검사 8: DRAFT → DIRECT_ONLY 권장 (경고)
  if (game.status === 'DRAFT' && game.visibility !== 'DIRECT_ONLY') {
    warn(`${tag}: status=DRAFT 일 때는 visibility=DIRECT_ONLY 를 권장합니다. 실제값: "${game.visibility}"`);
  }

  // 검사 9: '/prototypes/' 경로 없음
  if (typeof game.path === 'string' && game.path.includes('/prototypes/')) {
    fail(`${tag}: path 에 '/prototypes/' 가 포함되어 있습니다. 올바른 경로로 수정해 주세요.`);
  }
}

// 검사 10: '_template' 은 registry에 등록 금지
if (registry.some(g => g.id === '_template')) {
  fail('게임 id "_template" 은 registry에 등록할 수 없습니다. (템플릿 전용 폴더)');
}

// ── 결과 출력 ─────────────────────────────────────────────────────────────────
if (errors > 0) {
  console.error(`\n검증 실패: 오류 ${errors}개${warnings > 0 ? `, 경고 ${warnings}개` : ''}`);
  process.exit(1);
}

const warningNote = warnings > 0 ? ` (경고 ${warnings}개)` : '';
console.log(`✓ registry 검증 통과 (게임 ${registry.length}개)${warningNote}`);
process.exit(0);
