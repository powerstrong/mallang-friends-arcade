(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangTacticsRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function key(x, y) { return x + ',' + y; }
  function actionKey(a) {
    return [a.type, a.actorId, a.targetId || '', a.from ? key(a.from.x, a.from.y) : '',
      a.to ? key(a.to.x, a.to.y) : ''].join('|');
  }
  function inBounds(state, x, y) {
    return x >= 0 && y >= 0 && x < state.width && y < state.height;
  }
  function getUnit(state, id) {
    return state.units.find(function (u) { return u.id === id; }) || null;
  }
  function getUnitAt(state, x, y, exceptId) {
    return state.units.find(function (u) {
      return u.hp > 0 && u.id !== exceptId && u.x === x && u.y === y;
    }) || null;
  }
  function aliveUnits(state, team) {
    return state.units.filter(function (u) { return u.hp > 0 && (!team || u.team === team); });
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
    if (!roll || typeof roll.value !== 'number' || !roll.state) {
      throw new Error('randomSource must return { value, state }');
    }
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
    state.units.forEach(function (u) {
      if (u.maxHp == null) u.maxHp = u.hp;
      if (u.range == null) u.range = u.rng == null ? 1 : u.rng;
      delete u.rng;
      u.acted = Boolean(u.acted);
      u.moved = Boolean(u.moved);
    });
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
      .filter(function (node) {
        var occupied = getUnitAt(state, node.x, node.y, actor.id);
        return !occupied;
      }).sort(function (a, b) { return a.cost - b.cost || a.y - b.y || a.x - b.x; });
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
  function greatestCommonDivisor(a, b) {
    while (b) { var next = a % b; a = b; b = next; }
    return a;
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
      if (distance > 0 && distance <= actor.range && hasLineOfSight(state, from, tile)) out.push(tile);
    }
    return out;
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

  function fixedDamage(attacker, defender) { return Math.max(1, attacker.atk - defender.def); }

  function forecastAction(state, action) {
    if (!action) return null;
    if (action.type === 'move' || action.type === 'wait') {
      return { type: action.type, actorId: action.actorId, from: clone(action.to || action.from), consumesAction: action.type === 'wait' };
    }
    if (action.type !== 'attack') return null;
    var sim = clone(state);
    var attacker = getUnit(sim, action.actorId), defender = getUnit(sim, action.targetId);
    if (!attacker || !defender) return null;
    attacker.x = action.from.x; attacker.y = action.from.y;
    var damage = fixedDamage(attacker, defender);
    var defenderAfter = Math.max(0, defender.hp - damage);
    var counter = 0;
    if (defenderAfter > 0 && canAttackFrom(sim, defender, attacker, defender)) counter = fixedDamage(defender, attacker);
    return {
      type: 'attack', actorId: attacker.id, targetId: defender.id, damage: damage,
      targetHpBefore: defender.hp, targetHpAfter: defenderAfter, targetStopped: defenderAfter === 0,
      counterDamage: counter, actorHpBefore: attacker.hp, actorHpAfter: Math.max(0, attacker.hp - counter),
      actorStopped: counter >= attacker.hp
    };
  }

  function equivalentAction(a, b) { return actionKey(a) === actionKey(b); }
  function applyAction(state, action, randomSource) {
    var legal = listLegalActions(state, action.actorId).some(function (candidate) { return equivalentAction(candidate, action); });
    if (!legal) return { ok: false, state: clone(state), events: [{ type: 'invalid-action', action: clone(action) }] };
    var next = clone(state), events = [];
    // Every committed action advances the injected RNG stream, even if the current
    // resolution is fixed-damage. This keeps replay/input logs deterministic and
    // preserves one explicit randomness channel for future mechanics.
    advanceRng(next, randomSource);
    var actor = getUnit(next, action.actorId);
    if (action.type === 'move') {
      actor.x = action.to.x; actor.y = action.to.y;
      actor.moved = true;
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.to), path: clone(action.path || []) });
    } else if (action.type === 'wait') {
      actor.x = action.from.x; actor.y = action.from.y; actor.moved = true; actor.acted = true;
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.from), path: clone(action.path || []) });
      events.push({ type: 'unit-waited', unitId: actor.id });
    } else if (action.type === 'attack') {
      actor.x = action.from.x; actor.y = action.from.y;
      actor.moved = true;
      var defender = getUnit(next, action.targetId);
      var forecast = forecastAction(next, action);
      defender.hp = forecast.targetHpAfter;
      events.push({ type: 'unit-moved', unitId: actor.id, to: clone(action.from), path: clone(action.path || []) });
      events.push({ type: 'unit-hit', sourceId: actor.id, targetId: defender.id, amount: forecast.damage });
      if (defender.hp === 0) events.push({ type: 'unit-stopped', unitId: defender.id });
      if (forecast.counterDamage > 0) {
        actor.hp = forecast.actorHpAfter;
        events.push({ type: 'unit-hit', sourceId: defender.id, targetId: actor.id, amount: forecast.counterDamage, counter: true });
        if (actor.hp === 0) events.push({ type: 'unit-stopped', unitId: actor.id });
      }
      actor.acted = true;
    }
    var result = evaluateObjective(next);
    if (result.status !== 'active') { next.status = result.status; events.push({ type: 'objective-ended', result: result.status }); }
    return { ok: true, state: next, events: events, objective: result };
  }

  function evaluateObjective(state) {
    if (aliveUnits(state, 'you').length === 0) return { status: 'defeat', reason: '친구들의 기운이 모두 소진됐어요.' };
    if (state.objective.type === 'eliminate' && aliveUnits(state, state.objective.targetTeam || 'foe').length === 0) {
      return { status: 'victory', reason: '오작동 장난감을 모두 멈췄어요.' };
    }
    return { status: 'active', reason: '' };
  }

  function listThreatenedTiles(state, team) {
    var projected = clone(state);
    var tiles = {};
    aliveUnits(projected, team).forEach(function (unit) {
      // Threats describe the unit's next available activation, not flags left over
      // from its previous phase. The actual tiles still come from the shared action generator.
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
    var attacks = actions.filter(function (a) { return a.type === 'attack'; });
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
    var waits = actions.filter(function (a) { return a.type === 'wait'; });
    waits.sort(function (a, b) {
      function nearest(action) {
        return targets.reduce(function (best, target) { return Math.min(best, manhattan(action.from, target)); }, Infinity);
      }
      return nearest(a) - nearest(b) || actionKey(a).localeCompare(actionKey(b));
    });
    return waits[0] || null;
  }

  function endPhase(state) {
    var next = clone(state);
    if (next.phase === 'you') next.phase = 'foe';
    else { next.phase = 'you'; next.turn += 1; }
    next.units.forEach(function (unit) { if (unit.team === next.phase) { unit.acted = false; unit.moved = false; } });
    return next;
  }

  return {
    clone: clone, key: key, createState: createState, nextRandom: nextRandom, drawRandom: drawRandom,
    getUnit: getUnit, getUnitAt: getUnitAt, aliveUnits: aliveUnits, computeReachable: computeReachable,
    hasLineOfSight: hasLineOfSight, canAttackFrom: canAttackFrom, listLegalActions: listLegalActions,
    fixedDamage: fixedDamage, forecastAction: forecastAction, applyAction: applyAction,
    evaluateObjective: evaluateObjective, listThreatenedTiles: listThreatenedTiles,
    chooseAiAction: chooseAiAction, endPhase: endPhase, actionKey: actionKey
  };
});
