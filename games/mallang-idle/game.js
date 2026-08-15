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
    field: document.querySelector('.field'), intro: $('intro'), introStart: $('introStart'),
    tabs: $('tabs'), panelUpgrade: $('panelUpgrade'), panelParty: $('panelParty'),
    partyList: $('partyList'), partySlots: $('partySlots'), partyDot: $('partyDot'),
    partyBonusHint: $('partyBonusHint'), exitBtn2: $('exitBtn2'),
    panelRelic: $('panelRelic'), relicList: $('relicList'), relicDot: $('relicDot'),
    shardNum: $('shardNum'), exitBtn3: $('exitBtn3'),
    toastStack: $('toastStack'),
    offlineModal: $('offlineModal'), offlineGold: $('offlineGold'),
    offlineSub: $('offlineSub'), offlineOk: $('offlineOk'),
    devPanel: $('devPanel'),
  };

  // ── 숫자 표기 ────────────────────────────────────────────────
  // 표기는 UI 계층의 일이다. 엔진은 계속 Number 로만 계산한다.
  var UNITS = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae', 'af'];
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

  function onBuy(axisId) {
    var n = plannedCount(axisId);
    if (n <= 0) return;
    var got = Combat.buy(state, axisId, n);
    if (got > 0) { finishTutorial(); renderPanel(); }
  }

  function effectText(axisId) {
    if (axisId === 'atk')  return '공격력 ' + fmt(Combat.atk(state.up.atk));
    if (axisId === 'aspd') {
      var a = Combat.aspd(state.up.aspd);
      return '초당 ' + a.toFixed(2) + '회' + (a >= B.aspdCap ? ' (최대)' : '');
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
        state.party.shift();
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
        if (state.t > 1 && c) { toast(c.name + ' 합류!', 'win'); news = true; }
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
        '<span class="relic-emoji">' + r.emoji + '</span>' +
        '<div><div class="up-name">' + r.name + ' <span class="up-lv"></span></div>' +
        '<div class="up-eff"></div></div>' +
        '<div><div class="up-cost shard">⭐<span></span></div></div>';
      btn.addEventListener('click', function () {
        if (Combat.buyRelic(state, r.id)) { renderRelics(); renderPanel(); persist(); }
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

  // ── 렌더 ────────────────────────────────────────────────────
  var bgOffset = 0;
  var lastEnemyKey = '';

  /* 화면에 서는 주인공은 편성 1번 자리의 친구다. 프레임 폭이 캐릭터마다 달라
   * background-size 까지 같이 바꿔야 워크사이클이 어긋나지 않는다. */
  var lastHeroId = '';
  function renderHero() {
    var id = state.party && state.party[0];
    if (!id || id === lastHeroId) return;
    var c = Chars.byId(id);
    if (!c) return;
    lastHeroId = id;
    el.hero.style.width = c.frameW + 'px';
    el.hero.style.backgroundImage = "url('" + c.walk + "')";
    el.hero.style.backgroundSize = (c.frameW * 3) + 'px 220px';
    el.hero.style.setProperty('--walk-shift', '-' + (c.frameW * 3) + 'px');
  }

  function renderHud() {
    renderHero();
    el.stageNum.textContent = state.stage;
    el.goldNum.textContent = fmt(state.gold);
    el.powerNum.textContent = fmt(Combat.power(state));
    var ch = Chapters.chapterFor(state.stage);
    if (el.chapterName.textContent !== ch.name) {
      el.chapterName.textContent = ch.name;
      el.bgLayer.style.backgroundImage = "url('" + ch.bg + "')";
    }
  }

  function renderPanel() {
    AXES.forEach(function (axis) {
      var n = upNodes[axis.id];
      var lv = state.up[axis.id];
      var count = plannedCount(axis.id);
      var cost = count > 0 ? Combat.bulkCost(state, axis.id, count) : Combat.upgradeCost(axis.id, lv);
      var can = count > 0 && cost <= state.gold;

      n.lv.textContent = 'Lv.' + lv;
      n.eff.textContent = effectText(axis.id);
      n.cost.textContent = fmt(cost);
      n.cnt.textContent = (bulk === 'max')
        ? (count > 0 ? '+' + count + '레벨' : '골드 부족')
        : '+' + count + '레벨';
      n.btn.disabled = !can;
      n.btn.classList.toggle('can', can);
    });
    el.dpsHint.textContent = 'DPS ' + fmt(Combat.dps(state));
    syncCoach();
    renderHud();
  }

  /* 매 프레임 바뀌는 것은 배경 위치·적 HP·보스 타이머뿐이다. 나머지(클래스 토글,
   * 텍스트, pip 10개)는 값이 실제로 달라졌을 때만 쓴다. */
  var lastPhase = '', lastMobIndex = -1, lastPipCount = 0;

  function renderArena(dt) {
    var phase = state.phase;
    var walking = phase === Combat.PHASE_ADVANCE;
    var phaseChanged = phase !== lastPhase;
    lastPhase = phase;

    // 배경 스크롤 — 전진 중에만 흐른다.
    if (walking) {
      bgOffset -= dt * 90;
      el.bgLayer.style.backgroundPositionX = bgOffset + 'px';
    }
    if (phaseChanged) {
      el.hero.classList.toggle('walking', walking);
      el.hero.classList.toggle('attacking', !walking);
    }

    if (walking) {
      if (phaseChanged) { el.enemy.hidden = true; el.bossRing.hidden = true; }
      lastEnemyKey = '';
    } else {
      var isBoss = phase === Combat.PHASE_BOSS;
      var art = isBoss ? Chapters.bossFor(state.stage) : Chapters.mobFor(state.stage, state.mobIndex);
      var key = (isBoss ? 'B' : 'M') + art.id + state.stage + state.mobIndex;
      if (key !== lastEnemyKey) {
        lastEnemyKey = key;
        el.enemyArt.src = art.art;
        el.enemyName.textContent = art.name;
        el.enemy.classList.toggle('is-boss', isBoss);
        el.enemy.hidden = false;
        el.bossRing.hidden = !isBoss;
      }
      var ratio = state.enemyMaxHp > 0 ? Math.max(0, state.enemyHp / state.enemyMaxHp) : 0;
      el.enemyHpFill.style.width = (ratio * 100) + '%';
    }

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

  /* 골드 획득 플로팅 — 몹을 잡을 때마다 숫자가 조용히 오르기만 하면 성장이 안 보인다.
   * 배속에서 폭주하지 않도록 짧은 간격으로 합산해 하나만 띄운다. */
  var floatAccum = 0, floatCooldown = 0;
  function floatGold(amount) {
    floatAccum += amount;
    if (floatCooldown > 0) return;
    floatCooldown = 0.25;
    var n = document.createElement('div');
    n.className = 'gold-float';
    n.textContent = '+' + fmt(floatAccum);
    floatAccum = 0;
    el.field.appendChild(n);
    setTimeout(function () { n.remove(); }, 900);
  }

  function consumeEvents() {
    var needPanel = false;
    for (var i = 0; i < state.events.length; i++) {
      var ev = state.events[i];
      if (ev.type === 'mob_kill') { needPanel = true; floatGold(ev.gold); }
      else if (ev.type === 'boss_clear') {
        toast('스테이지 ' + ev.stage + ' 돌파!', 'win');
        needPanel = true;
        var beforeSlots = Chars.slotsFor(ev.stage);
        if (Chars.slotsFor(state.stage) > beforeSlots) {
          toast('편성 자리가 늘어났어요!', 'win');
          el.partyDot.hidden = false;
          partyDirty = true;
        }
        checkUnlocks();
        renderRelics();
      }
      else if (ev.type === 'boss_fail') { toast('아깝다! ⭐+' + ev.shards, 'fail'); renderRelics(); }
      else if (ev.type === 'boss_start') { toast('보스 등장!'); }
    }
    state.events.length = 0;
    return needPanel;
  }

  // ── 루프 ────────────────────────────────────────────────────
  var panelAccum = 0;
  function frame(now) {
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.25) : 0;
    lastFrame = now;
    var simDt = dt * speedMul;

    if (simDt > 0) {
      if (floatCooldown > 0) floatCooldown -= dt;
      Combat.step(state, simDt);
      var needPanel = consumeEvents();
      panelAccum += dt;
      if (needPanel || panelAccum > 0.2) { renderPanel(); panelAccum = 0; }
      renderArena(simDt);

      saveTimer += dt;
      if (saveTimer > 5) { persist(); saveTimer = 0; }
    }
    requestAnimationFrame(frame);
  }

  // ── 저장 ────────────────────────────────────────────────────
  function persist() {
    try { localStorage.setItem(Save.STORAGE_KEY, Save.dump(state, Date.now())); }
    catch (e) { /* 저장 불가 — 진행은 계속한다 */ }
  }

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
    if (lastAt) grantOffline((Date.now() - lastAt) / 1000);
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

  el.tabs.addEventListener('click', function (e) {
    var tab = e.target.getAttribute('data-tab');
    if (!tab) return;
    Array.prototype.forEach.call(el.tabs.children, function (c) {
      c.classList.toggle('on', c.getAttribute('data-tab') === tab);
    });
    el.panelUpgrade.hidden = tab !== 'upgrade';
    el.panelParty.hidden = tab !== 'party';
    el.panelRelic.hidden = tab !== 'relic';
    if (tab === 'party') { el.partyDot.hidden = true; partyDirty = true; renderParty(); }
    if (tab === 'relic') { el.relicDot.hidden = true; renderRelics(); }
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
      grantOffline((Date.now() - hiddenAt) / 1000);
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
        consumeEvents();
        renderPanel();
        renderArena(sec);
        return { stage: state.stage, phase: state.phase, gold: state.gold };
      },
      Combat: Combat, Save: Save, Chapters: Chapters, Balance: Bal,
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
        if (window.confirm('진행을 모두 지울까요?')) {
          try { localStorage.removeItem(Save.STORAGE_KEY); } catch (er) {}
          state = Combat.createState();
          toast('초기화했어요');
        }
      }
      renderPanel();
    });
  }

  // ── 시작 ────────────────────────────────────────────────────
  buildUpgrades();
  buildRelics();
  restore();
  Combat.sanitizeParty(state);
  Chars.unlockedAt(state.stage).forEach(function (id) { seenUnlocks[id] = true; });
  if (DEV) setupDev();
  renderPanel();
  renderParty();
  renderRelics();
  renderArena(0);

  /* 첫 방문에만 타이틀을 보여준다. 방치형은 "무엇을 하는 게임인지"가 한 화면에
   * 안 드러나면 그냥 구경만 하다 나간다 — 강화하라는 말을 처음에 한 번은 해야 한다. */
  var seenIntro = false;
  try { seenIntro = localStorage.getItem(Save.STORAGE_KEY + '-seen') === '1'; } catch (e) {}
  if (!seenIntro) {
    el.intro.hidden = false;
    el.introStart.addEventListener('click', function () {
      el.intro.hidden = true;
      try { localStorage.setItem(Save.STORAGE_KEY + '-seen', '1'); } catch (e) {}
    });
  }

  requestAnimationFrame(frame);
})();
