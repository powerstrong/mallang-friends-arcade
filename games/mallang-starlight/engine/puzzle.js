/*
 * 별빛 구조 퍼즐 — 순수 결정론 엔진
 *
 * 핵심: 장난감(toy)은 매 비트 시작에 "예고된 행동(intent)"을 가진다. 플레이어는 두
 * 친구에게 (이동 + 밀기/당기기) 명령을 예약하고, 그 결과가 비트 전체로 미리 보인다.
 * `출동!` = applyBeat 한 번으로 (친구 이동 → 친구 능력 → 장난감 예고 실행 → 충돌/수리)
 * 를 결정론적으로 해결한다. 예고의 방향(dir/type)은 비트 시작에 고정되고, 친구가 장난감을
 * 밀면 "원점"만 바뀌어 예고가 빗나가거나 벽/다른 장난감/수리별로 재배선된다.
 *
 * 상태는 JSON 직렬화 가능한 평범한 객체/배열이며 DOM·타이머·함수를 담지 않는다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangPuzzle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRS = [
    { x: 1, y: 0, name: 'right' },
    { x: -1, y: 0, name: 'left' },
    { x: 0, y: 1, name: 'down' },
    { x: 0, y: -1, name: 'up' }
  ];

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function key(x, y) { return x + ',' + y; }
  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
  function inBounds(s, x, y) { return x >= 0 && y >= 0 && x < s.width && y < s.height; }
  function isWall(s, x, y) { return !inBounds(s, x, y) || s.terrain[y][x] === 1; }
  function friendAt(s, x, y, exceptId) {
    return s.friends.find(function (f) { return f.hearts > 0 && f.id !== exceptId && f.x === x && f.y === y; }) || null;
  }
  function toyAt(s, x, y) {
    return s.toys.find(function (t) { return !t.fixed && t.x === x && t.y === y; }) || null;
  }
  function propAt(s, x, y, kind) {
    return (s.props || []).find(function (p) { return p.x === x && p.y === y && (!kind || p.kind === kind); }) || null;
  }
  function getFriend(s, id) { return s.friends.find(function (f) { return f.id === id; }) || null; }
  function getToy(s, id) { return s.toys.find(function (t) { return t.id === id; }) || null; }
  function activeToys(s) { return s.toys.filter(function (t) { return !t.fixed; }); }
  function activeFriends(s) { return s.friends.filter(function (f) { return f.hearts > 0; }); }
  function occupied(s, x, y, exceptFriendId) {
    return isWall(s, x, y) || toyAt(s, x, y) || friendAt(s, x, y, exceptFriendId);
  }

  function createState(config) {
    var s = clone(config);
    s.version = s.version || 1;
    s.width = s.width || (s.terrain && s.terrain[0] ? s.terrain[0].length : 0);
    s.height = s.height || (s.terrain ? s.terrain.length : 0);
    s.beat = s.beat || 1;
    s.status = 'active';
    s.props = (s.props || []).map(function (p) { return p; });
    s.friends = (s.friends || []).map(function (f) {
      if (f.maxHearts == null) f.maxHearts = f.hearts == null ? 2 : f.hearts;
      if (f.hearts == null) f.hearts = f.maxHearts;
      return f;
    });
    s.toys = (s.toys || []).map(function (t) {
      if (t.repair == null) t.repair = 1;
      if (t.gauge == null) t.gauge = t.repair;
      t.fixed = Boolean(t.fixed) || t.gauge <= 0;
      return t;
    });
    computeIntents(s);
    s.status = evaluate(s).status;
    return s;
  }

  // ── 예고(intent) 계산: 비트 시작마다 role에 따라 결정론적으로 정한다. ──────────────
  function nearestFriend(s, from) {
    var best = null, bestD = Infinity;
    activeFriends(s).forEach(function (f) {
      var d = Math.abs(f.x - from.x) + Math.abs(f.y - from.y);
      if (d < bestD || (d === bestD && best && (f.y < best.y || (f.y === best.y && f.x < best.x)))) { best = f; bestD = d; }
    });
    return best;
  }
  function facingToward(from, target) {
    var dx = target.x - from.x, dy = target.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) return { x: sign(dx) || 1, y: 0 };
    return { x: 0, y: sign(dy) };
  }
  function computeIntents(s) {
    activeToys(s).forEach(function (t) {
      if (t.kind === 'turret') {
        // 고정 포탑: 가장 가까운 친구를 향한 직선 방향으로 광선을 쏜다.
        var target = nearestFriend(s, t);
        t.intent = { type: 'beam', dir: target ? facingToward(t, target) : (t.dir || { x: 1, y: 0 }), len: t.range || 3 };
      } else {
        // 삐걱봇(돌진): 가장 가까운 친구 방향으로 dist칸 돌진한다.
        var f = nearestFriend(s, t);
        t.intent = { type: 'dash', dir: f ? facingToward(t, f) : (t.dir || { x: 1, y: 0 }), dist: t.mov || 2 };
      }
    });
  }

  // ── 도달 가능 칸(친구 이동): 벽·장난감·다른 친구가 막는다. ─────────────────────────
  function reachable(s, friendId) {
    var actor = getFriend(s, friendId);
    if (!actor || actor.hearts <= 0) return [];
    var budget = actor.mov == null ? 2 : actor.mov;
    var start = { x: actor.x, y: actor.y };
    var nodes = {}; nodes[key(start.x, start.y)] = { x: start.x, y: start.y, cost: 0, path: [] };
    var queue = [nodes[key(start.x, start.y)]];
    for (var i = 0; i < queue.length; i += 1) {
      var cur = queue[i];
      for (var d = 0; d < DIRS.length; d += 1) {
        var nx = cur.x + DIRS[d].x, ny = cur.y + DIRS[d].y, nk = key(nx, ny);
        if (occupied(s, nx, ny, actor.id)) continue;
        var cost = cur.cost + 1;
        if (cost > budget || (nodes[nk] && nodes[nk].cost <= cost)) continue;
        nodes[nk] = { x: nx, y: ny, cost: cost, path: cur.path.concat([{ x: nx, y: ny }]) };
        queue.push(nodes[nk]);
      }
    }
    return Object.keys(nodes).map(function (k) { return nodes[k]; })
      .sort(function (a, b) { return a.cost - b.cost || a.y - b.y || a.x - b.x; });
  }

  function lineClear(s, from, to) {
    // 직선(같은 행/열) 사이가 벽/장난감으로 막히지 않았는지. 끝점은 검사 안 함.
    var dx = sign(to.x - from.x), dy = sign(to.y - from.y);
    var x = from.x + dx, y = from.y + dy;
    while (x !== to.x || y !== to.y) {
      if (isWall(s, x, y) || toyAt(s, x, y)) return false;
      x += dx; y += dy;
    }
    return true;
  }

  // ── fromPos에서 쓸 수 있는 능력 목록 ────────────────────────────────────────────
  function abilitiesFrom(s, friend, fromPos) {
    var out = [];
    if (friend.role === 'pusher') {
      DIRS.forEach(function (d) {
        var t = toyAt(s, fromPos.x + d.x, fromPos.y + d.y);
        if (t) out.push({ type: 'push', toyId: t.id, dir: { x: d.x, y: d.y } });
      });
    } else if (friend.role === 'puller') {
      var range = friend.range || 3;
      activeToys(s).forEach(function (t) {
        if (t.x !== fromPos.x && t.y !== fromPos.y) return;         // 같은 행/열만
        var dist = Math.abs(t.x - fromPos.x) + Math.abs(t.y - fromPos.y);
        if (dist < 1 || dist > range) return;
        if (!lineClear(s, fromPos, t)) return;
        out.push({ type: 'pull', toyId: t.id });
      });
    }
    return out;
  }

  // 한 친구가 낼 수 있는 모든 명령(이동 목적지 × 능력, 이동만, 대기 포함)
  function listCommands(s, friendId) {
    var friend = getFriend(s, friendId);
    if (!friend || friend.hearts <= 0 || s.status !== 'active') return [];
    var out = [];
    reachable(s, friendId).forEach(function (node) {
      var to = { x: node.x, y: node.y };
      out.push({ friendId: friendId, to: to, ability: null });
      abilitiesFrom(s, friend, to).forEach(function (ab) {
        out.push({ friendId: friendId, to: to, ability: ab });
      });
    });
    return out;
  }

  function crash(events, toy) { toy.gauge -= 1; events.push({ type: 'toy-crash', toyId: toy.id, amount: 1 }); }
  function beamHitToy(events, toy) { toy.gauge -= 2; events.push({ type: 'toy-hit', toyId: toy.id, amount: 2 }); }
  function hurtFriend(events, friend) { friend.hearts -= 1; events.push({ type: 'friend-hit', friendId: friend.id, amount: 1 }); }

  function shoveToy(s, toy, dir, events) {
    // 1칸 이동 시도. 막히면 제자리 + 수리 게이지 −1(충돌).
    var nx = toy.x + dir.x, ny = toy.y + dir.y;
    if (isWall(s, nx, ny) || toyAt(s, nx, ny) || friendAt(s, nx, ny)) { crash(events, toy); return; }
    toy.x = nx; toy.y = ny;
    events.push({ type: 'toy-moved', toyId: toy.id, to: { x: nx, y: ny } });
  }

  function applyFriendAbility(s, friend, ability, events) {
    if (!ability) return;
    var toy = getToy(s, ability.toyId);
    if (!toy || toy.fixed) return;
    if (ability.type === 'push') {
      // 현재 위치 기준 인접 재확인(순차 적용으로 위치가 바뀌었을 수 있음).
      var dx = toy.x - friend.x, dy = toy.y - friend.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) return;
      shoveToy(s, toy, { x: sign(dx), y: sign(dy) }, events);
    } else if (ability.type === 'pull') {
      if (toy.x !== friend.x && toy.y !== friend.y) return;
      var dist = Math.abs(toy.x - friend.x) + Math.abs(toy.y - friend.y);
      if (dist < 1 || dist > (friend.range || 3) || !lineClear(s, friend, toy)) return;
      shoveToy(s, toy, { x: sign(friend.x - toy.x), y: sign(friend.y - toy.y) }, events);
    }
  }

  function runDash(s, toy, events) {
    var dir = toy.intent.dir, steps = toy.intent.dist || 2;
    for (var i = 0; i < steps; i += 1) {
      var nx = toy.x + dir.x, ny = toy.y + dir.y;
      if (isWall(s, nx, ny)) { crash(events, toy); break; }
      var other = toyAt(s, nx, ny);
      if (other) { crash(events, toy); crash(events, other); break; }
      var f = friendAt(s, nx, ny);
      if (f) { hurtFriend(events, f); break; }
      toy.x = nx; toy.y = ny;
      events.push({ type: 'toy-moved', toyId: toy.id, to: { x: nx, y: ny } });
    }
  }
  function runBeam(s, toy, events) {
    var dir = toy.intent.dir, len = toy.intent.len || 3;
    var x = toy.x, y = toy.y;
    for (var i = 0; i < len; i += 1) {
      x += dir.x; y += dir.y;
      if (isWall(s, x, y)) break;
      var t = toyAt(s, x, y); if (t) beamHitToy(events, t);
      var f = friendAt(s, x, y); if (f) hurtFriend(events, f);
    }
  }

  function beamTiles(s, toy) {
    var out = [], dir = toy.intent.dir, len = toy.intent.len || 3, x = toy.x, y = toy.y;
    for (var i = 0; i < len; i += 1) { x += dir.x; y += dir.y; if (isWall(s, x, y)) break; out.push({ x: x, y: y }); }
    return out;
  }

  function settleRepairs(s, events) {
    activeToys(s).forEach(function (t) {
      if (propAt(s, t.x, t.y, 'repair-star')) { t.gauge = 0; events.push({ type: 'toy-repaired-star', toyId: t.id }); }
    });
    s.toys.forEach(function (t) {
      if (!t.fixed && t.gauge <= 0) { t.fixed = true; events.push({ type: 'toy-fixed', toyId: t.id }); }
    });
  }

  // ── 비트 실행: commands = [{friendId,to,ability}] (친구당 최대 1개, 생략 = 대기) ──
  function validateCommands(s, commands) {
    var seen = {};
    for (var i = 0; i < commands.length; i += 1) {
      var c = commands[i];
      if (!c || seen[c.friendId]) return false;
      seen[c.friendId] = true;
      var legal = listCommands(s, c.friendId).some(function (cand) {
        return cand.to.x === c.to.x && cand.to.y === c.to.y &&
          (!!cand.ability === !!c.ability) &&
          (!c.ability || (cand.ability.type === c.ability.type && cand.ability.toyId === c.ability.toyId &&
            (c.ability.type !== 'push' || (cand.ability.dir.x === c.ability.dir.x && cand.ability.dir.y === c.ability.dir.y))));
      });
      if (!legal) return false;
    }
    // 두 친구가 같은 목적지로 가지 않는다.
    if (commands.length === 2 && commands[0].to.x === commands[1].to.x && commands[0].to.y === commands[1].to.y) return false;
    return true;
  }

  function applyBeat(s, commands) {
    commands = (commands || []).filter(Boolean);
    if (s.status !== 'active' || !validateCommands(s, commands)) {
      return { ok: false, state: clone(s), events: [{ type: 'invalid' }] };
    }
    var next = clone(s);
    var events = [];
    // 1) 친구 이동(동시).
    commands.forEach(function (c) { var f = getFriend(next, c.friendId); f.x = c.to.x; f.y = c.to.y; });
    // 2) 친구 능력(친구 id 정렬 순).
    commands.slice().sort(function (a, b) { return a.friendId < b.friendId ? -1 : 1; }).forEach(function (c) {
      applyFriendAbility(next, getFriend(next, c.friendId), c.ability, events);
    });
    settleRepairs(next, events);
    // 3) 장난감 예고 실행(toy id 정렬 순, 비트 시작에 고정된 intent 사용).
    activeToys(next).slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (t) {
      if (t.fixed) return;
      if (t.intent && t.intent.type === 'dash') runDash(next, t, events);
      else if (t.intent && t.intent.type === 'beam') runBeam(next, t, events);
    });
    settleRepairs(next, events);
    // 4) 다음 비트 준비: 예고 재계산.
    next.beat += 1;
    computeIntents(next);
    var verdict = evaluate(next);
    next.status = verdict.status;
    if (verdict.status !== 'active') events.push({ type: 'ended', result: verdict.status, reason: verdict.reason });
    return { ok: true, state: next, events: events, verdict: verdict };
  }

  function previewBeat(s, commands) {
    var res = applyBeat(s, commands);
    return res.ok ? res : null;
  }

  function evaluate(s) {
    var obj = s.objective || { type: 'repair-all' };
    if (activeFriends(s).length === 0) return { status: 'defeat', reason: '친구가 모두 지쳤어요.' };
    if (obj.type === 'repair-all') {
      if (activeToys(s).length === 0) return { status: 'victory', reason: '모든 장난감을 수리했어요!' };
    }
    if (obj.type === 'deliver') {
      var item = propAt(s, obj.escapeAt.x, obj.escapeAt.y, null);
      if (obj._delivered) return { status: 'victory', reason: '별빛 배터리를 옮겼어요!' };
    }
    if (obj.beatLimit && s.beat > obj.beatLimit) return { status: 'defeat', reason: obj.beatLimit + '비트 안에 끝내지 못했어요.' };
    return { status: 'active', reason: '' };
  }

  return {
    clone: clone, key: key, DIRS: DIRS,
    createState: createState,
    computeIntents: computeIntents,
    reachable: reachable,
    abilitiesFrom: abilitiesFrom,
    listCommands: listCommands,
    validateCommands: validateCommands,
    previewBeat: previewBeat,
    applyBeat: applyBeat,
    evaluate: evaluate,
    beamTiles: beamTiles,
    getFriend: getFriend, getToy: getToy, toyAt: toyAt, friendAt: friendAt, propAt: propAt,
    activeToys: activeToys, activeFriends: activeFriends, isWall: isWall, inBounds: inBounds
  };
});
