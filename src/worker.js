/**
 * DrewShare - Worker API.
 *
 * Il server non vede mai il codice della stanza, ne' i nomi dei file, ne' i byte
 * in chiaro. Riceve solo:
 *   roomId = SHA-256("drewshare-room-v1|" + CODICE)
 * mentre la chiave AES deriva dallo stesso CODICE via PBKDF2, lato client.
 * Qui si maneggiano solo blob opachi.
 *
 * Ogni stanza e' una Durable Object con storage SQLite: consistenza forte,
 * niente propagazione da aspettare, e la scadenza gestita da un alarm che
 * cancella tutto da solo. Il Worker qui davanti fa solo da smistamento.
 */

const TTL_CHOICES = [900, 1800, 3600, 6 * 3600, 24 * 3600, 72 * 3600];

const HEX64 = /^[0-9a-f]{64}$/;
const FILE_ID = /^[0-9a-z]{22}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return serveAsset(request, env);
    try {
      return await route(request, env, url);
    } catch (err) {
      console.error("api error", err && err.stack);
      return json({ error: "internal_error" }, 500);
    }
  },
};

/* ------------------------------------------------------------------ utils */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const fail = (code, status = 400) => json({ error: code }, status);

async function serveAsset(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404) return res;
  // App a pagina singola: ogni rotta sconosciuta ricade su index.html
  const url = new URL(request.url);
  url.pathname = "/index.html";
  return env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));
}

/* Freno per isolate. Non e' la difesa principale: quella e' l'entropia del
   codice (40 bit) unita alla scadenza breve della stanza. */
const buckets = new Map();
function throttle(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    if (buckets.size > 5000) buckets.clear();
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (b.n >= max) return false;
  b.n++;
  return true;
}

function overLimit(key, max) {
  const b = buckets.get(key);
  return !!b && Date.now() <= b.reset && b.n >= max;
}

/* Contatori distinti: altrimenti il traffico normale di una stanza consuma
   anche il budget di apertura delle stanze nuove. */
const clientKey = (request, scope) => scope + ":" + (request.headers.get("cf-connecting-ip") || "anon");

/**
 * Con un codice da sei caratteri l'unica difesa contro chi tira a indovinare e'
 * il costo di ogni tentativo: qui si contano solo i buchi nell'acqua, cosi' chi
 * usa davvero una stanza non viene mai frenato.
 */
const MISS_BUDGET = 40;

async function guarded(env, roomId, request, path) {
  const key = clientKey(request, "miss");
  if (overLimit(key, MISS_BUDGET)) return fail("slow_down", 429);
  const res = await forward(env, roomId, request, path);
  if (res.status === 404) throttle(key, MISS_BUDGET, 60000);
  return res;
}

/* --------------------------------------------------------------- smistamento */

/** Inoltra la richiesta alla Durable Object della stanza. */
function forward(env, roomId, request, path) {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
  const url = new URL(request.url);
  url.pathname = path;
  return stub.fetch(new Request(url.toString(), request));
}

async function route(request, env, url) {
  const seg = url.pathname.split("/").filter(Boolean); // ["api", "room", ...]
  const method = request.method;

  if (seg[1] !== "room") return fail("not_found", 404);

  // POST /api/room -> apre una stanza nuova
  if (seg.length === 2 && method === "POST") {
    if (!throttle(clientKey(request, "create"), 20, 60000)) return fail("slow_down", 429);
    const body = await request.json().catch(() => null);
    if (!body || !HEX64.test(body.roomId || "")) return fail("bad_room_id");
    if (!TTL_CHOICES.includes(body.ttl)) return fail("bad_ttl");
    return forward(env, body.roomId, new Request(request.url, { method: "POST", body: JSON.stringify({ ttl: body.ttl }) }), "/create");
  }

  const roomId = seg[2];
  if (!HEX64.test(roomId || "")) return fail("bad_room_id");
  if (!throttle(clientKey(request, "room"), 900, 60000)) return fail("slow_down", 429);

  // GET /api/room/:id
  if (seg.length === 3 && method === "GET") return guarded(env, roomId, request, "/info");

  // POST /api/room/:id/file -> prenota un file, restituisce l'id
  if (seg[3] === "file" && seg.length === 4 && method === "POST") return guarded(env, roomId, request, "/file");

  if ((seg[3] === "file" || seg[3] === "thumb") && (seg.length === 5 || seg.length === 6)) {
    const fileId = seg[4];
    if (!FILE_ID.test(fileId)) return fail("bad_file_id");
    const tail = seg[5] === "commit" ? "/commit" : "";
    if (seg.length === 6 && !tail) return fail("not_found", 404);
    return guarded(env, roomId, request, "/" + seg[3] + "/" + fileId + tail);
  }

  return fail("not_found", 404);
}

