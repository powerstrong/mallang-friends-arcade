(function(root, factory) {
  var api = factory(typeof require === "function" ? require("./engine/save-contract.js") : root.MallangIdleSaveContract, typeof require === "function" ? require("./engine/balance.js") : root.MallangIdleBalance);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MallangIdleCloudSave = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(Contract, Bal) {
  "use strict";
  var ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", KEY = "mallang-idle-connection", B = Bal.BALANCE.save;
  function checksum(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) n = (n * 33 + ABC.indexOf(s[i])) % 1024;
    return ABC[n >> 5] + ABC[n & 31];
  }
  function normalize(s) {
    var code = String(s).toUpperCase().replace(/[\s-]/g, "");
    return /^[A-Z2-7]{28}$/.test(code) && checksum(code.slice(0, 26)) === code.slice(26) ? code : null;
  }
  function generate(randomBytes) {
    var a = randomBytes(16), bits = "", s = "";
    for (var i = 0; i < a.length; i++) bits += a[i].toString(2).padStart(8, "0");
    bits = bits.padEnd(130, "0");
    for (var j = 0; j < 130; j += 5) s += ABC[parseInt(bits.slice(j, j + 5), 2)];
    return s + checksum(s);
  }
  function display(s) {
    return s.match(/.{1,4}/g).join("-");
  }
  function create(io) {
    var meta = null, ready = false, busy = false, dirty = false, due = 0, retry = 0, generation = 0, disabled = !!io.disabled;
    try {
      meta = JSON.parse(io.storage.getItem(KEY) || "null");
    } catch (e) {
    }
    function status(s) {
      if (io.status) io.status(s);
    }
    function store() {
      io.storage.setItem(KEY, JSON.stringify(meta));
    }
    function backup(p, kind) {
      if (io.backup) io.backup(p, kind);
    }
    function id() {
      return generate(io.randomBytes);
    }
    async function api(path, method, body, code) {
      if (disabled) throw Error("연습 화면에서는 구름 저장을 쉬어요");
      var r = await io.fetch(io.base + "/api/idle/" + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + (code || meta.code) }, body: body && JSON.stringify(body) });
      var data = await r.json();
      if (!r.ok && r.status !== 409) throw Error(data.error || "연결되면 백업");
      if (data.payload) {
        var v = Contract.validate(data.payload, { nowMs: io.now() });
        if (!v.ok) throw Error("저장 파일을 확인해 주세요");
        data.payload = v.save;
      }
      return { status: r.status, data };
    }
    function applyServer(p, reason, kind) {
      backup(io.snapshot(), kind || "conflict");
      io.apply(p);
      if (reason) status("더 멀리 간 산책을 이어왔어요 · " + reason);
    }
    async function boot() {
      if (disabled) return;
      try {
        if (!meta) {
          meta = { code: id(), baseRevision: 0, pendingRequestId: id() };
          store();
        }
        if (meta.baseRevision === 0) {
          var created = await api("saves", "POST", { payload: io.snapshot(), baseRevision: 0, requestId: meta.pendingRequestId });
          if (!io.owner()) return;
          meta.baseRevision = created.data.revision;
          if (Contract.compare(created.data.payload, io.snapshot()).order > 0) applyServer(created.data.payload, "최고 기록");
        } else {
          var got = await api("save", "GET");
          if (!io.owner()) return;
          var restoring = !!meta.restorePending;
          var cmp = restoring ? { reason: "코드 복원" } : Contract.compare(io.snapshot(), got.data.payload), keepBranch = false;
          if (restoring || cmp.order <= 0) {
            var requestedGeneration = generation, requestedSnapshot = restoring ? null : JSON.stringify(io.snapshot());
            var settled = io.settle ? io.settle(got.data.payload, got.data.serverNow) : { payload: got.data.payload };
            var reconciled = await api("save", "POST", { payload: settled.payload, baseRevision: got.data.revision, requestId: id(), settlement: true });
            if (reconciled.status === 409) throw Error("다른 기기에서 저장 중이에요");
            if (!io.owner()) return;
            // A pending restore belongs to the target code, never the old device.
            // Only ordinary reconnects may keep gameplay that advanced while waiting.
            if (!restoring && (generation !== requestedGeneration || JSON.stringify(io.snapshot()) !== requestedSnapshot)) {
              cmp = Contract.compare(io.snapshot(), reconciled.data.payload);
              keepBranch = cmp.order > 0;
            }
            if (!keepBranch) {
              applyServer(reconciled.data.payload, cmp.reason, restoring ? "restore" : "conflict");
              if (io.restored) io.restored(settled.reward);
            } else dirty = true;
            got = reconciled;
          } else { dirty = true; keepBranch = true; }
          // A local winner still descends from its original revision, not the
          // server branch we just read/settled. Preserve that ancestry for CAS.
          if (!keepBranch) meta.baseRevision = got.data.revision;
        }
        meta.restorePending = false;
        meta.pending = null;
        meta.pendingRequestId = null;
        store();
        ready = true;
        retry = 0;
        status("구름에 저장 완료 " + new Date((created ? created.data : got.data).serverNow).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) + " · 코드 발급 완료");
        dirty = true;
        due = io.now() + B.cloudSec * 1e3;
      } catch (e) {
        status(e.message || "연결되면 백업");
        due = io.now() + B.retrySec[Math.min(retry++, B.retrySec.length - 1)] * 1e3;
      }
    }
    function changed(critical) {
      if (disabled) return;
      generation++;
      dirty = true;
      if (retry > 0) return;
      var next = io.now() + (critical ? B.criticalSec : B.cloudSec) * 1e3;
      due = due ? Math.min(due, next) : next;
    }
    async function flush() {
      if (disabled || busy || !io.owner() || !ready || !dirty && !meta.pending) return;
      busy = true;
      try {
        if (!meta.pending) {
          meta.pending = { payload: JSON.parse(JSON.stringify(io.snapshot())), baseRevision: meta.baseRevision, requestId: id() };
          meta.pendingRequestId = meta.pending.requestId;
          store();
        }
        var sent = meta.pending, result = await api("save", "POST", sent);
        if (!io.owner()) return;
        if (result.status === 409) {
          var cmp = Contract.compare(io.snapshot(), result.data.payload);
          if (cmp.order <= 0) {
            applyServer(result.data.payload, result.data.reason);
            dirty = false;
          } else {
            dirty = true;
            due = io.now() + B.criticalSec * 1e3;
          }
        } else dirty = JSON.stringify(io.snapshot()) !== JSON.stringify(sent.payload);
        if (result.status !== 409 || !dirty) meta.baseRevision = result.data.revision;
        meta.pending = null;
        meta.pendingRequestId = null;
        store();
        retry = 0;
        status((result.status === 409 ? "더 멀리 간 산책을 이어왔어요 · " + result.data.reason + " · " : "") + "구름에 저장 완료 " + new Date(result.data.serverNow).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
        due = io.now() + B.cloudSec * 1e3;
      } catch (e) {
        status("연결되면 백업");
        due = io.now() + B.retrySec[Math.min(retry++, B.retrySec.length - 1)] * 1e3;
      } finally {
        busy = false;
      }
    }
    async function tick() {
      if (disabled || busy || !io.owner() || io.now() < due) return;
      if (!ready) {
        busy = true;
        try {
          await boot();
        } finally {
          busy = false;
        }
      } else await flush();
    }
    async function restore(code) {
      code = normalize(code);
      if (!code) throw Error("코드를 다시 확인해 주세요");
      if (disabled) throw Error("연습 화면에서는 구름 저장을 쉬어요");
      if (busy) throw Error("저장 중이에요. 잠시 뒤 다시 해 주세요");
      busy = true;
      ready = false;
      try {
        for (var attempt = 0; attempt < 4; attempt++) {
          var got = await api("save", "GET", null, code);
          var settled = io.settle ? io.settle(got.data.payload, got.data.serverNow) : { payload: got.data.payload };
          var saved = await api("save", "POST", { payload: settled.payload, baseRevision: got.data.revision, requestId: id(), settlement: true }, code);
          if (saved.status === 409) continue;
          if (!io.owner()) throw Error("다른 탭에서 이어하고 있어요");
          backup(io.snapshot(), "restore");
          // Persist the new connection intent first. A crash between the two local
          // writes forces a server read, so old-device progress cannot enter this code.
          meta = { code, baseRevision: saved.data.revision, restorePending: true };
          store();
          io.apply(saved.data.payload);
          meta.restorePending = false;
          store();
          ready = true;
          dirty = false;
          if (io.restored) io.restored(settled.reward);
          status("구름에 저장 완료");
          return saved.data;
        }
        throw Error("다른 기기에서 저장 중이에요. 다시 해 주세요");
      } finally {
        busy = false;
      }
    }
    return { tick, changed, flush, restore, code: function() {
      return ready && meta ? display(meta.code) : "";
    }, backup: async function(revision) {
      return (await api("save?backup=" + encodeURIComponent(revision), "GET")).data;
    }, inspect: async function() {
      return (await api("save", "GET")).data;
    }, disable: function() {
      disabled = true;
      ready = false;
    }, ready: function() {
      return ready;
    } };
  }
  return { create, generate, normalize, display, KEY };
});
