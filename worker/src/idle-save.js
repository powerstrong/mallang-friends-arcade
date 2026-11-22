import Contract from "../../games/mallang-idle/engine/save-contract.js";
const LIMITS = { maxBytes: 65536, createPerHour: 10, savesPerMinute: 30, readsPerMinute: 120, requestHours: 24 };
const HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json", "Cache-Control": "no-store" };
export async function codeHash(code) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function handleIdleSave(request, env, now = Date.now()) {
  const reply = (status, body) => new Response(JSON.stringify({ ...body, serverNow: now }), { status, headers: HEADERS });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  const url = new URL(request.url), db = env.DB, ns = env.IDLE_NAMESPACE;
  const create = url.pathname === "/api/idle/saves" && request.method === "POST";
  if (url.pathname !== "/api/idle/saves" && url.pathname !== "/api/idle/save") return reply(404, {});
  if (!["GET", "POST"].includes(request.method) || url.pathname === "/api/idle/saves" && !create) return reply(405, {});
  if (!db || !["prod", "staging", "test"].includes(ns)) return reply(503, { error: "설정을 확인하고 있어요" });
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  const envelope = (row) => ({ revision: row.revision, payload: JSON.parse(row.payload) });
  async function limit(subject, window, cap) {
    const bucket = Math.floor(now / window);
    const row = await stmt("INSERT INTO idle_request_limits(namespace,subject,bucket,count,expires_at) VALUES(?,?,?,1,?) ON CONFLICT(namespace,subject,bucket) DO UPDATE SET count=count+1 RETURNING count", ns, subject, bucket, now + window * 2).first();
    return row.count <= cap;
  }
  try {
    // Charge every request, including invalid auth, unknown codes and idempotent
    // retries, before parsing payloads, reading saves or cleaning expired rows.
    const ip = await codeHash(request.headers.get("CF-Connecting-IP") || "local");
    const rateKind = request.method === "GET" ? "read" : create ? "create" : "save";
    const window = create ? 36e5 : 6e4;
    const cap = create ? LIMITS.createPerHour : rateKind === "read" ? LIMITS.readsPerMinute : LIMITS.savesPerMinute;
    if (!await limit(rateKind + "-ip:" + ip, window, cap)) return reply(429, { error: "잠시 뒤 다시 해 주세요" });
    const raw = (request.headers.get("Authorization") || "").match(/^Bearer ([A-Z2-7]{28})$/);
    if (!raw) return reply(401, { error: "이어하기 코드를 확인해 주세요" });
    const hash = await codeHash(raw[1]);
    if (!await limit(rateKind + ":" + hash, window, cap)) return reply(429, { error: "잠시 뒤 다시 해 주세요" });
    const get = () => stmt("SELECT * FROM idle_saves WHERE namespace=? AND code_hash=?", ns, hash).first();
    await db.batch([stmt("DELETE FROM idle_request_limits WHERE expires_at<?", now), stmt("DELETE FROM idle_save_requests WHERE expires_at<?", now)]);
    if (request.method === "GET") {
      const current = await get();
      if (!current) return reply(404, { error: "코드를 찾지 못했어요" });
      if (url.searchParams.has("backup")) {
        const b = await stmt("SELECT revision,payload FROM idle_save_backups WHERE namespace=? AND code_hash=? AND revision=? ORDER BY updated_at DESC LIMIT 1", ns, hash, Number(url.searchParams.get("backup"))).first();
        return b ? reply(200, envelope(b)) : reply(404, { error: "백업을 찾지 못했어요" });
      }
      const backups = await stmt("SELECT revision,kind,updated_at FROM idle_save_backups WHERE namespace=? AND code_hash=? ORDER BY updated_at DESC", ns, hash).all();
      return reply(200, { ...envelope(current), backups: backups.results });
    }
    const reader = request.body?.getReader();
    let length = 0, chunks = [];
    if (reader) for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMITS.maxBytes) {
        await reader.cancel();
        return reply(413, { error: "파일이 너무 커요" });
      }
      chunks.push(value);
    }
    let body;
    try {
      const bytes = new Uint8Array(length);
      let i = 0;
      for (const c of chunks) {
        bytes.set(c, i);
        i += c.length;
      }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return reply(400, { error: "파일을 읽지 못했어요" });
    }
    if (typeof body.requestId !== "string" || !/^[\w-]{8,80}$/.test(body.requestId) || !Number.isInteger(body.baseRevision) || body.baseRevision < 0) return reply(400, { error: "저장 요청을 확인해 주세요" });
    const valid = Contract.validate(body.payload, { nowMs: now });
    if (!valid.ok) return reply(422, { error: "저장 파일을 확인해 주세요", note: valid.note });
    const payload = JSON.stringify(valid.save), id = body.requestId;
    const prior = await stmt("SELECT revision,payload FROM idle_save_requests WHERE namespace=? AND code_hash=? AND request_id=?", ns, hash, id).first();
    if (prior) return reply(200, { ...envelope(prior), replayed: true });
    const existing = await get();
    if (create && existing) return reply(200, envelope(existing));
    if (create) {
      if (body.baseRevision !== 0) return reply(400, { error: "처음 저장을 확인해 주세요" });
      await db.batch([
        stmt("INSERT OR IGNORE INTO idle_saves VALUES(?,?,1,?,?,?,?)", ns, hash, valid.save.version, payload, now, id),
        stmt("INSERT OR IGNORE INTO idle_save_requests SELECT namespace,code_hash,?,revision,payload,? FROM idle_saves WHERE namespace=? AND code_hash=? AND last_request=?", id, now + 864e5, ns, hash, id)
      ]);
      return reply(200, envelope(await get()));
    }
    if (!existing) return reply(404, { error: "코드를 찾지 못했어요" });
    const serverValid = Contract.validate(JSON.parse(existing.payload), { nowMs: now });
    if (!serverValid.ok) return reply(422, { error: "서버 백업을 확인해 주세요" });
    const comparison = Contract.compare(valid.save, serverValid.save), conflict = body.baseRevision !== existing.revision;
    if (comparison.order < 0 || conflict && (comparison.order === 0 || body.settlement === true) || body.baseRevision > existing.revision) {
      await stmt("INSERT OR REPLACE INTO idle_save_backups VALUES(?,?,'conflict','loser',?,?,?)", ns, hash, body.baseRevision, payload, now).run();
      return reply(409, { ...envelope(existing), reason: comparison.reason });
    }
    const rev = existing.revision + 1;
    const kind = conflict ? "conflict" : "normal", slot = conflict ? "loser" : String(Math.floor(now / 864e5));
    await db.batch([
      stmt("UPDATE idle_saves SET revision=?,schema_version=?,payload=?,updated_at=?,last_request=? WHERE namespace=? AND code_hash=? AND revision=?", rev, valid.save.version, payload, now, id, ns, hash, existing.revision),
      stmt("INSERT OR REPLACE INTO idle_save_backups SELECT namespace,code_hash,?,?,?,?,? FROM idle_saves WHERE namespace=? AND code_hash=? AND revision=? AND last_request=?", kind, slot, existing.revision, existing.payload, now, ns, hash, rev, id),
      stmt("INSERT OR IGNORE INTO idle_save_requests SELECT namespace,code_hash,?,revision,payload,? FROM idle_saves WHERE namespace=? AND code_hash=? AND revision=? AND last_request=?", id, now + LIMITS.requestHours * 36e5, ns, hash, rev, id),
      stmt("DELETE FROM idle_save_backups WHERE namespace=? AND code_hash=? AND kind='normal' AND slot NOT IN (SELECT slot FROM idle_save_backups WHERE namespace=? AND code_hash=? AND kind='normal' ORDER BY updated_at DESC LIMIT 3)", ns, hash, ns, hash)
    ]);
    const result = await stmt("SELECT revision,payload FROM idle_save_requests WHERE namespace=? AND code_hash=? AND request_id=?", ns, hash, id).first();
    if (!result) await stmt("INSERT OR REPLACE INTO idle_save_backups VALUES(?,?,'conflict','loser',?,?,?)", ns, hash, body.baseRevision, payload, now).run();
    return result ? reply(200, { ...envelope(result), reason: conflict ? comparison.reason : void 0 }) : reply(409, { ...envelope(await get()), reason: "같은 시간에 저장했어요" });
  } catch {
    return reply(503, { error: "연결되면 다시 백업할게요" });
  }
}
