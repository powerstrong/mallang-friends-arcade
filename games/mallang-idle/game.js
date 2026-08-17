/*
 * 말랑프렌즈 키우기 — 게임 화면
 *
 * 이 파일은 "렌더와 입력"만 담당한다. 전투·성장·오프라인 계산은 전부
 * engine/combat.js 에 있고, 시뮬레이터가 같은 엔진을 쓴다. 여기에 전투 로직을
 * 다시 구현하면 지표가 거짓말을 하게 되므로 절대 복제하지 않는다.
 */
(function () {
  'use strict';

  var Combat = window.MallangIdleCombat;
  var Save = window.MallangIdleSave;
  var Chapters = window.MallangIdleChapters;
  var Chars = window.MallangIdleCharacters;
  var Bal = window.MallangIdleBalance;
  var Dungeon = window.MallangIdleDungeon;
  var Quests = window.MallangIdleQuests;
  var Story = window.MallangIdleStory;
  var Audio = window.MallangIdleAudio;

  function sfx(name) { if (Audio) Audio.play(name); }

  /* BGM 무드 = 현재 페이즈(보스) 우선, 아니면 챕터. core 는 machine 트랙을 잇는다. */
  var BGM_BY_CHAPTER = {
    meadow: 'meadow', gears: 'gears', machine: 'machine', core: 'machine',
    garden: 'garden', starsea: 'starsea', moonfactory: 'moonfactory',
  };
  function syncBgm() {
    if (!Audio || !gameStarted) return;
    var mood = state.phase === Combat.PHASE_BOSS
      ? 'boss'
      : BGM_BY_CHAPTER[Chapters.chapterFor(state.stage).id] || null;
    Audio.bgm(mood);
  }
  var B = Bal.BALANCE;
  var AXES = Bal.AXES;

  var params = new URLSearchParams(location.search);
  var DEV = params.get('dev') === '1';

  var state = Combat.createState();
  var bulk = 1;              // 1 | 10 | 'max'
  var speedMul = 1;          // DEV 전용 배속
  var lastFrame = 0;
  var saveTimer = 0;

  // ── DOM ─────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    app: $('app'), arena: $('arena'), bgLayer: $('bgLayer'),
    stageNum: $('stageNum'), chapterName: $('chapterName'),
    goldNum: $('goldNum'), powerNum: $('powerNum'),
    progressText: $('progressText'), progressPips: $('progressPips'),
    bossTimer: $('bossTimer'), bossTimerFill: $('bossTimerFill'), bossTimerNum: $('bossTimerNum'),
    hero: $('hero'), enemy: $('enemy'), enemyArt: $('enemyArt'),
    enemyName: $('enemyName'), enemyHpFill: $('enemyHpFill'), bossRing: $('bossRing'),
    upgrades: $('upgrades'), bulkToggle: $('bulkToggle'),
    stageProgress: $('stageProgress'), dpsHint: $('dpsHint'), exitBtn: $('exitBtn'),
    follower1: $('follower1'), follower2: $('follower2'), fxLayer: $('fxLayer'), bossNeed: $('bossNeed'),
    fgLayer: $('fgLayer'), ambientLayer: $('ambientLayer'), speedLines: $('speedLines'),
    cloudLayer: $('cloudLayer'), farLayer: $('farLayer'),
    storyOverlay: $('storyOverlay'), storyCard: $('storyCard'), storyPortrait: $('storyPortrait'),
    storyName: $('storyName'), storyText: $('storyText'), storySkip: $('storySkip'),
    bossBubble: $('bossBubble'), chapterBanner: $('chapterBanner'),
    chapterBannerName: $('chapterBannerName'), chapterBannerTag: $('chapterBannerTag'),
    field: document.querySelector('.field'), intro: $('intro'), introStart: $('introStart'),
    cam: $('stageCam'), fxCanvas: $('fxCanvas'),
    tabs: $('tabs'), panelUpgrade: $('panelUpgrade'), panelParty: $('panelParty'),
    partyList: $('partyList'), partySlots: $('partySlots'), partyDot: $('partyDot'),
    partyBonusHint: $('partyBonusHint'), exitBtn2: $('exitBtn2'),
    panelRelic: $('panelRelic'), relicList: $('relicList'), relicDot: $('relicDot'),
    shardNum: $('shardNum'), exitBtn3: $('exitBtn3'),
    panelBattle: $('panelBattle'), battleDot: $('battleDot'), questList: $('questList'),
    dungeonRuns: $('dungeonRuns'), dungeonBest: $('dungeonBest'), dungeonGo: $('dungeonGo'),
    dungeonPreview: $('dungeonPreview'),
    dungeonModal: $('dungeonModal'), dungeonSub: $('dungeonSub'), dungeonKills: $('dungeonKills'),
    dungeonShards: $('dungeonShards'), dungeonGold: $('dungeonGold'), dungeonOk: $('dungeonOk'),
    exitBtn4: $('exitBtn4'),
    panelBook: $('panelBook'), bookGrid: $('bookGrid'), bookCount: $('bookCount'),
    bookHint: $('bookHint'), exitBtn5: $('exitBtn5'),
    muteBtn: $('muteBtn'),
    toastStack: $('toastStack'),
    offlineModal: $('offlineModal'), offlineGold: $('offlineGold'),
    offlineSub: $('offlineSub'), offlineOk: $('offlineOk'), offlineHint: $('offlineHint'),
    tabModal: $('tabModal'), tabReload: $('tabReload'), tabResume: $('tabResume'),
    partyHint: $('partyHint'),
    devPanel: $('devPanel'),
  };

  // ── 숫자 표기 ────────────────────────────────────────────────
  // 표기는 UI 계층의 일이다. 엔진은 계속 Number 로만 계산한다.
  var UNITS = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae', 'af'];
  /* fmt 는 아래에서 정의되지만 Stage 생성 시점에는 함수 선언 호이스팅으로 이미 유효하다. */
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 1000) return String(Math.floor(n));
    var u = 0;
    while (n >= 1000 && u < UNITS.length - 1) { n /= 1000; u++; }
    return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + UNITS[u];
  }
  function fmtDuration(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + '시간 ' + m + '분';
    if (m > 0) return m + '분';
    return Math.floor(sec) + '초';
  }

  /* ── 무대 ────────────────────────────────────────────────────
   * 아레나 안쪽(배경·액터·적·이펙트·카메라·파티클)은 전부 이 모듈이 소유한다.
   * game.js 는 엔진을 굴리고 사건을 넘길 뿐, 전투 화면을 직접 그리지 않는다. */
  var Stage = window.MallangIdleStage.create({
    el: el,
    Chapters: Chapters, Chars: Chars, Combat: Combat, balance: B,
    Queue: window.MallangIdleQueue,
    sfx: sfx, fmt: fmt,
  });

  // ── 모바일 뷰포트 높이 ───────────────────────────────────────
  // 일부 모바일 브라우저가 100dvh 를 하단 툴바 제외 없이 계산해 하단 UI 가 가려진다.
  function syncAppHeight() {
    document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
  }
  window.addEventListener('resize', syncAppHeight);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncAppHeight);
  syncAppHeight();

  // ── 강화 버튼 ────────────────────────────────────────────────
  var upNodes = {};
  function buildUpgrades() {
    el.upgrades.innerHTML = '';
    AXES.forEach(function (axis) {
      var btn = document.createElement('button');
      btn.className = 'up-btn';
      btn.innerHTML =
        '<img class="up-icon" src="' + axis.icon + '" alt="" />' +
        '<div><div class="up-name">' + axis.name + ' <span class="up-lv"></span></div>' +
        '<div class="up-eff"></div></div>' +
        '<div><div class="up-cost"><i class="coin"></i><span></span></div>' +
        '<div class="up-cnt"></div></div>';
      btn.addEventListener('click', function () { onBuy(axis.id); });
      el.upgrades.appendChild(btn);
      upNodes[axis.id] = {
        btn: btn,
        lv: btn.querySelector('.up-lv'),
        eff: btn.querySelector('.up-eff'),
        cost: btn.querySelector('.up-cost span'),
        cnt: btn.querySelector('.up-cnt'),
      };
    });
  }

  function plannedCount(axisId) {
    if (bulk === 'max') return Combat.affordable(state, axisId, null);
    return bulk;
  }

  /* ── 튜토리얼 코치마크 ────────────────────────────────────────
   * 글로 가르치지 않는다. 첫 강화가 가능해지는 순간 그 버튼 위에 손가락을 띄우고,
   * 실제로 누르면 끝. 이 한 번의 탭이 인트로 문단 세 줄보다 많은 것을 가르친다. */
  var TUT_KEY = Save.STORAGE_KEY + '-tut';
  var tutDone = false;
  try { tutDone = localStorage.getItem(TUT_KEY) === '1'; } catch (e) {}
  var coachEl = null;

  function showCoach(target) {
    if (coachEl) return;
    coachEl = document.createElement('div');
    coachEl.className = 'coach';
    coachEl.textContent = '👆';
    target.style.position = 'relative';
    target.appendChild(coachEl);
  }

  function finishTutorial() {
    if (tutDone) return;
    tutDone = true;
    try { localStorage.setItem(TUT_KEY, '1'); } catch (e) {}
    if (coachEl) { coachEl.remove(); coachEl = null; }
  }

  function syncCoach() {
    if (tutDone || state.stats.upgrades > 0) { finishTutorial(); return; }
    for (var i = 0; i < AXES.length; i++) {
      var n = upNodes[AXES[i].id];
      if (n && !n.btn.disabled) { showCoach(n.btn); return; }
    }
    if (coachEl) { coachEl.remove(); coachEl = null; }
  }

  /* 실효 공속이 상한에 닿았는가 — 편성 보너스(피치) 포함. 상한 이후의 ASPD 레벨은
   * 효과가 없으므로 구매를 막는다(codex 리뷰 #4: MAX 가 골드를 허공에 태우던 문제). */
  function aspdMaxed() { return Combat.effAspd(state) >= B.aspdCap - 1e-9; }

  function onBuy(axisId) {
    if (axisId === 'aspd' && aspdMaxed()) return;
    var n = plannedCount(axisId);
    if (n <= 0) return;
    var got = Combat.buy(state, axisId, n);
    if (got > 0) { sfx('upgrade'); finishTutorial(); renderPanel(); renderBattle(); }
  }

  function effectText(axisId) {
    if (axisId === 'atk')  return '공격력 ' + fmt(Combat.atk(state.up.atk));
    if (axisId === 'aspd') {
      // 표시도 실효값(편성 포함) — 표시는 5.0 미만인데 실제는 최대인 불일치를 없앤다
      var a = Combat.effAspd(state);
      return '초당 ' + a.toFixed(2) + '회' + (aspdMaxed() ? ' (최대)' : '');
    }
    return '골드 x' + Combat.goldMul(state.up.gold).toFixed(2);
  }

  // ── 편성 ────────────────────────────────────────────────────
  var seenUnlocks = {};       // 새 친구 해금 뱃지를 한 번만 띄우기 위한 표시
  var partyDirty = true;

  function toggleMember(id) {
    var slots = Chars.slotsFor(state.stage);
    var idx = state.party.indexOf(id);
    if (idx >= 0) {
      if (state.party.length <= 1) { toast('최소 한 명은 있어야 해요'); return; }
      state.party.splice(idx, 1);
    } else {
      if (state.party.length >= slots) {
        // 슬롯이 꽉 찼으면 가장 오래된 자리를 비운다 — 탭 한 번으로 교체되게.
        var outc = Chars.byId(state.party.shift());
        var inc = Chars.byId(id);
        if (outc && inc) toast(outc.name + ' → ' + inc.name + ' 교체');
      }
      state.party.push(id);
    }
    Combat.sanitizeParty(state);
    partyDirty = true;
    renderParty();
    renderPanel();
    persist();
  }

  function renderParty() {
    if (!partyDirty) return;
    partyDirty = false;

    var slots = Chars.slotsFor(state.stage);
    var unlocked = Chars.unlockedAt(state.stage);
    el.partySlots.textContent = state.party.length + ' / ' + slots;

    /* "한 명만 나오는 건가?"라는 오해를 막는다 — 편성 전원이 필드에 함께 서고,
     * 자리는 진행으로 늘어난다는 사실을 패널에서 바로 보여준다. */
    var nextSlotStage = null;
    for (var s = 0; s < Chars.SLOT_UNLOCKS.length; s++) {
      if (state.stage < Chars.SLOT_UNLOCKS[s]) { nextSlotStage = Chars.SLOT_UNLOCKS[s]; break; }
    }
    /* 다음 해금 예고(codex 리뷰 #2) — 복귀 목표가 항상 보이게 한다 */
    var nextChar = null;
    for (var c = 0; c < Chars.CHARACTERS.length; c++) {
      if (state.stage < Chars.CHARACTERS[c].unlockStage) { nextChar = Chars.CHARACTERS[c]; break; }
    }
    var hints = [nextSlotStage ? '최대 3명 함께 싸워요 · 다음 자리 스테이지 ' + nextSlotStage : '편성 전원이 함께 싸워요'];
    if (nextChar) hints.push('다음 친구는 스테이지 ' + nextChar.unlockStage + '에서 기다려요');
    el.partyHint.textContent = hints.join(' · ');

    el.partyList.innerHTML = '';
    Chars.CHARACTERS.forEach(function (c) {
      var isUnlocked = unlocked.indexOf(c.id) !== -1;
      var inParty = state.party.indexOf(c.id) !== -1;

      var card = document.createElement('button');
      card.className = 'party-card' + (inParty ? ' on' : '') + (isUnlocked ? '' : ' locked');
      card.disabled = !isUnlocked;
      card.innerHTML =
        '<img src="' + c.portrait + '" alt="" />' +
        '<div class="pc-body">' +
          '<div class="pc-name">' + c.name + (inParty ? ' <span class="pc-in">편성</span>' : '') + '</div>' +
          '<div class="pc-skill">' + (isUnlocked ? c.skillText : '스테이지 ' + c.unlockStage + ' 에서 만나요') + '</div>' +
          '<div class="pc-desc">' + (isUnlocked ? c.desc : '') + '</div>' +
        '</div>';
      if (isUnlocked) card.addEventListener('click', function () { toggleMember(c.id); });
      el.partyList.appendChild(card);
    });

    var pb = Combat.partyBonus(state);
    var parts = [];
    if (pb.atkMul)     parts.push('공격 +' + Math.round(pb.atkMul * 100) + '%');
    if (pb.aspdMul)    parts.push('속도 +' + Math.round(pb.aspdMul * 100) + '%');
    if (pb.goldMul)    parts.push('골드 +' + Math.round(pb.goldMul * 100) + '%');
    if (pb.bossMul)    parts.push('보스 +' + Math.round(pb.bossMul * 100) + '%');
    if (pb.advanceMul) parts.push('이동 -' + Math.round(pb.advanceMul * 100) + '%');
    if (pb.shardMul)   parts.push('별조각 +' + Math.round(pb.shardMul * 100) + '%');
    el.partyBonusHint.textContent = parts.join(' · ') || '보너스 없음';
  }

  /* 새 친구가 해금되거나 슬롯이 열리면 편성 탭에 점을 찍어 알린다. */
  function checkUnlocks() {
    var unlocked = Chars.unlockedAt(state.stage);
    var news = false;
    for (var i = 0; i < unlocked.length; i++) {
      if (!seenUnlocks[unlocked[i]]) {
        seenUnlocks[unlocked[i]] = true;
        var c = Chars.byId(unlocked[i]);
        if (state.t > 1 && c) {
          toast(c.name + ' 합류!', 'win');
          sfx('unlock');
          news = true;
          queueStory('join', c.id);
        }
      }
    }
    if (news) { el.partyDot.hidden = false; partyDirty = true; }
  }

  // ── 유물 ────────────────────────────────────────────────────
  var relicNodes = {};

  function buildRelics() {
    el.relicList.innerHTML = '';
    Bal.RELIC_AXES.forEach(function (r) {
      var btn = document.createElement('button');
      btn.className = 'up-btn';
      btn.innerHTML =
        '<img class="up-icon" src="' + r.icon + '" alt="" />' +
        '<div><div class="up-name">' + r.name + ' <span class="up-lv"></span></div>' +
        '<div class="up-eff"></div></div>' +
        '<div><div class="up-cost shard">⭐<span></span></div></div>';
      btn.addEventListener('click', function () {
        if (Combat.buyRelic(state, r.id)) { sfx('relic'); renderRelics(); renderPanel(); persist(); }
      });
      el.relicList.appendChild(btn);
      relicNodes[r.id] = {
        btn: btn,
        lv: btn.querySelector('.up-lv'),
        eff: btn.querySelector('.up-eff'),
        cost: btn.querySelector('.up-cost span'),
      };
    });
  }

  function renderRelics() {
    el.shardNum.textContent = fmt(state.shards);
    var anyAffordable = false;
    Bal.RELIC_AXES.forEach(function (r) {
      var n = relicNodes[r.id];
      var lv = Combat.relicLv(state, r.id);
      var cost = Combat.relicCost(state, r.id);
      var can = state.shards >= cost;
      if (can) anyAffordable = true;
      n.lv.textContent = 'Lv.' + lv;
      n.eff.textContent = r.bonusText + ' ×' + Combat.relicMul(state, r.id).toFixed(2);
      n.cost.textContent = fmt(cost);
      n.btn.disabled = !can;
      n.btn.classList.toggle('can', can);
    });
    // 유물 탭이 닫혀 있을 때 살 수 있는 게 생기면 점으로 알린다.
    if (anyAffordable && el.panelRelic.hidden) el.relicDot.hidden = false;
  }

  // ── 일일 리셋 · 던전 · 과제 (P4) ─────────────────────────────
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /* 날짜가 바뀌었으면 과제·던전을 새로 깐다. 프레임마다 불러도 싸다. */
  function syncDaily() {
    var today = todayStr();
    if (!state.daily || state.daily.date !== today) {
      state.daily = Quests.freshDaily(today, state.stats);
      renderBattle();
    }
    if (!state.dungeon || state.dungeon.date !== today) {
      state.dungeon = { date: today, runs: 0, best: (state.dungeon && state.dungeon.best) || 0 };
      renderBattle();
    }
  }

  var questNodes = {};
  function buildQuests() {
    el.questList.innerHTML = '';
    Quests.QUESTS.forEach(function (q) {
      var row = document.createElement('div');
      row.className = 'quest-row';
      row.innerHTML =
        '<span class="quest-emoji">' + q.emoji + '</span>' +
        '<div class="quest-body"><div class="quest-name">' + q.name +
        ' <span class="quest-prog"></span></div>' +
        '<div class="quest-bar"><i></i></div></div>' +
        '<button class="quest-claim">⭐ ' + Quests.rewardOf(q) + '</button>';
      var btn = row.querySelector('.quest-claim');
      btn.addEventListener('click', function () {
        syncDaily();   // 자정 직후 전날 과제를 수령하는 틈을 막는다
        var got = Quests.claim(q, state, state.daily);
        if (got > 0) {
          sfx('relic');
          toast('⭐ +' + got, 'win');
          renderBattle(); renderRelics(); persist();
        }
      });
      el.questList.appendChild(row);
      questNodes[q.id] = {
        prog: row.querySelector('.quest-prog'),
        bar: row.querySelector('.quest-bar i'),
        btn: btn,
      };
    });
  }

  /* 던전 사전 정보(6차 백로그) — 결과가 결정론이므로 "예상"은 곧 정답이다.
   * 들어가기 전에 기준층과 보상 규모를 보여 주면 "지금 갈까, 더 크고 갈까"가
   * 진짜 선택이 된다. simulate 는 싸지만 프레임마다 돌릴 이유는 없어 메모한다. */
  var dgPrevKey = '', dgPrevText = '';
  function dungeonPreviewText() {
    var key = state.safeStage + '|' + Math.round(Combat.bossDps(state));
    if (key !== dgPrevKey) {
      var r = Dungeon.simulate(state);
      dgPrevKey = key;
      dgPrevText = r.baseStage + '층 기준 · 예상 ' + r.kills + '연승 ⭐' + fmt(r.shards);
    }
    return dgPrevText;
  }

  function renderBattle() {
    if (!state.daily || !state.dungeon) return;
    var locked = state.stage < B.dungeonUnlockStage;
    var card = el.dungeonGo.closest('.dungeon-card');
    if (card) card.classList.toggle('locked', locked);
    if (locked) {
      el.dungeonRuns.textContent = '스테이지 ' + B.dungeonUnlockStage + ' 도달 시 열려요';
      el.dungeonBest.textContent = state.dungeon.best;
      el.dungeonGo.disabled = true;
      el.dungeonGo.textContent = '잠김';
      el.dungeonPreview.hidden = true;
      return renderQuests();
    }
    var left = B.dungeonRunsPerDay - state.dungeon.runs;
    el.dungeonRuns.textContent = '오늘 ' + Math.max(0, left) + '회 남음';
    el.dungeonBest.textContent = state.dungeon.best;
    el.dungeonGo.disabled = left <= 0;
    el.dungeonGo.textContent = left > 0 ? '입장' : '내일 다시';
    el.dungeonPreview.hidden = left <= 0;
    if (left > 0) el.dungeonPreview.textContent = dungeonPreviewText();
    renderQuests();
  }

  function renderQuests() {

    var claimable = 0;
    Quests.QUESTS.forEach(function (q) {
      var n = questNodes[q.id];
      var prog = Quests.progressOf(q, state.stats, state.daily);
      var target = Quests.targetOf(q);
      var done = Quests.isDone(q, state.stats, state.daily);
      var claimed = Quests.isClaimed(q, state.daily);
      n.prog.textContent = Math.min(prog, target) + ' / ' + target;
      n.bar.style.width = Math.min(100, prog / target * 100) + '%';
      n.btn.disabled = !done || claimed;
      n.btn.textContent = claimed ? '완료' : '⭐ ' + Quests.rewardOf(q);
      n.btn.classList.toggle('claimed', claimed);
      if (done && !claimed) claimable++;
    });
    if (claimable > 0 && el.panelBattle.hidden) el.battleDot.hidden = false;
  }

  /* 던전 — 결과는 즉시 결정론으로 계산하고, 화면은 결과 팝업으로 보여준다.
   * (조작이 없는 자동 전투이므로 "달리는 척"은 시간 낭비다 — 장르 표준.) */
  function runDungeon() {
    if (!el.dungeonModal.hidden) return;   // 결과 확인 전 재진입 방지
    syncDaily();
    if (state.stage < B.dungeonUnlockStage) return;   // 해금 전 — 초반 경제 우회 차단
    if (state.dungeon.runs >= B.dungeonRunsPerDay) return;
    state.dungeon.runs++;
    var result = Dungeon.simulate(state);
    Dungeon.applyReward(state, result);
    if (result.kills > state.dungeon.best) state.dungeon.best = result.kills;
    sfx('dungeon');
    el.dungeonSub.textContent = result.baseStage + '층 기준 연속 격파';
    el.dungeonKills.textContent = result.kills + '연승!';
    el.dungeonShards.textContent = fmt(result.shards);
    el.dungeonGold.textContent = fmt(result.gold);
    el.dungeonModal.hidden = false;
    renderBattle(); renderRelics(); renderPanel(); persist();
  }

  // ── 도감 (P4) ────────────────────────────────────────────────
  var bookDirty = true;
  var collectionSet = {};

  function allBookEntries() {
    var out = [];
    var seenIds = {};
    Chapters.CHAPTERS.forEach(function (ch) {
      ch.mobs.forEach(function (m) {
        var key = ch.id + ':' + m.id;
        if (!seenIds[key]) { seenIds[key] = 1; out.push({ key: key, name: m.name, art: m.art, chapter: ch.name }); }
      });
      var bkey = ch.id + ':boss:' + ch.boss.id;
      out.push({ key: bkey, name: ch.boss.name, art: ch.boss.art, chapter: ch.name, boss: true });
    });
    return out;
  }
  var BOOK_ENTRIES = null;

  function recordSeen(key) {
    if (collectionSet[key]) return;
    collectionSet[key] = true;
    state.collection.push(key);
    bookDirty = true;
  }

  function renderBook() {
    if (!bookDirty) return;
    bookDirty = false;
    if (!BOOK_ENTRIES) BOOK_ENTRIES = allBookEntries();
    var seen = 0;
    el.bookGrid.innerHTML = '';
    BOOK_ENTRIES.forEach(function (e) {
      var got = !!collectionSet[e.key];
      if (got) seen++;
      var cell = document.createElement('div');
      cell.className = 'book-cell' + (got ? '' : ' unseen') + (e.boss ? ' boss' : '');
      cell.innerHTML = '<img src="' + e.art + '" alt="" loading="lazy" />' +
        '<span>' + (got ? e.name : '???') + '</span>';
      el.bookGrid.appendChild(cell);
    });
    el.bookCount.textContent = seen + ' / ' + BOOK_ENTRIES.length;
    el.bookHint.textContent = seen >= BOOK_ENTRIES.length ? '모두 만났어요!' : '새 친구는 다음 챕터에';
  }

  // ── 스토리 — 짧고, 스킵 가능하고, 진행을 오래 막지 않는다 ─────
  /* 컷신이 떠 있는 동안 게임 시간이 멈춘다(storyActive → 프레임 루프 게이트).
   * 본 장면은 storySeen 에 기록되어 다시 나오지 않는다. */
  var storyActive = false;
  var storyQueue = [];
  var storyScene = null, storyLine = 0;

  function seenStory(id) { return state.storySeen.indexOf(id) !== -1; }
  function markStory(id) {
    if (!seenStory(id)) { state.storySeen.push(id); persist(); }
  }

  function queueStory(type, key) {
    if (!Story) return;
    var scene = Story.sceneFor(type, key);
    if (!scene || seenStory(scene.id)) return;
    // 큐에 이미 있으면 중복 금지
    for (var i = 0; i < storyQueue.length; i++) if (storyQueue[i].id === scene.id) return;
    storyQueue.push(scene);
    if (!storyActive) nextSceneFromQueue();
  }

  function nextSceneFromQueue() {
    var scene = storyQueue.shift();
    // 대기 중 이미 본 장면(중복 큐잉 등)은 건너뛴다 — 오프닝이 두 번 나오는 사고 방지
    while (scene && seenStory(scene.id)) scene = storyQueue.shift();
    if (!scene) return;
    storyScene = scene;
    storyLine = 0;
    storyActive = true;
    el.storyOverlay.hidden = false;
    renderStoryLine();
  }

  function renderStoryLine() {
    var line = storyScene.lines[storyLine];
    var c = line.who !== 'narr' ? Chars.byId(line.who) : null;
    el.storyPortrait.hidden = !c;
    if (c) el.storyPortrait.src = c.portrait;
    el.storyName.textContent = c ? c.name : '';
    el.storyName.hidden = !c;
    el.storyText.textContent = line.text;
    el.storyCard.classList.remove('pop');
    void el.storyCard.offsetWidth;
    el.storyCard.classList.add('pop');
    // 말하는 친구가 화면에 있으면 폴짝 — 카드와 스프라이트가 이어진다
    if (c) {
      var idx = state.party.indexOf(c.id);
      var node = idx === 0 ? el.hero : idx === 1 ? el.follower1 : idx === 2 ? el.follower2 : null;
      if (node && !node.hidden) {
        node.classList.remove('hop');
        void node.offsetWidth;
        node.classList.add('hop');
      }
    }
    sfx('tap');
  }

  function advanceStory() {
    if (!storyActive) return;
    storyLine++;
    if (storyLine < storyScene.lines.length) { renderStoryLine(); return; }
    endStory();
  }

  function endStory() {
    var wasRescue = storyScene.id.indexOf('rescue-') === 0;
    var wasChapter = storyScene.trigger && storyScene.trigger.type === 'chapter';
    markStory(storyScene.id);
    storyScene = null;
    storyActive = false;
    el.storyOverlay.hidden = true;
    lastFrame = 0;                    // 컷신 동안의 시간이 첫 dt 로 밀리지 않게
    if (wasRescue) Stage.heartBurst();   // 구출의 하트는 컷신이 걷힌 무대 위에서
    if (storyQueue.length) { nextSceneFromQueue(); return; }
    if (wasChapter && pendingBanner) { chapterBanner(pendingBanner); pendingBanner = null; }
  }

  /* 구출 컷신 유실 복구(codex HIGH) — 컷신 도중 새로고침하면 boss_clear(피날레)가
   * 다시 오지 않아 장면이 영영 사라진다. 진행도가 피날레를 지났는데 미시청이면 재큐.
   * 인트로가 떠 있는 동안에는 부르지 않는다 — 컷신(z-65)이 시작 버튼을 덮는다. */
  function queuePendingRescues() {
    Chapters.CHAPTERS.forEach(function (ch) {
      if (ch.to != null && state.safeStage >= ch.to) queueStory('rescue', ch.id);
    });
  }

  /* 보스 첫 조우 도발 — 말풍선 한 줄, 전투는 계속 흐른다 */
  function bossTaunt(chapterId) {
    if (!Story) return;
    var key = 'boss-' + chapterId;
    if (seenStory(key)) return;
    var text = Story.bossLine(chapterId);
    if (!text) return;
    markStory(key);
    el.bossBubble.textContent = text;
    el.bossBubble.hidden = false;
    el.bossBubble.classList.remove('pop');
    void el.bossBubble.offsetWidth;
    el.bossBubble.classList.add('pop');
    setTimeout(function () { el.bossBubble.hidden = true; }, 2600);
  }

  /* 챕터 배너 — 진입 순간 "어디에 왔는지"를 크게 보여준다 */
  var bannerReady = false;
  var pendingBanner = null;
  function chapterBanner(ch) {
    if (!bannerReady) return;      // 부팅 첫 렌더에는 띄우지 않는다
    el.chapterBannerName.textContent = ch.name;
    el.chapterBannerTag.textContent = ch.tagline || '';
    el.chapterBanner.hidden = false;
    el.chapterBanner.classList.remove('show');
    void el.chapterBanner.offsetWidth;
    el.chapterBanner.classList.add('show');
    setTimeout(function () { el.chapterBanner.hidden = true; }, 2400);
  }

  // ── 렌더 ────────────────────────────────────────────────────
  /* 챕터 시각(이름·배경·전경)만 적용한다 — 부수효과 없음. 부팅 렌더와 런타임 전환이
   * 같은 경로를 쓰되, 컷신·배너·BGM 같은 "전환 연출"은 런타임에서만 발화해야 한다.
   * (DOM 텍스트를 렌더 상태로 쓰다 부팅 렌더가 인트로 위로 컷신을 띄운 회귀 — codex P0) */
  var lastChapterId = '';
  function applyChapterVisuals(ch) {
    el.chapterName.textContent = ch.name;
    Stage.setChapter(ch);
  }

  function renderHud() {
    Stage.syncParty(state);
    el.stageNum.textContent = state.stage;
    el.goldNum.textContent = fmt(state.gold);
    el.powerNum.textContent = fmt(Combat.power(state));
    var ch = Chapters.chapterFor(state.stage);
    if (ch.id !== lastChapterId) {
      var isBoot = lastChapterId === '';
      lastChapterId = ch.id;
      applyChapterVisuals(ch);
      if (!isBoot && bannerReady) {
        // 이 챕터 컷신이 곧 뜬다면 배너는 컷신이 끝난 뒤에 (겹치면 배너가 안 보인다)
        var chScene = Story && Story.sceneFor('chapter', ch.id);
        if (chScene && state.storySeen.indexOf(chScene.id) === -1) pendingBanner = ch;
        else chapterBanner(ch);
        queueStory('chapter', ch.id);
        syncBgm();
      }
    }
  }

  function renderPanel() {
    AXES.forEach(function (axis) {
      var n = upNodes[axis.id];
      var lv = state.up[axis.id];
      var maxed = axis.id === 'aspd' && aspdMaxed();
      var count = plannedCount(axis.id);
      var cost = count > 0 ? Combat.bulkCost(state, axis.id, count) : Combat.upgradeCost(axis.id, lv);
      var can = !maxed && count > 0 && cost <= state.gold;

      n.lv.textContent = 'Lv.' + lv;
      n.eff.textContent = effectText(axis.id);
      n.cost.textContent = maxed ? '—' : fmt(cost);
      n.cnt.textContent = maxed
        ? '최대 도달'
        : (bulk === 'max')
          ? (count > 0 ? '+' + count + '레벨' : '골드 부족')
          : '+' + count + '레벨';
      n.btn.disabled = !can;
      n.btn.classList.toggle('can', can);
    });
    el.dpsHint.textContent = 'DPS ' + fmt(Combat.dps(state));
    syncTabVisibility();
    syncCoach();
    renderHud();
  }

  /* 탭 점진 공개(codex 리뷰 #10) — 처음에는 강화만 보인다. 편성은 첫 동료가
   * 생겼을 때, 유물은 첫 조각을 얻었을 때, 도전은 던전 해금, 도감은 첫 수집
   * 몇 종부터. 전부 상태에서 파생되므로 복귀 유저는 즉시 다 열려 있다. */
  var tabBtns = null;
  function syncTabVisibility() {
    if (!tabBtns) {
      tabBtns = {};
      Array.prototype.forEach.call(el.tabs.children, function (c) {
        tabBtns[c.getAttribute('data-tab')] = c;
      });
    }
    var r = state.relics;
    tabBtns.party.hidden = Chars.unlockedAt(state.stage).length <= 1;
    tabBtns.relic.hidden = !(state.shards > 0 || (r && (r.hammer || r.barn || r.compass)));
    tabBtns.battle.hidden = state.stage < B.dungeonUnlockStage;
    tabBtns.book.hidden = (state.collection || []).length < 3;
  }

  /* 무대(배경·액터·적·이펙트)는 render/stage.js 가 소유한다. 여기 남은 것은
   * **읽어야 하는 숫자** 뿐이다 — 진행도 pip, 보스 타이머, 필요 DPS. 이것들은 연출
   * 큐를 타지 않고 언제나 엔진 현재값을 보여준다(가독성은 연출보다 우선). */
  var lastPhase = '', lastMobIndex = -1, lastPipCount = 0;

  function renderHudOverlays() {
    var phase = state.phase;
    var phaseChanged = phase !== lastPhase;
    lastPhase = phase;

    // 스테이지 진행 / 보스 타이머
    var inBoss = phase === Combat.PHASE_BOSS;
    if (phaseChanged) {
      el.bossTimer.hidden = !inBoss;
      el.stageProgress.style.visibility = inBoss ? 'hidden' : 'visible';
      el.arena.classList.toggle('boss-mode', inBoss);
    }

    if (inBoss) {
      var left = Math.max(0, B.bossTimeLimit - state.bossT);
      el.bossTimerFill.style.width = (left / B.bossTimeLimit * 100) + '%';
      el.bossTimerNum.textContent = left.toFixed(1);
      // "왜 졌는지"를 숫자로 — 필요 DPS 대비 내 DPS 를 상시 표시(codex 리뷰)
      var needDps = Combat.bossHp(state.stage) / B.bossTimeLimit;
      var mine = Combat.bossDps(state);
      el.bossNeed.textContent = '필요 DPS ' + fmt(needDps) + ' · 내 DPS ' + fmt(mine);
      el.bossNeed.classList.toggle('lack', mine < needDps);
    } else if (state.mobIndex !== lastMobIndex || lastPipCount !== B.mobsPerStage) {
      lastMobIndex = state.mobIndex;
      el.progressText.textContent = state.mobIndex + ' / ' + B.mobsPerStage;
      if (lastPipCount !== B.mobsPerStage) {
        el.progressPips.innerHTML = '';
        for (var i = 0; i < B.mobsPerStage; i++) el.progressPips.appendChild(document.createElement('i'));
        lastPipCount = B.mobsPerStage;
      }
      for (var j = 0; j < el.progressPips.children.length; j++) {
        el.progressPips.children[j].classList.toggle('on', j < state.mobIndex);
      }
    }
  }

  function toast(text, kind) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    el.toastStack.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  /* 사건 처리는 두 갈래다 (COMBAT_STAGE_OVERHAUL.md 5절):
   *
   *   무대(연출)  → Stage.push() → 연출 큐가 "볼 만한 페이스"로 재생한다
   *   로직(진실)  → 여기서 즉시 처리한다 — 도감·해금·컷신·패널·BGM
   *
   * 로직을 큐에 태우면 안 된다. 몰아보기에서 도감이 빠지거나 컷신 순서가 어긋난다.
   * 반대로 연출을 즉시 처리하면 지금까지처럼 리듬이 사라진다. */
  function consumeEvents() {
    var needPanel = false;
    for (var i = 0; i < state.events.length; i++) {
      var ev = state.events[i];
      if (ev.type === 'mob_spawn' || ev.type === 'boss_start') {
        /* 도감은 스프라이트가 아니라 **사건**에서 기록한다. 화면에 실제로 그려지는
         * 시점에 기록하면 몰아보기로 건너뛴 몹이 도감에서 누락된다. */
        var isB = ev.type === 'boss_start';
        var seenArt = isB ? Chapters.bossFor(ev.stage) : Chapters.mobFor(ev.stage, ev.index);
        var seenCh = Chapters.chapterFor(ev.stage);
        recordSeen(isB ? (seenCh.id + ':boss:' + seenArt.id) : (seenCh.id + ':' + seenArt.id));
      }
      if (ev.type === 'mob_kill') {
        needPanel = true;
      }
      else if (ev.type === 'boss_clear') {
        toast('스테이지 ' + ev.stage + ' 돌파!', 'win');
        sfx('clear');
        needPanel = true;
        var beforeSlots = Chars.slotsFor(ev.stage);
        if (Chars.slotsFor(state.stage) > beforeSlots) {
          toast('편성 자리가 늘어났어요!', 'win');
          el.partyDot.hidden = false;
          partyDirty = true;
        }
        checkUnlocks();
        renderRelics();
        renderBattle();
        syncBgm();
        /* 챕터 피날레(마지막 스테이지) 돌파 — 구출 연출: 하트가 터지고 컷신이 이어진다 */
        var endedCh = Chapters.chapterFor(ev.stage);
        if (endedCh.to != null && ev.stage === endedCh.to) {
          queueStory('rescue', endedCh.id);   // 하트는 컷신이 끝나는 순간(endStory) 터진다
        }
      }
      else if (ev.type === 'boss_fail') { toast('아깝다! ⭐+' + ev.shards, 'fail'); sfx('fail'); renderRelics(); renderBattle(); syncBgm(); }
      else if (ev.type === 'boss_start') {
        toast('보스 등장!'); sfx('bossIn');
        bossTaunt(Chapters.chapterFor(state.stage).id);
        syncBgm();
      }
    }
    state.events.length = 0;
    return needPanel;
  }

  // ── 루프 ────────────────────────────────────────────────────
  /* 시작하기를 누르기 전에는 게임 시간이 흐르지 않는다. 유저가 로고를 오래 보면
   * 첫 강화·첫 보스 타이밍이 전부 달라지기 때문(codex 리뷰 P0-1).
   * 복귀 유저는 인트로가 없으므로 즉시 시작한다. */
  var gameStarted = true;
  var panelAccum = 0;
  function frame(now) {
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.25) : 0;
    lastFrame = now;
    var simDt = dt * speedMul;

    if (simDt > 0 && gameStarted && !storyActive) {
      /* 날짜 동기화는 반드시 step 보다 먼저 — 자정 직후의 처치·강화가 새 스냅숏에
       * 흡수되어 진행도에서 사라지는 것을 막는다(codex 리뷰). */
      dailyTimer += dt;
      if (dailyTimer > 1) { syncDaily(); dailyTimer = 0; }
      Combat.step(state, simDt);
      /* 사건을 무대에 먼저 넘기고(연출 큐), 그 다음 로직을 즉시 처리한다.
       * consumeEvents 가 state.events 를 비우므로 순서가 뒤집히면 무대가 굶는다. */
      Stage.push(state.events);
      var needPanel = consumeEvents();
      panelAccum += dt;
      if (needPanel || panelAccum > 0.2) { renderPanel(); panelAccum = 0; }
      renderHudOverlays();
      /* 연출은 실제 프레임 시간(dt)으로, 피해량 누적만 엔진 시간(simDt)으로 —
       * 배속을 걸어도 애니메이션이 20배로 떨리지 않고 큐가 가속으로 흡수한다. */
      Stage.update(dt, simDt, state);

      saveTimer += dt;
      if (saveTimer > 5) { persist(); saveTimer = 0; }
    }
    requestAnimationFrame(frame);
  }
  var dailyTimer = 0;

  // ── 저장 ────────────────────────────────────────────────────
  /* 리셋 직후에는 저장을 막는다 — Reset 이 키를 지우고 reload 하는 사이에
   * pagehide 의 persist 가 세이브를 되살리는 경합이 실제로 있었다.
   *
   * 멀티탭 가드: 두 탭이 같은 세이브를 5초마다 번갈아 덮어쓰면 한쪽 진행이
   * 조용히 사라진다. 내가 마지막으로 쓴 시각(lastWroteAt)보다 새로운 저장이
   * 발견되면 다른 탭이 이어받은 것이다 — 이 탭은 일시정지하고 덮어쓰지 않는다. */
  var suppressPersist = false;
  var lastWroteAt = 0;
  function otherTabTookOver() {
    var raw = null;
    try { raw = localStorage.getItem(Save.STORAGE_KEY); } catch (e) { return false; }
    if (!raw || !lastWroteAt) return false;
    var m = /"lastSaveAt"\s*:\s*(\d+)/.exec(raw);
    return !!(m && Number(m[1]) > lastWroteAt);
  }
  /* 다른 탭이 이어받았을 때 — 1회성 토스트는 사라지면 "왜 멈췄는지"를 알 수 없다.
   * 지속형 모달로 멈춘 이유와 복구 동선(최신 저장 불러오기 / 이 탭에서 이어하기)을
   * 함께 제공하고, 정지 즉시 BGM 도 끈다(codex 리뷰 P1). */
  function pauseForOtherTab() {
    if (!el.tabModal.hidden) return;
    suppressPersist = true;
    gameStarted = false;
    if (Audio) Audio.bgm(null);
    el.tabModal.hidden = false;
  }

  function persist() {
    if (suppressPersist) return;
    if (otherTabTookOver()) { pauseForOtherTab(); return; }
    var now = Date.now();
    try {
      localStorage.setItem(Save.STORAGE_KEY, Save.dump(state, now));
      lastWroteAt = now;
    } catch (e) { /* 저장 불가 — 진행은 계속한다 */ }
  }

  /* storage 이벤트는 "다른 탭"에서만 발화한다 — 5초 persist 주기를 기다리지 않고
   * 타 탭의 저장을 즉시 감지해 멈춘다. */
  window.addEventListener('storage', function (e) {
    if (e.key !== Save.STORAGE_KEY || !gameStarted) return;
    if (otherTabTookOver()) pauseForOtherTab();
  });

  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(Save.STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return;

    var res = Save.load(raw);
    if (!res.ok) {
      /* 손상·상위버전 세이브는 절대 덮어쓰지 않는다. 백업을 남기고 새 게임으로 시작하되,
       * 자동저장이 원본을 지우지 못하게 백업 키를 따로 둔다. */
      try { localStorage.setItem(Save.STORAGE_KEY + '-backup-' + Date.now(), raw); } catch (e) {}
      toast('저장 파일을 읽지 못해 백업했어요', 'fail');
      return;
    }
    if (!res.state) return;
    state = res.state;

    var lastAt = res.save && res.save.lastSaveAt;
    if (lastAt) {
      lastWroteAt = lastAt;      // 멀티탭 가드 기준점 — 이 시각 이후의 타 탭 저장을 감지
      grantOffline((Date.now() - lastAt) / 1000);
    }
  }

  /* 자리를 비운 시간만큼 골드를 지급한다. 지급과 팝업 노출은 분리한다 —
   * 짧게 비운 경우에도 골드는 주되 팝업으로 흐름을 끊지 않는다. */
  function grantOffline(elapsedSec) {
    var reward = Combat.offlineReward(state, elapsedSec);
    if (!(reward.gold > 0)) return;
    state.gold += reward.gold;
    state.stats.goldEarned += reward.gold;
    if (reward.seconds >= B.offlineMinSeconds) showOffline(reward);
    renderPanel();
  }

  function showOffline(reward) {
    el.offlineGold.textContent = fmt(reward.gold);
    el.offlineSub.textContent =
      fmtDuration(reward.seconds) + ' 동안 ' + reward.farmStage + '스테이지에서 모았어요' +
      (reward.cappedBy === 'max' ? ' (최대 ' + B.offlineMaxHours + '시간)' : '');
    /* 복귀를 행동으로 잇는다(codex 리뷰 #8) — 받은 골드로 지금 몇 레벨을 올릴 수
     * 있는지 보여준다. 골드는 grantOffline 에서 이미 더해진 상태다. */
    var best = 0;
    for (var i = 0; i < AXES.length; i++) {
      var a = Combat.affordable(state, AXES[i].id, null);
      if (a > best) best = a;
    }
    el.offlineHint.hidden = !(best > 0);
    if (best > 0) el.offlineHint.textContent = '지금 바로 강화 +' + fmt(best) + '레벨 가능!';
    el.offlineModal.hidden = false;
  }

  // ── 입력 ────────────────────────────────────────────────────
  el.bulkToggle.addEventListener('click', function (e) {
    var b = e.target.getAttribute('data-bulk');
    if (!b) return;
    bulk = (b === 'max') ? 'max' : parseInt(b, 10);
    Array.prototype.forEach.call(el.bulkToggle.children, function (c) {
      c.classList.toggle('on', c.getAttribute('data-bulk') === b);
    });
    renderPanel();
  });

  el.tabs.setAttribute('role', 'tablist');
  Array.prototype.forEach.call(el.tabs.children, function (c) {
    c.setAttribute('role', 'tab');
    c.setAttribute('aria-selected', c.classList.contains('on') ? 'true' : 'false');
  });
  el.tabs.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-tab]') : null;
    var tab = btn && btn.getAttribute('data-tab');
    if (!tab) return;
    Array.prototype.forEach.call(el.tabs.children, function (c) {
      var on = c.getAttribute('data-tab') === tab;
      c.classList.toggle('on', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    el.panelUpgrade.hidden = tab !== 'upgrade';
    el.panelParty.hidden = tab !== 'party';
    el.panelRelic.hidden = tab !== 'relic';
    el.panelBattle.hidden = tab !== 'battle';
    el.panelBook.hidden = tab !== 'book';
    sfx('tap');
    if (Audio) Audio.warm();
    if (tab === 'party') { el.partyDot.hidden = true; partyDirty = true; renderParty(); }
    if (tab === 'relic') { el.relicDot.hidden = true; renderRelics(); }
    if (tab === 'battle') { el.battleDot.hidden = true; syncDaily(); renderBattle(); }
    if (tab === 'book') { bookDirty = true; renderBook(); }
  });

  el.storyOverlay.addEventListener('click', advanceStory);
  el.storySkip.addEventListener('click', function (e) {
    e.stopPropagation();
    if (storyActive) endStory();
  });

  el.dungeonGo.addEventListener('click', runDungeon);
  el.dungeonOk.addEventListener('click', function () { el.dungeonModal.hidden = true; });
  el.exitBtn4.addEventListener('click', function () { persist(); window.GameBoot ? window.GameBoot.exit() : (location.href = '/'); });
  el.exitBtn5.addEventListener('click', function () { persist(); window.GameBoot ? window.GameBoot.exit() : (location.href = '/'); });

  function syncMuteBtn() {
    var m = Audio && Audio.isMuted();
    el.muteBtn.textContent = m ? '🔇' : '🔊';
    el.muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
  }
  el.muteBtn.addEventListener('click', function () {
    if (!Audio) return;
    Audio.setMuted(!Audio.isMuted());
    Audio.warm();
    syncMuteBtn();
  });

  el.exitBtn3.addEventListener('click', function () {
    persist();
    if (window.GameBoot) window.GameBoot.exit();
    else location.href = '/';
  });

  el.exitBtn2.addEventListener('click', function () {
    persist();
    if (window.GameBoot) window.GameBoot.exit();
    else location.href = '/';
  });

  el.offlineOk.addEventListener('click', function () {
    el.offlineModal.hidden = true;
    renderPanel();
  });

  /* 멀티탭 복구 — 불러오기: 타 탭의 최신 저장으로 재시작. 이어하기: 이 탭 상태를
   * 즉시 다시 써서 소유권을 가져온다(상대 탭은 storage 이벤트로 같은 모달을 보게 된다). */
  el.tabReload.addEventListener('click', function () { location.reload(); });
  el.tabResume.addEventListener('click', function () {
    el.tabModal.hidden = true;
    suppressPersist = false;
    /* 가드 기준점 갱신 — 타 탭의 저장을 "과거"로 만든다. 저장된 lastSaveAt 이
     * 이쪽 시계보다 앞서 있어도(드물지만) 즉시 재정지하지 않도록 max 를 취한다. */
    var savedAt = 0;
    try {
      var raw = localStorage.getItem(Save.STORAGE_KEY);
      var mm = raw && /"lastSaveAt"\s*:\s*(\d+)/.exec(raw);
      if (mm) savedAt = Number(mm[1]);
    } catch (e) {}
    lastWroteAt = Math.max(Date.now(), savedAt + 1);
    gameStarted = true;
    lastFrame = 0;
    persist();
    syncBgm();
  });

  el.exitBtn.addEventListener('click', function () {
    persist();
    if (window.GameBoot) window.GameBoot.exit();
    else location.href = '/';
  });

  /* 탭이 숨겨지면 requestAnimationFrame 이 멈춘다. 그 시간을 그냥 두면 프레임 dt 상한
   * (0.25초)에 잘려 방치 시간이 통째로 사라진다 — 방치형에서 가장 치명적인 손실이다.
   * 숨길 때 저장하고, 돌아올 때 저장 시각 기준으로 오프라인 보상을 정산한다. */
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      persist();
      hiddenAt = Date.now();
    } else if (hiddenAt) {
      // 시작 전(인트로)에는 게임 시간이 없으므로 오프라인 보상도 없다
      if (gameStarted) grantOffline((Date.now() - hiddenAt) / 1000);
      hiddenAt = 0;
      lastFrame = 0;          // 복귀 첫 프레임의 dt 를 0 으로 — 큰 dt 가 한 번에 밀리지 않게
    }
  });
  window.addEventListener('pagehide', persist);

  // ── DEV 패널 ────────────────────────────────────────────────
  function setupDev() {
    el.devPanel.hidden = false;

    /* 자동화 검증용 훅. 헤드리스/백그라운드 탭에서는 requestAnimationFrame 이
     * 정지하므로 게임이 진행되지 않는다. 이 훅으로 직접 시간을 밀어 렌더 결과까지
     * 확인할 수 있다. ?dev=1 일 때만 노출된다. */
    window.__mallangIdle = {
      get state() { return state; },
      advance: function (sec) {
        Combat.step(state, sec);
        Stage.push(state.events);
        consumeEvents();
        renderPanel();
        renderHudOverlays();
        /* 연출도 같은 시간만큼 밀어 준다 — 큐가 밀린 만큼 가속·몰아보기로 흡수한다.
         * 이 훅이 무대를 안 밀면 헤드리스 검증에서 화면이 영원히 첫 프레임에 멈춘다. */
        Stage.update(sec, sec, state);
        return { stage: state.stage, phase: state.phase, gold: state.gold };
      },
      Combat: Combat, Save: Save, Chapters: Chapters, Balance: Bal,
      Stage: Stage,
      // 연출 검증용 — 헤드리스에선 rAF 가 멈춰 자연 발화를 볼 수 없다
      fx: Stage.fx,
    };
    el.devPanel.addEventListener('click', function (e) {
      var cmd = e.target.getAttribute('data-dev');
      if (!cmd) return;
      var parts = cmd.split(':');
      var kind = parts[0], val = parseFloat(parts[1]);

      if (kind === 'gold') { state.gold += val; }
      else if (kind === 'stage') {
        state.stage += val; state.safeStage = state.stage - 1;
        state.mobIndex = 0; state.phase = Combat.PHASE_ADVANCE; state.phaseT = 0;
      }
      else if (kind === 'boss') { state.mobIndex = B.mobsPerStage; state.phase = Combat.PHASE_ADVANCE; state.phaseT = B.advanceSeconds; }
      else if (kind === 'offline') {
        var r = Combat.offlineReward(state, val);
        state.gold += r.gold; showOffline(r);
      }
      else if (kind === 'speed') {
        speedMul = val;
        Array.prototype.forEach.call(e.target.parentNode.querySelectorAll('button'), function (b) {
          b.classList.toggle('on', b === e.target);
        });
      }
      else if (kind === 'save') { persist(); toast('저장했어요'); }
      else if (kind === 'export') {
        var text = Save.dump(state, Date.now());
        window.prompt('세이브 복사', text);
      }
      else if (kind === 'import') {
        var input = window.prompt('세이브 붙여넣기');
        if (input) {
          var res = Save.load(input);
          if (res.ok && res.state) { state = res.state; toast('불러왔어요'); }
          else toast('불러오기 실패', 'fail');
        }
      }
      else if (kind === 'reset') {
        if (window.confirm('진행을 모두 지울까요? (인트로·튜토리얼 포함 첫 방문 상태로)')) {
          // 첫 방문 QA 용 — 세이브만 지우면 온보딩이 재현되지 않는다(codex 리뷰)
          suppressPersist = true;   // reload 직전 pagehide persist 가 세이브를 되살리지 않게
          try {
            localStorage.removeItem(Save.STORAGE_KEY);
            localStorage.removeItem(Save.STORAGE_KEY + '-seen');
            localStorage.removeItem(Save.STORAGE_KEY + '-tut');
          } catch (er) {}
          location.reload();
        }
      }
      renderPanel();
    });
  }

  // ── 시작 ────────────────────────────────────────────────────
  buildUpgrades();
  buildRelics();
  buildQuests();
  restore();
  Combat.sanitizeParty(state);
  Chars.unlockedAt(state.stage).forEach(function (id) { seenUnlocks[id] = true; });
  state.collection.forEach(function (k) { collectionSet[k] = true; });
  syncDaily();
  if (DEV) setupDev();
  renderPanel();
  renderParty();
  renderRelics();
  renderBattle();
  renderHudOverlays();
  /* 부팅 첫 프레임 — 큐가 비어 있으므로 무대가 엔진 현재값으로 스냅한다(syncTo).
   * 복귀 유저가 보스전 도중에 껐어도 그 장면 그대로 다시 선다. */
  Stage.update(0.016, 0, state);
  syncMuteBtn();
  document.addEventListener('pointerdown', function warmOnce() {
    if (Audio) Audio.warm();
    syncBgm();                       // 자동재생 정책 — 첫 제스처 후에야 BGM 이 시작된다
    document.removeEventListener('pointerdown', warmOnce);
  });

  /* 첫 방문에만 타이틀을 보여준다. 방치형은 "무엇을 하는 게임인지"가 한 화면에
   * 안 드러나면 그냥 구경만 하다 나간다 — 강화하라는 말을 처음에 한 번은 해야 한다. */
  var seenIntro = false;
  try { seenIntro = localStorage.getItem(Save.STORAGE_KEY + '-seen') === '1'; } catch (e) {}
  if (!seenIntro) {
    el.intro.hidden = false;
    gameStarted = false;          // 시작 버튼 전에는 t=0, gold=0 그대로
    el.introStart.addEventListener('click', function () {
      el.intro.hidden = true;
      gameStarted = true;
      lastFrame = 0;              // 인트로를 보던 시간이 첫 dt 로 밀리지 않게
      if (Audio) Audio.warm();
      sfx('tap');
      try { localStorage.setItem(Save.STORAGE_KEY + '-seen', '1'); } catch (e) {}
      queueStory('chapter', Chapters.chapterFor(state.stage).id);   // 오프닝
      queuePendingRescues();
      syncBgm();
    });
  } else {
    // 복귀 유저 — 현재 챕터 컷신을 아직 못 봤다면(구세이브) 지금 보여준다
    queueStory('chapter', Chapters.chapterFor(state.stage).id);
    queuePendingRescues();
  }
  bannerReady = true;

  requestAnimationFrame(frame);
})();
