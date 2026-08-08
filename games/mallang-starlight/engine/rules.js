(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangStarlightRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function key(x, y) { return x + ',' + y; }
  function actionKey(action) {
    var objectId = action.targetId || action.itemId || action.deviceId || action.objectId || '';
    return [
      action.type,
      action.actorId,
      objectId,
      action.from ? key(action.from.x, action.from.y) : '',
      action.to ? key(action.to.x, action.to.y) : '',
      action.at ? key(action.at.x, action.at.y) : ''
    ].join('|');
  }
  function inBounds(state, x, y) {
    return x >= 0 && y >= 0 && x < state.width && y < state.height;
  }
  function getUnit(state, id) {
    return state.units.find(function (unit) { return unit.id === id; }) || null;
  }
  function getUnitAt(state, x, y, exceptId) {
    return state.units.find(function (unit) {
      return unit.hp > 0 && unit.id !== exceptId && unit.x === x && unit.y === y;
    }) || null;
  }
  function getProp(state, id) {
    return (state.props || []).find(function (prop) { return prop.id === id; }) || null;
  }
  function getPropAt(state, x, y) {
    return (state.props || []).find(function (prop) {
      return !prop.delivered && !prop.carriedBy && prop.x === x && prop.y === y;
    }) || null;
  }
  function aliveUnits(state, team) {
    return state.units.filter(function (unit) { return unit.hp > 0 && (!team || unit.team === team); });
  }
  function isPassableTerrain(state, x, y) {
    return inBounds(state, x, y) && state.terrain[y][x] === 0;
  }
  function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

  function normalizeSeed(seed) {
    seed = Number(seed) >>> 0;
    return seed || 0x6d2b79f5;
  }
  function nextRandom(rngState) {
    var seed = normalizeSeed(rngState && rngState.seed);
    seed = (seed + 0x6d2b79f5) >>> 0;
    var t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: { seed: seed } };
  }
  function advanceRng(state, randomSource) {
    var source = randomSource || nextRandom;
    var roll = source(clone(state.rng));
    if (!roll || typeof roll.value !== 'number' || !roll.state) throw new Error('randomSource must return { value, state }');
    state.rng = clone(roll.state);
    return roll;
  }
  function drawRandom(state, randomSource) {
    var next = clone(state);
    var draw = advanceRng(next, randomSource);
    return { value: draw.value, state: next };
  }

  function createState(config) {
    var state = clone(config);
    state.version = state.version || 1;
    state.width = state.width || (state.terrain && state.terrain[0] ? state.terrain[0].length : 0);
    state.height = state.height || (state.terrain ? state.terrain.length : 0);
    state.phase = state.phase || 'you';
    state.turn = state.turn || 1;
    state.status = state.status || 'active';
    state.rng = { seed: normalizeSeed(state.rng && state.rng.seed) };
    state.objective = state.objective || { type: 'eliminate', targetTeam: 'foe', text: '오작동 장난감을 모두 멈추세요' };
    state.props = (state.props || []).map(function (prop) {
      if (prop.active == null) prop.active = false;
      if (prop.delivered == null) prop.delivered = false;
      if (prop.carriedBy == null) prop.carriedBy = null;
      return prop;
    });
    state.units.forEach(function (unit) {
      if (unit.maxHp == null) unit.maxHp = unit.hp;
      if (unit.range == null) unit.range = unit.rng == null ? 1 : unit.rng;
      delete unit.rng;
      unit.acted = Boolean(unit.acted);
      unit.moved = Boolean(unit.moved);
      unit.carrying = Array.isArray(unit.carrying) ? unit.carrying.slice() : [];
      unit.guardBonus = Number(unit.guardBonus) || 0;
      unit.guardedBy = unit.guardedBy || null;
    });
    var verdict = evaluateObjective(state);
    state.status = verdict.status;
    return state;
  }

  function computeReachable(state, actorId) {
    var actor = getUnit(state, actorId);
    if (!actor || actor.hp <= 0) return [];
    var moveBudget = actor.moved ? 0 : actor.mov;
    var start = key(actor.x, actor.y);
    var nodes = {};
    nodes[start] = { x: actor.x, y: actor.y, cost: 0, path: [] };
    var queue = [nodes[start]];
    for (var qi = 0; qi < queue.length; qi += 1) {
      var current = queue[qi];
      DIRS.forEach(function (dir) {
        var nx = current.x + dir[0], ny = current.y + dir[1], nk = key(nx, ny);
        if (!isPassableTerrain(state, nx, ny)) return;
        var occupied = getUnitAt(state, nx, ny, actor.id);
        if (occupied && occupied.team !== actor.team) return;
        var nextCost = current.cost + 1;
        if (nextCost > moveBudget || (nodes[nk] && nodes[nk].cost <= nextCost)) return;
        nodes[nk] = { x: nx, y: ny, cost: nextCost, path: current.path.concat([{ x: nx, y: ny }]) };
        queue.push(nodes[nk]);
      });
    }
    return Object.keys(nodes).map(function (nodeKey) { return nodes[nodeKey]; })
      .filter(function (node) { return !getUnitAt(state, node.x, node.y, actor.id); })
      .sort(function (a, b) { return a.cost - b.cost || a.y - b.y || a.x - b.x; });
  }

  function greatestCommonDivisor(a, b) {
    while (b) { var next = a % b; a = b; b = next; }
    return a;
  }
  function hasLineOfSight(state, from, to) {
    var dx = to.x - from.x, dy = to.y - from.y;
    var distance = Math.abs(dx) + Math.abs(dy);
    if (distance <= 1) return true;
    var steps = greatestCommonDivisor(Math.abs(dx), Math.abs(dy));
    if (steps <= 1) return true;
    var sx = dx / steps, sy = dy / steps;
    for (var i = 1; i < steps; i += 1) {
      var x = from.x + sx * i, y = from.y + sy * i;
      if (!inBounds(state, x, y) || state.terrain[y][x] !== 0) return false;
    }
    return true;
  }
  function canAttackFrom(state, actor, target, from) {
    if (!actor || !target || actor.hp <= 0 || target.hp <= 0 || actor.team === target.team) return false;
    var origin = from || actor;
    var distance = manhattan(origin, target);
    return distance > 0 && distance <= actor.range && hasLineOfSight(state, origin, target);
  }

  function threatTilesFrom(state, actor, from) {
    var out = [];
    for (var y = 0; y < state.height; y += 1) for (var x = 0; x < state.width; x += 1) {
      var tile = { x: x, y: y };
      var distance = manhattan(from, tile);
      if (isPassableTerrain(state, x, y) && distance > 0 && distance <= actor.range && hasLineOfSight(state, from, tile)) out.push(tile);
    }
    return out;
  }

  function itemCarriedBy(state, itemId) {
    return state.units.find(function (unit) { return unit.hp > 0 && unit.carrying && unit.carrying.indexOf(itemId) >= 0; }) || null;
  }
  function extraRangeFor(actor) {
    return actor && actor.role === 'marksman' ? 1 : 0;
  }
  function canUseSpecialShotFrom(state, actor, target, from) {
    if (!actor || actor.role !== 'marksman') return false;
    if (!target || target.hp <= 0 || target.team === actor.team) return false;
    var origin = from || actor;
    var distance = manhattan(origin, target);
    return distance > actor.range && distance <= actor.range + extraRangeFor(actor) && hasLineOfSight(state, origin, target);
  }
  function adjacentAllies(state, actor, from) {
    return aliveUnits(state, actor.team).filter(function (unit) {
      return unit.id !== actor.id && manhattan(from, unit) === 1;
    });
  }
  function guardMitigation(unit) {
    return Math.max(0, Number(unit && unit.guardBonus) || 0);
  }

  function specialActionsAt(state, actor, from, path) {
    var objective = state.objective || {};
    var actions = [];
    if (objective.type === 'deliver-and-escape') {
      var item = getProp(state, objective.itemId);
      if (item && !item.delivered && !item.carriedBy && from.x === objective.pickupAt.x && from.y === objective.pickupAt.y && actor.team === (objective.carrierTeam || 'you')) {
        actions.push({ type: 'pickup-item', actorId: actor.id, itemId: objective.itemId, from: clone(from), at: clone(from), path: clone(path || []) });
      }
      if (actor.carrying && actor.carrying.indexOf(objective.itemId) >= 0 && from.x === objective.escapeAt.x && from.y === objective.escapeAt.y) {
        actions.push({ type: 'escape-with-item', actorId: actor.id, itemId: objective.itemId, from: clone(from), at: clone(from), path: clone(path || []) });
      }
    }
    if (objective.type === 'activate-then-defeat-boss') {
      (objective.controlStars || []).forEach(function (star) {
        var prop = getProp(state, star.id);
        if (prop && !prop.active && from.x === star.x && from.y === star.y) {
          actions.push({ type: 'activate-device', actorId: actor.id, deviceId: star.id, from: clone(from), at: clone(from), path: clone(path || []) });
        }
      });
    }
    if (actor.role === 'guardian') {
      actions.push({ type: 'guard-stance', actorId: actor.id, from: clone(from), path: clone(path || []) });
    }
    if (actor.role === 'marksman') {
      aliveUnits(state).forEach(function (target) {
        if (canUseSpecialShotFrom(state, actor, target, from)) {
          actions.push({ type: 'special-shot', actorId: actor.id, targetId: target.id, from: clone(from), path: clone(path || []) });
        }
      });
    }
    return actions;
  }

  function listLegalActions(state, actorId, options) {
    options = options || {};
    var actor = getUnit(state, actorId);
    if (!actor || actor.hp <= 0 || actor.acted || state.status !== 'active' || (!options.ignorePhase && actor.team !== state.phase)) return [];
    var reachable = computeReachable(state, actorId);
    var actions = [];
    reachable.forEach(function (node) {
      var from = { x: node.x, y: node.y };
      if (node.x !== actor.x || node.y !== actor.y) {
        actions.push({ type: 'move', actorId: actor.id, to: from, path: clone(node.path) });
      }
      aliveUnits(state).forEach(function (target) {
        if (canAttackFrom(state, actor, target, from)) {
          actions.push({ type: 'attack', actorId: actor.id, targetId: target.id, from: from, path: clone(node.path) });
        }
      });
      specialActionsAt(state, actor, from, node.path).forEach(function (action) { actions.push(action); });
      actions.push({ type: 'wait', actorId: actor.id, from: from, path: clone(node.path) });
      if (options.includeThreatTiles) {
        threatTilesFrom(state, actor, from).forEach(function (tile) {
          actions.push({ type: 'threat', actorId: actor.id, from: from, to: tile });
        });
      }
    });
    var unique = {};
    actions.forEach(function (action) { unique[actionKey(action)] = action; });
    return Object.keys(unique).sort().map(function (id) { return unique[id]; });
  }

  function fixedDamage(attacker, defender) { return Math.max(1, attacker.atk - defender.def - guardMitigation(defender)); }
  function specialShotDamage(attacker, defender) { return Math.max(1, attacker.atk + 1 - defender.def - guardMitigation(defender)); }

  function forecastAction(state, action) {
    if (!action) return null;
    if (action.type === 'move' || action.type === 'wait') {
      return { type: action.type, actorId: action.actorId, from: clone(action.to || action.from), consumesAction: action.type === 'wait' };
    }
    if (action.type === 'pickup-item' || action.type === 'escape-with-item' || action.type === 'activate-device' || action.type === 'guard-stance') {
      return { type: action.type, actorId: action.actorId, from: clone(action.from || action.at), itemId: action.itemId || null, deviceId: action.deviceId || null };
    }
    if (action.type !== 'attack' && action.type !== 'special-shot') return null;
    var sim = clone(state);
    var attacker = getUnit(sim, action.actorId), defender = getUnit(sim, action.targetId);
    if (!attacker || !defender) return null;
    attacker.x = action.from.x;
    attacker.y = action.from.y;
    var damage = action.type === 'special-shot' ? specialShotDamage(attacker, defender) : fixedDamage(attacker, defender);
    var defenderAfter = Math.max(0, defender.hp - damage);
    var counter = 0;
    if (action.type === 'attack' && defenderAfter > 0 && canAttackFrom(sim, defender, attacker, defender)) counter = fixedDamage(defender, attacker);
    return {
      type: action.type,
      actorId: attacker.id,
      targetId: defender.id,
      damage: damage,
      targetHpBefore: defender.hp,
      targetHpAfter: defenderAfter,
      targetStopped: defenderAfter === 0,
      counterDamage: counter,
      actorHpBefore: attacker.hp,
      actorHpAfter: Math.max(0, attacker.hp - counter),
      actorStopped: counter >= attacker.hp
    };
  }

  function equivalentAction(a, b) { return actionKey(a) === actionKey(b); }

  function evaluateObjective(state) {
    if (aliveUnits(state, 'you').length === 0) return { status: 'defeat', reason: '친구들의 기운이 모두 소진됐어요.' };
    var objective = state.objective || {};
    if (objective.turnLimit && state.turn > objective.turnLimit) {
      return { status: 'defeat', reason: (objective.turnLimit || 0) + '턴 안에 목표를 끝내지 못했어요.' };
    }
    if (objective.type === 'eliminate' && aliveUnits(state, objective.targetTeam || 'foe').length === 0) {
      return { status: 'victory', reason: '오작동 장난감을 모두 멈췄어요.' };
    }
    if (objective.type === 'deliver-and-escape') {
      var item = getProp(state, objective.itemId);
      var carrier = itemCarriedBy(state, objective.itemId);
      if (item && item.delivered) return { status: 'victory', reason: '별빛 배터리를 무사히 전달했어요.' };
      if (objective.failOnCarrierDown && item && item.carriedBy && !carrier) return { status: 'defeat', reason: '배터리를 들고 있던 친구가 쓰러졌어요.' };
      return { status: 'active', reason: '' };
    }
    if (objective.type === 'activate-then-defeat-boss') {
      var activeCount = (state.props || []).filter(function (prop) { return prop.kind === 'control-star' && prop.active; }).length;
      var boss = getUnit(state, objective.bossId);
      if (activeCount >= (objective.requiredActiveCount || 0) && (!boss || boss.hp <= 0)) {
        return { status: 'victory', reason: '제어별을 켜고 보스를 멈췄어요.' };
      }
      return { status: 'active', reason: '' };
    }
    return { status: 'active', reason: '' };
  }
  function consumeGuard(unit) {
    if (!unit || !guardMitigation(unit)) return;
    unit.guardBonus = 0;
    unit.guardedBy = null;
  }

  function applyAction(state, action, randomSource) {
    var legal = listLegalActions(state, action.actorId).some(function (candidate) { return equivalentAction(candidate, action); });
    if (!legal) return { ok: false, state: clone(state), events: [{ type: 'invalid-action', action: clone(action) }] };
    var next = clone(state);
    var events = [];
    advanceRng(next, randomSource);
    var actor = getUnit(next, action.actorId);
    if (!actor) return { ok: false, state: clone(state), events: [{ type: 'invalid-action', action: clone(action) }] };
    if (action.type === 'move') {
      actor.x = action.to.x;
      actor.y = action.to.y;
      actor.moved = true;
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.to), path: clone(action.path || []) });
    } else if (action.type === 'wait') {
      actor.x = action.from.x;
      actor.y = action.from.y;
      actor.moved = true;
      actor.acted = true;
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.from), path: clone(action.path || []) });
      events.push({ type: 'unit-waited', unitId: actor.id });
    } else if (action.type === 'attack' || action.type === 'special-shot') {
      actor.x = action.from.x;
      actor.y = action.from.y;
      actor.moved = true;
      var defender = getUnit(next, action.targetId);
      var forecast = forecastAction(next, action);
      defender.hp = forecast.targetHpAfter;
      consumeGuard(defender);
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.from), path: clone(action.path || []) });
      events.push({ type: 'unit-hit', sourceId: actor.id, targetId: defender.id, amount: forecast.damage, special: action.type === 'special-shot' });
      if (defender.hp === 0) events.push({ type: 'unit-stopped', unitId: defender.id });
      if (forecast.counterDamage > 0) {
        actor.hp = forecast.actorHpAfter;
        consumeGuard(actor);
        events.push({ type: 'unit-hit', sourceId: defender.id, targetId: actor.id, amount: forecast.counterDamage, counter: true });
        if (actor.hp === 0) events.push({ type: 'unit-stopped', unitId: actor.id });
      }
      actor.acted = true;
    } else if (action.type === 'guard-stance') {
      actor.x = action.from.x;
      actor.y = action.from.y;
      actor.moved = true;
      actor.acted = true;
      actor.guardBonus = Math.max(actor.guardBonus || 0, 2);
      adjacentAllies(next, actor, actor).forEach(function (ally) {
        ally.guardBonus = Math.max(ally.guardBonus || 0, 2);
        ally.guardedBy = actor.id;
      });
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.from), path: clone(action.path || []) });
      events.push({ type: 'guard-applied', unitId: actor.id });
    } else if (action.type === 'pickup-item') {
      actor.x = action.from.x;
      actor.y = action.from.y;
      actor.moved = true;
      actor.acted = true;
      if (actor.carrying.indexOf(action.itemId) === -1) actor.carrying.push(action.itemId);
      var item = getProp(next, action.itemId);
      if (item) item.carriedBy = actor.id;
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.from), path: clone(action.path || []) });
      events.push({ type: 'item-picked', unitId: actor.id, itemId: action.itemId });
    } else if (action.type === 'escape-with-item') {
      actor.x = action.from.x;
      actor.y = action.from.y;
      actor.moved = true;
      actor.acted = true;
      actor.carrying = actor.carrying.filter(function (itemId) { return itemId !== action.itemId; });
      var delivered = getProp(next, action.itemId);
      if (delivered) {
        delivered.carriedBy = null;
        delivered.delivered = true;
        delivered.x = action.from.x;
        delivered.y = action.from.y;
      }
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.from), path: clone(action.path || []) });
      events.push({ type: 'item-delivered', unitId: actor.id, itemId: action.itemId });
    } else if (action.type === 'activate-device') {
      actor.x = action.from.x;
      actor.y = action.from.y;
      actor.moved = true;
      actor.acted = true;
      var prop = getProp(next, action.deviceId);
      if (prop) prop.active = true;
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.from), path: clone(action.path || []) });
      events.push({ type: 'device-activated', unitId: actor.id, deviceId: action.deviceId });
    }
    var result = evaluateObjective(next);
    next.status = result.status;
    if (result.status !== 'active') events.push({ type: 'objective-ended', result: result.status });
    return { ok: true, state: next, events: events, objective: result };
  }

  function listThreatenedTiles(state, team) {
    var projected = clone(state);
    var tiles = {};
    aliveUnits(projected, team).forEach(function (unit) {
      unit.acted = false;
      unit.moved = false;
      listLegalActions(projected, unit.id, { includeThreatTiles: true, ignorePhase: true }).forEach(function (action) {
        if (action.type === 'threat') tiles[key(action.to.x, action.to.y)] = action.to;
      });
    });
    return Object.keys(tiles).sort().map(function (tileKey) { return tiles[tileKey]; });
  }

  function chooseAiAction(state, actorId) {
    var actor = getUnit(state, actorId);
    var actions = listLegalActions(state, actorId);
    if (!actor || actions.length === 0) return null;
    var attacks = actions.filter(function (action) { return action.type === 'attack'; });
    if (attacks.length) {
      attacks.sort(function (a, b) {
        var fa = forecastAction(state, a), fb = forecastAction(state, b);
        var sa = (fa.targetStopped ? 10000 : 0) + fa.damage * 100 - fa.targetHpAfter;
        var sb = (fb.targetStopped ? 10000 : 0) + fb.damage * 100 - fb.targetHpAfter;
        return sb - sa || actionKey(a).localeCompare(actionKey(b));
      });
      return attacks[0];
    }
    var targets = aliveUnits(state, actor.team === 'you' ? 'foe' : 'you');
    var waits = actions.filter(function (action) { return action.type === 'wait'; });
    waits.sort(function (a, b) {
      function nearest(action) {
        return targets.reduce(function (best, target) { return Math.min(best, manhattan(action.from, target)); }, Infinity);
      }
      return nearest(a) - nearest(b) || actionKey(a).localeCompare(actionKey(b));
    });
    return waits[0] || null;
  }

  // 다가올 장난감 페이즈를 상태를 바꾸지 않고 그대로 시뮬레이션해 각 장난감의 의도를
  // 미리 알려준다. 고정 피해라 예고는 실제 결과와 정확히 일치한다. RNG는 시뮬레이션
  // 사본에서만 전진하므로 원본 상태·스트림은 변하지 않는다.
  function forecastEnemyPhase(state) {
    var result = { intents: [], damageTo: {}, stopped: [], hpAfter: {}, anyThreat: false };
    if (!state || state.status !== 'active') return result;
    var sim = clone(state);
    if (sim.phase === 'you') sim = endPhase(sim);
    if (sim.phase !== 'foe' || sim.status !== 'active') return result;
    var startHp = {};
    aliveUnits(state, 'you').forEach(function (unit) { startHp[unit.id] = unit.hp; });
    var foes = aliveUnits(sim, 'foe').map(function (unit) { return unit.id; });
    for (var i = 0; i < foes.length; i += 1) {
      if (sim.status !== 'active') break;
      var mover = getUnit(sim, foes[i]);
      if (!mover || mover.hp <= 0) continue;
      var action = chooseAiAction(sim, foes[i]);
      if (!action) continue;
      var intent = { unitId: foes[i], type: action.type };
      if (action.to) intent.to = { x: action.to.x, y: action.to.y };
      if (action.from) intent.from = { x: action.from.x, y: action.from.y };
      if (action.type === 'attack' || action.type === 'special-shot') {
        var forecast = forecastAction(sim, action);
        if (forecast) {
          intent.targetId = action.targetId;
          intent.damage = forecast.damage;
          intent.stops = forecast.targetStopped;
          result.damageTo[action.targetId] = (result.damageTo[action.targetId] || 0) + forecast.damage;
          result.anyThreat = true;
        }
      }
      result.intents.push(intent);
      var applied = applyAction(sim, action);
      if (applied.ok) sim = applied.state;
    }
    aliveUnits(state, 'you').forEach(function (unit) {
      var after = getUnit(sim, unit.id);
      var hp = after ? Math.max(0, after.hp) : 0;
      result.hpAfter[unit.id] = hp;
      if (startHp[unit.id] > 0 && hp <= 0) result.stopped.push(unit.id);
    });
    return result;
  }

  function endPhase(state) {
    var next = clone(state);
    if (next.phase === 'you') next.phase = 'foe';
    else {
      next.phase = 'you';
      next.turn += 1;
    }
    if (next.phase === 'you') {
      next.units.forEach(function (unit) {
        unit.guardBonus = 0;
        unit.guardedBy = null;
      });
    }
    next.units.forEach(function (unit) {
      if (unit.team === next.phase) {
        unit.acted = false;
        unit.moved = false;
      }
    });
    var result = evaluateObjective(next);
    next.status = result.status;
    return next;
  }

  return {
    clone: clone,
    key: key,
    createState: createState,
    nextRandom: nextRandom,
    drawRandom: drawRandom,
    getUnit: getUnit,
    getUnitAt: getUnitAt,
    getProp: getProp,
    getPropAt: getPropAt,
    aliveUnits: aliveUnits,
    computeReachable: computeReachable,
    hasLineOfSight: hasLineOfSight,
    canAttackFrom: canAttackFrom,
    listLegalActions: listLegalActions,
    fixedDamage: fixedDamage,
    forecastAction: forecastAction,
    applyAction: applyAction,
    evaluateObjective: evaluateObjective,
    listThreatenedTiles: listThreatenedTiles,
    forecastEnemyPhase: forecastEnemyPhase,
    chooseAiAction: chooseAiAction,
    endPhase: endPhase,
    actionKey: actionKey
  };
});
