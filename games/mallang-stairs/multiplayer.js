/* Mallang Stairs relay transport. Game rules stay entirely in game.js/engine. */
(function () {
  'use strict';

  var SNAPSHOT_INTERVAL_MS = 130;
  function create() {
    var boot = window.GameBoot || {};
    var gameId = boot.gameId || 'mallang-stairs';
    var hasRelay = !!window.MallangRelay;
    var state = {
      available: hasRelay,
      isMulti: false,
      myId: boot.playerId || 'me',
      myName: boot.name || '말랑이',
      code: boot.code || null,
      roster: [],
      remotes: {},
      startedRunId: null,
    };

    var relay = null;
    var lastSendAt = 0;
    var cbs = { players: [], start: [], time: [], snapshot: [], change: [], char: [] };
    function fire(ev, arg) {
      (cbs[ev] || []).forEach(function (fn) {
        try { fn(arg); } catch (e) {}
      });
    }
    function normId(p) { return p && (p.playerId || p.id); }
    function rosterName(id) {
      var p = state.roster.find(function (r) { return normId(r) === id; });
      return (p && p.name) || id || '친구';
    }
    function rosterChar(id) {
      var p = state.roster.find(function (r) { return normId(r) === id; });
      return (p && p.characterId) || null;
    }

    function handleMessage(msg) {
      var from = msg.from;
      var p = msg.payload || {};
      if (!from || from === state.myId) return;

      if (p.t === 'start') {
        var runId = p.runId || String(Date.now());
        if (state.startedRunId !== runId) {
          state.startedRunId = runId;
          fire('start', { dur: p.dur, runId: runId });
        }
        return;
      }
      if (p.t === 'time') {
        fire('time', { sec: p.sec });
        return;
      }
      if (p.t === 'char') {
        var cr = state.remotes[from] || { id: from, name: rosterName(from) };
        cr.characterId = p.ch || cr.characterId || rosterChar(from);
        cr.name = p.name || cr.name || rosterName(from);
        state.remotes[from] = cr;
        fire('char', cr);
        fire('change');
        return;
      }
      if (p.t === 'snap') {
        var r = state.remotes[from] || { id: from, name: rosterName(from) };
        r.name = p.name || r.name || rosterName(from);
        r.step = p.step | 0;
        r.best = p.best | 0;
        r.score = p.score | 0;
        r.combo = p.combo | 0;
        r.gaugeRatio = Number.isFinite(p.g) ? p.g : 0;
        r.feverActive = !!p.fv;
        r.alive = p.alive !== false;
        r.characterId = p.ch || r.characterId || rosterChar(from);
        r.runId = p.runId || null;
        r.running = !!p.running;
        r.lastSeen = Date.now();
        state.remotes[from] = r;
        fire('snapshot', r);
        fire('change');
      }
    }

    return {
      get available() { return state.available; },
      get isMulti() { return state.isMulti; },
      get myId() { return state.myId; },
      get code() { return state.code; },
      roster: function () { return state.roster.slice(); },
      remotes: function () { return state.remotes; },
      remoteList: function () {
        return Object.keys(state.remotes).map(function (id) { return state.remotes[id]; });
      },
      seedString: function () { return state.code || 'solo'; },
      on: function (ev, cb) { if (cbs[ev]) cbs[ev].push(cb); return this; },
      off: function (ev) { if (cbs[ev]) cbs[ev] = []; return this; },

      connect: function (characterId, name) {
        if (!state.available) return Promise.reject(new Error('relay unavailable'));
        state.myName = name || state.myName || '말랑이';
        relay = window.MallangRelay.create({
          gameId: gameId,
          name: state.myName,
          characterId: characterId || null,
        });
        relay.on('players', function (list) {
          state.myId = relay.playerId || state.myId;
          state.roster = (list || []).slice();
          var ids = {};
          state.roster.forEach(function (r) { ids[normId(r)] = true; });
          Object.keys(state.remotes).forEach(function (id) {
            if (!ids[id]) delete state.remotes[id];
          });
          fire('players', state.roster.slice());
          fire('change');
        });
        relay.on('message', handleMessage);
        return relay.ready.then(function () {
          state.isMulti = true;
          state.myId = relay.playerId || state.myId;
          state.code = relay.code || state.code;
          return { code: state.code, myId: state.myId };
        });
      },

      broadcastStart: function (dur, runId) {
        if (!relay) return;
        state.startedRunId = runId || String(Date.now());
        relay.send({ t: 'start', dur: dur, runId: state.startedRunId });
      },
      broadcastTime: function (sec) {
        if (relay) relay.send({ t: 'time', sec: sec });
      },
      broadcastChar: function (characterId, name) {
        if (relay) relay.send({ t: 'char', ch: characterId, name: name || state.myName });
      },
      sendSnapshot: function (s, force) {
        if (!relay) return;
        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        if (!force && now - lastSendAt < SNAPSHOT_INTERVAL_MS) return;
        lastSendAt = now;
        relay.send({
          t: 'snap',
          step: s.step | 0,
          best: s.best | 0,
          score: s.score | 0,
          combo: s.combo | 0,
          g: Math.round((s.gaugeRatio || 0) * 100) / 100,
          fv: !!s.feverActive,
          alive: s.alive !== false,
          ch: s.characterId || null,
          runId: s.runId || null,
          running: !!s.running,
          name: s.name || state.myName,
        });
      },
      leave: function () { if (relay) relay.leave(); },
    };
  }

  window.MallangStairsMP = { create: create };
})();