/* ------------------------------------------------------- la stanza vera e propria */

const BLOCK = 96 * 1024; // sotto il limite di 128 KiB per valore
const MAX_FILES = 300;
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const MAX_ROOM_BYTES = 1024 * 1024 * 1024;
const MAX_THUMB_BYTES = 4 * 1024 * 1024;
const MAX_PART_BYTES = 64 * BLOCK; // 6 MiB esatti, multiplo del blocco
const MAX_META_B64 = 1400;
const READ_AHEAD = 16; // blocchi per giro in lettura

const pad = (n) => String(n).padStart(8, "0");

function newFileId() {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  let out = "";
  for (const b of bytes) out += b.toString(36).padStart(2, "0");
  return out.slice(0, 22);
}

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    this.storage = ctx.storage;
  }

  /** Scaduta la stanza, l'alarm porta via tutto senza che nessuno chieda. */
  async alarm() {
    await this.storage.deleteAll();
  }

  async meta() {
    const meta = await this.storage.get("meta");
    if (!meta) return null;
    if (meta.exp < Date.now()) {
      await this.storage.deleteAll();
      return null;
    }
    return meta;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const seg = url.pathname.split("/").filter(Boolean);
    const method = request.method;

    if (seg[0] === "create" && method === "POST") return this.create(request);

    const meta = await this.meta();
    if (!meta) return fail("room_not_found", 404);

    if (seg[0] === "info" && method === "GET") return this.info(meta);

    if (seg[0] === "file" && seg.length === 1 && method === "POST") return this.declare(request, meta);

    const fileId = seg[1];
    if (!fileId) return fail("not_found", 404);

    if (seg[0] === "file") {
      if (seg[2] === "commit" && method === "POST") return this.commit(fileId, meta);
      if (method === "PUT") return this.append(request, fileId, meta, "d");
      if (method === "GET") return this.read(fileId, "d");
      if (method === "DELETE") return this.remove(fileId, meta);
    }

    if (seg[0] === "thumb") {
      if (method === "PUT") return this.putThumb(request, fileId);
      if (method === "GET") return this.read(fileId, "t");
    }

    return fail("not_found", 404);
  }

  async create(request) {
    if (await this.storage.get("meta")) return fail("room_exists", 409);
    const { ttl } = await request.json();
    const exp = Date.now() + ttl * 1000;
    await this.storage.put("meta", { exp, ttl, created: Date.now(), used: 0, files: 0 });
    await this.storage.setAlarm(exp);
    return json({ expiresAt: exp, ttl });
  }

  async info(meta) {
    const records = await this.storage.list({ prefix: "f:" });
    const files = [];
    for (const [, rec] of records) {
      if (rec.done) files.push(rec);
    }
    files.sort((a, b) => a.at - b.at);
    return json({ expiresAt: meta.exp, ttl: meta.ttl, bytes: meta.used, files });
  }

  /** Prenota un file: registra i metadati cifrati, i byte arrivano dopo. */
  async declare(request, meta) {
    const m = request.headers.get("x-dr-meta") || "";
    const size = Number(request.headers.get("x-dr-size") || 0);
    const chunk = Number(request.headers.get("x-dr-chunk") || 0);
    const stored = Number(request.headers.get("x-dr-stored") || 0);
    const thumb = request.headers.get("x-dr-thumb") === "1";

    if (!m || m.length > MAX_META_B64) return fail("bad_meta");
    if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) return fail("file_too_large", 413);
    if (!Number.isFinite(chunk) || chunk <= 0 || chunk > 64 * 1024 * 1024) return fail("bad_chunk");
    if (!Number.isFinite(stored) || stored <= 0 || stored > MAX_FILE_BYTES + 1024 * 1024) return fail("bad_stored_size");
    if (meta.files >= MAX_FILES) return fail("room_full", 507);
    if (meta.used + stored > MAX_ROOM_BYTES) return fail("room_quota", 507);

    const id = newFileId();
    await this.storage.put("f:" + id, {
      id,
      meta: m,
      size,
      chunk,
      stored,
      thumb,
      at: Date.now(),
      got: 0,
      done: false,
    });
    return json({ fileId: id, blockSize: BLOCK, partSize: MAX_PART_BYTES });
  }

  /**
   * Aggiunge un pezzo di flusso cifrato. L'offset e' assoluto e deve cadere su
   * un confine di blocco: cosi' un rinvio dopo un errore di rete riscrive gli
   * stessi blocchi invece di duplicarli.
   */
  async append(request, fileId, meta, prefix) {
    const record = await this.storage.get("f:" + fileId);
    if (!record) return fail("file_not_found", 404);
    if (record.done) return fail("already_committed", 409);

    const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset % BLOCK !== 0) return fail("bad_offset");

    const body = new Uint8Array(await request.arrayBuffer());
    if (!body.length) return fail("empty_part");
    if (body.length > MAX_PART_BYTES) return fail("part_too_large", 413);
    if (offset + body.length > record.stored) return fail("beyond_declared_size");

    const first = offset / BLOCK;
    const batch = {};
    for (let at = 0, n = 0; at < body.length; at += BLOCK, n++) {
      batch[prefix + ":" + fileId + ":" + pad(first + n)] = body.slice(at, at + BLOCK);
    }
    await this.storage.put(batch);

    record.got = Math.max(record.got, offset + body.length);
    await this.storage.put("f:" + fileId, record);
    return json({ received: record.got });
  }

  /** Il file diventa visibile agli altri solo quando e' arrivato tutto. */
  async commit(fileId, meta) {
    const record = await this.storage.get("f:" + fileId);
    if (!record) return fail("file_not_found", 404);
    if (record.got !== record.stored) return fail("incomplete_upload");

    record.done = true;
    await this.storage.put("f:" + fileId, record);

    meta.used += record.stored;
    meta.files += 1;
    await this.storage.put("meta", meta);
    return json({ fileId });
  }

  async putThumb(request, fileId) {
    const record = await this.storage.get("f:" + fileId);
    if (!record) return fail("file_not_found", 404);

    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length > MAX_THUMB_BYTES) return fail("thumb_too_large", 413);

    const batch = {};
    for (let at = 0, n = 0; at < body.length; at += BLOCK, n++) {
      batch["t:" + fileId + ":" + pad(n)] = body.slice(at, at + BLOCK);
    }
    await this.storage.put(batch);

    record.thumbBytes = body.length;
    await this.storage.put("f:" + fileId, record);
    return json({ ok: true });
  }

  /** Rilegge i blocchi in ordine e li rimanda in streaming, senza caricare tutto. */
  async read(fileId, prefix) {
    const record = await this.storage.get("f:" + fileId);
    if (!record) return fail("file_not_found", 404);

    const total = prefix === "t" ? record.thumbBytes || 0 : record.stored;
    if (!total) return fail("file_not_found", 404);
    if (prefix === "d" && !record.done) return fail("file_not_found", 404);

    const storage = this.storage;
    const base = prefix + ":" + fileId + ":";
    let after = null;
    let sent = 0;

    const stream = new ReadableStream({
      async pull(controller) {
        const page = await storage.list({
          prefix: base,
          limit: READ_AHEAD,
          ...(after ? { startAfter: after } : {}),
        });
        if (page.size === 0) {
          controller.close();
          return;
        }
        for (const [key, value] of page) {
          controller.enqueue(new Uint8Array(value));
          sent += value.byteLength;
          after = key;
        }
        if (sent >= total) controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/octet-stream",
        // Il runtime toglie content-length dalle risposte in streaming: il
        // totale viaggia a parte, serve al client per la barra di avanzamento.
        "x-dr-stored": String(total),
        "cache-control": "no-store",
        "x-dr-meta": record.meta,
        "x-dr-size": String(record.size),
        "x-dr-chunk": String(record.chunk),
      },
    });
  }

  async remove(fileId, meta) {
    const record = await this.storage.get("f:" + fileId);
    if (!record) return fail("file_not_found", 404);

    for (const prefix of ["d:" + fileId + ":", "t:" + fileId + ":"]) {
      let keys;
      do {
        const page = await this.storage.list({ prefix, limit: 128 });
        keys = [...page.keys()];
        if (keys.length) await this.storage.delete(keys);
      } while (keys.length === 128);
    }
    await this.storage.delete("f:" + fileId);

    if (record.done) {
      meta.used = Math.max(0, meta.used - record.stored);
      meta.files = Math.max(0, meta.files - 1);
      await this.storage.put("meta", meta);
    }
    return json({ ok: true });
  }
}
