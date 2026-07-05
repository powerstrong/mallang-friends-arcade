/* microgames.js — 말랑 깜짝파티 마이크로게임 모듈 (window 전역)
 *
 * 각 모듈 계약:
 *   { id, prompt, hint, icon, baseMs, winOnTimeout, mount(ctx) -> cleanup? }
 *   ctx = { root, rng, speed, durationMs, success(), fail() }
 *
 * 규칙:
 *   - 무작위는 반드시 ctx.rng 만 사용 (같은 라운드 시드 = 전 클라 동일 배치 = 공정).
 *   - success/fail 은 러너가 멱등 처리하므로 중복 호출 걱정 없음.
 *   - 시간 초과 처리는 러너 몫: winOnTimeout 이 true 면 성공, false 면 실패.
 *   - mount 가 반환한 cleanup 은 라운드 종료 시 호출된다 (rAF/interval 해제용).
 */
(function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // root 안 임의 위치(%) — 가장자리 여백 확보
  function randPos(rng, marginPct) {
    var m = marginPct === undefined ? 14 : marginPct;
    return {
      left: m + rng() * (100 - m * 2),
      top: m + rng() * (100 - m * 2),
    };
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length) % arr.length];
  }

  var GAMES = [

    /* ── 1. 눌러! — 초록불 반응속도 ─────────────────────── */
    {
      id: 'tap-now', prompt: '눌러!', hint: '초록불이 켜지면!', icon: '🚦',
      baseMs: 3400, winOnTimeout: false,
      mount: function (ctx) {
        var green = false;
        var light = el('div', 'mg-light mg-light--red', '🔴');
        var label = el('p', 'mg-sub', '기다려...');
        ctx.root.appendChild(light);
        ctx.root.appendChild(label);
        var windowMs = Math.max(650, 900 / ctx.speed);
        var delay = 300 + ctx.rng() * Math.max(400, ctx.durationMs - windowMs - 500);
        var timer = setTimeout(function () {
          green = true;
          light.textContent = '🟢';
          light.classList.remove('mg-light--red');
          light.classList.add('mg-light--green');
          label.textContent = '지금!!';
        }, delay);
        function onTap() { if (green) ctx.success(); else ctx.fail(); }
        ctx.root.addEventListener('pointerdown', onTap);
        return function () { clearTimeout(timer); ctx.root.removeEventListener('pointerdown', onTap); };
      },
    },

    /* ── 2. 참아! — 누르면 지는 트랩 ────────────────────── */
    {
      id: 'dont-tap', prompt: '참아!', hint: '절대 누르지 마!', icon: '🙅',
      baseMs: 3000, winOnTimeout: true,
      mount: function (ctx) {
        var btn = el('button', 'mg-temptation', '🍭');
        var label = el('p', 'mg-sub', '누르고 싶지...?');
        ctx.root.appendChild(btn);
        ctx.root.appendChild(label);
        var taunts = ['누르고 싶지...?', '말랑말랑~ 딱 한 번만?', '조금만 더 참아!!'];
        var i = 0;
        var iv = setInterval(function () {
          i += 1;
          label.textContent = taunts[i % taunts.length];
          btn.style.transform = 'scale(' + (1 + 0.12 * (i % 2)) + ') rotate(' + ((i % 2 ? 1 : -1) * 6) + 'deg)';
        }, 450 / ctx.speed);
        btn.addEventListener('pointerdown', function () { btn.textContent = '💥'; ctx.fail(); });
        return function () { clearInterval(iv); };
      },
    },

    /* ── 3. 연타! — 젤리 두드리기 ───────────────────────── */
    {
      id: 'tap-fast', prompt: '연타!', hint: '젤리를 마구 두드려!', icon: '🍮',
      baseMs: 3600, winOnTimeout: false,
      mount: function (ctx) {
        // 상한 10회: x2.0 기준 초당 ~5.5회 — 초딩 손 속도의 물리적 한계 고려
        var need = Math.min(10, Math.round(6 + ctx.speed * 3 + ctx.rng() * 2));
        var jelly = el('div', 'mg-jelly', '🍮');
        var count = el('p', 'mg-count', String(need));
        ctx.root.appendChild(jelly);
        ctx.root.appendChild(count);
        function onTap() {
          need -= 1;
          count.textContent = String(Math.max(0, need));
          jelly.classList.remove('is-squish');
          void jelly.offsetWidth; // 애니메이션 재시작
          jelly.classList.add('is-squish');
          if (need <= 0) { jelly.textContent = '✨'; ctx.success(); }
        }
        ctx.root.addEventListener('pointerdown', onTap);
        return function () { ctx.root.removeEventListener('pointerdown', onTap); };
      },
    },

    /* ── 4. 잡아! — 도망다니는 병아리 ───────────────────── */
    {
      id: 'catch-chick', prompt: '잡아!', hint: '병아리가 도망가요!', icon: '🐤',
      baseMs: 3800, winOnTimeout: false,
      mount: function (ctx) {
        var chick = el('button', 'mg-runner', '🐤');
        ctx.root.appendChild(chick);
        function hop() {
          var p = randPos(ctx.rng, 16);
          chick.style.left = p.left + '%';
          chick.style.top = p.top + '%';
        }
        hop();
        var iv = setInterval(hop, Math.max(320, 560 / ctx.speed));
        chick.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          chick.textContent = '😳';
          ctx.success();
        });
        return function () { clearInterval(iv); };
      },
    },

    /* ── 5. 과일만! — 폭탄 판별 ─────────────────────────── */
    {
      id: 'bomb-fruit', prompt: '과일만!', hint: '과일 3개! 폭탄은 금지!', icon: '🍎',
      baseMs: 4200, winOnTimeout: false,
      mount: function (ctx) {
        var fruits = ['🍎', '🍌', '🍇', '🍓', '🍊'];
        var items = [];
        for (var i = 0; i < 4; i++) items.push(pick(ctx.rng, fruits));
        items.push('💣', '💣');
        // rng 셔플 (Fisher–Yates)
        for (var j = items.length - 1; j > 0; j--) {
          var k = Math.floor(ctx.rng() * (j + 1));
          var t = items[j]; items[j] = items[k]; items[k] = t;
        }
        var left = 3;
        var grid = el('div', 'mg-grid mg-grid--2x3');
        items.forEach(function (emo) {
          var cell = el('button', 'mg-cell', emo);
          cell.addEventListener('pointerdown', function () {
            if (cell.disabled) return;
            cell.disabled = true;
            if (emo === '💣') { cell.textContent = '💥'; ctx.fail(); return; }
            cell.classList.add('is-eaten');
            left -= 1;
            if (left <= 0) ctx.success();
          });
          grid.appendChild(cell);
        });
        ctx.root.appendChild(grid);
      },
    },

    /* ── 6. 채워! — 홀드 & 릴리즈 타이밍 ────────────────── */
    {
      id: 'charge-release', prompt: '채워!', hint: '꾹 눌렀다가 초록 존에서 놓아!', icon: '🔋',
      baseMs: 4200, winOnTimeout: false,
      mount: function (ctx) {
        var zoneStart = 62 + ctx.rng() * 12;        // 62~74%
        // R13 미만은 존을 넉넉히 — 초딩 타깃에서 "운"으로 느껴지지 않게 (codex 리뷰 Major #5)
        var zoneFloor = (ctx.round || 1) >= 13 ? 13 : 17;
        var zoneWidth = Math.max(zoneFloor, 22 / ctx.speed);
        var bar = el('div', 'mg-bar');
        var zone = el('div', 'mg-bar-zone');
        zone.style.left = zoneStart + '%';
        zone.style.width = zoneWidth + '%';
        var fill = el('div', 'mg-bar-fill');
        bar.appendChild(zone);
        bar.appendChild(fill);
        var label = el('p', 'mg-sub', '꾹 눌러서 충전!');
        ctx.root.appendChild(bar);
        ctx.root.appendChild(label);

        var value = 0, holding = false, raf = null, last = null, done = false;
        var ratePerMs = 100 / (1500 / ctx.speed); // 1.5초/speed 에 만충
        function frame(ts) {
          if (last === null) last = ts;
          var dt = ts - last; last = ts;
          if (holding) {
            value += ratePerMs * dt;
            if (value >= 100) { value = 100; fill.style.width = '100%'; done = true; ctx.fail(); return; }
            fill.style.width = value + '%';
          }
          raf = requestAnimationFrame(frame);
        }
        raf = requestAnimationFrame(frame);
        function down() { if (!done) { holding = true; label.textContent = '초록 존에서 놓아!'; } }
        function up() {
          if (done || !holding) return;
          holding = false; done = true;
          if (value >= zoneStart && value <= zoneStart + zoneWidth) ctx.success();
          else ctx.fail();
        }
        // OS 제스처 등으로 취소되면 판정하지 않고 홀드만 해제 (억울한 실패 방지)
        function cancel() { holding = false; }
        ctx.root.addEventListener('pointerdown', down);
        ctx.root.addEventListener('pointerup', up);
        ctx.root.addEventListener('pointercancel', cancel);
        return function () {
          if (raf) cancelAnimationFrame(raf);
          ctx.root.removeEventListener('pointerdown', down);
          ctx.root.removeEventListener('pointerup', up);
          ctx.root.removeEventListener('pointercancel', cancel);
        };
      },
    },

    /* ── 7. 쓸어! — 방향 스와이프 ───────────────────────── */
    {
      id: 'swipe-arrow', prompt: '쓸어!', hint: '화살표 방향으로 스와이프!', icon: '👆',
      baseMs: 3400, winOnTimeout: false,
      mount: function (ctx) {
        var dirs = [
          { emo: '⬅️', dx: -1, dy: 0 }, { emo: '➡️', dx: 1, dy: 0 },
          { emo: '⬆️', dx: 0, dy: -1 }, { emo: '⬇️', dx: 0, dy: 1 },
        ];
        var target = pick(ctx.rng, dirs);
        var arrow = el('div', 'mg-arrow', target.emo);
        ctx.root.appendChild(arrow);
        var start = null;
        var startId = null;
        function down(e) { start = { x: e.clientX, y: e.clientY }; startId = e.pointerId; }
        function up(e) {
          if (!start || e.pointerId !== startId) return;
          var dx = e.clientX - start.x, dy = e.clientY - start.y;
          start = null; startId = null;
          if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return; // 스와이프 아님 — 무시
          var horiz = Math.abs(dx) >= Math.abs(dy);
          var ok = horiz
            ? (target.dx !== 0 && Math.sign(dx) === target.dx)
            : (target.dy !== 0 && Math.sign(dy) === target.dy);
          if (ok) ctx.success(); else ctx.fail();
        }
        // iOS 가장자리 제스처/알림 등으로 취소되면 시작점을 버린다 —
        // 다음 터치의 up 이 이전 좌표와 비교되는 억울한 판정 방지
        function cancel() { start = null; startId = null; }
        ctx.root.addEventListener('pointerdown', down);
        ctx.root.addEventListener('pointerup', up);
        ctx.root.addEventListener('pointercancel', cancel);
        return function () {
          ctx.root.removeEventListener('pointerdown', down);
          ctx.root.removeEventListener('pointerup', up);
          ctx.root.removeEventListener('pointercancel', cancel);
        };
      },
    },

    /* ── 8. 찾아! — 다른 하나 관찰 ──────────────────────── */
    {
      id: 'odd-face', prompt: '찾아!', hint: '다른 친구가 숨어있어!', icon: '🔍',
      baseMs: 4200, winOnTimeout: false,
      mount: function (ctx) {
        var pairs = [
          ['😺', '😸'], ['🐶', '🐺'], ['🍩', '🍪'], ['🐤', '🐥'], ['⭐', '🌟'], ['🐰', '🐹'],
        ];
        var pair = pick(ctx.rng, pairs);
        var oddIndex = Math.floor(ctx.rng() * 9);
        var grid = el('div', 'mg-grid mg-grid--3x3');
        for (var i = 0; i < 9; i++) {
          (function (idx) {
            var cell = el('button', 'mg-cell', idx === oddIndex ? pair[1] : pair[0]);
            cell.addEventListener('pointerdown', function () {
              if (idx === oddIndex) { cell.classList.add('is-found'); ctx.success(); }
              else ctx.fail();
            });
            grid.appendChild(cell);
          })(i);
        }
        ctx.root.appendChild(grid);
      },
    },

    /* ── 9. 터뜨려! — 풍선 전부 탭 ──────────────────────── */
    {
      id: 'balloon-pop', prompt: '터뜨려!', hint: '풍선을 전부!', icon: '🎈',
      baseMs: 3800, winOnTimeout: false,
      mount: function (ctx) {
        var left = 4;
        var slots = [
          { left: 22, top: 26 }, { left: 72, top: 22 },
          { left: 30, top: 68 }, { left: 70, top: 64 },
        ];
        slots.forEach(function (slot) {
          var b = el('button', 'mg-balloon', '🎈');
          b.style.left = (slot.left + (ctx.rng() * 12 - 6)) + '%';
          b.style.top = (slot.top + (ctx.rng() * 12 - 6)) + '%';
          b.style.filter = 'hue-rotate(' + Math.floor(ctx.rng() * 360) + 'deg)';
          b.style.animationDelay = (ctx.rng() * 0.8) + 's';
          b.addEventListener('pointerdown', function () {
            if (b.disabled) return;
            b.disabled = true;
            b.textContent = '💨';
            b.classList.add('is-popped');
            left -= 1;
            if (left <= 0) ctx.success();
          });
          ctx.root.appendChild(b);
        });
      },
    },

    /* ── 10. 멈춰! — 움직이는 바 정지 타이밍 ────────────── */
    {
      id: 'stop-bar', prompt: '멈춰!', hint: '가운데 존에서 탭!', icon: '🎯',
      baseMs: 3600, winOnTimeout: false,
      mount: function (ctx) {
        var zoneFloor = (ctx.round || 1) >= 13 ? 15 : 19;
        var zoneWidth = Math.max(zoneFloor, 24 / ctx.speed);
        var zoneLeft = 50 - zoneWidth / 2;
        var bar = el('div', 'mg-bar');
        var zone = el('div', 'mg-bar-zone');
        zone.style.left = zoneLeft + '%';
        zone.style.width = zoneWidth + '%';
        var marker = el('div', 'mg-bar-marker');
        bar.appendChild(zone);
        bar.appendChild(marker);
        ctx.root.appendChild(bar);
        ctx.root.appendChild(el('p', 'mg-sub', '가운데서 탭!'));

        var period = Math.max(550, 950 / ctx.speed);
        var phase = ctx.rng() * Math.PI * 2;
        var pos = 50, raf = null, t0 = null, done = false;
        function frame(ts) {
          if (t0 === null) t0 = ts;
          pos = 50 + Math.sin(phase + ((ts - t0) / period) * Math.PI * 2) * 46;
          marker.style.left = pos + '%';
          raf = requestAnimationFrame(frame);
        }
        raf = requestAnimationFrame(frame);
        function onTap() {
          if (done) return;
          done = true;
          if (pos >= zoneLeft && pos <= zoneLeft + zoneWidth) ctx.success();
          else ctx.fail();
        }
        ctx.root.addEventListener('pointerdown', onTap);
        return function () {
          if (raf) cancelAnimationFrame(raf);
          ctx.root.removeEventListener('pointerdown', onTap);
        };
      },
    },
  ];

  window.SurpriseMicrogames = {
    list: GAMES,
    byId: GAMES.reduce(function (map, g) { map[g.id] = g; return map; }, {}),
    catalog: GAMES.map(function (g) { return { id: g.id, baseMs: g.baseMs }; }),
  };
})();
