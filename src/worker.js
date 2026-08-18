/**
 * Darkroom - Worker API.
 *
 * Il server non vede mai il codice della stanza, ne' i nomi dei file, ne' i byte
 * in chiaro. Riceve solo:
 *   roomId = SHA-256("darkroom-room-v1|" + CODICE)
 * mentre la chiave AES deriva dallo stesso CODICE via PBKDF2, lato client.
 * Qui si maneggiano solo blob opachi.
 *
 * Layout R2:
 *   m/<roomId>              record stanza (JSON), customMetadata.exp = scadenza ms
 *   r/<roomId>/<fileId>     file cifrato
 *   t/<roomId>/<fileId>     miniatura cifrata (facoltativa)
 */

const TTL_CHOICES = [900, 1800, 3600, 6 * 3600, 24 * 3600, 72 * 3600];
const MAX_FILES_PER_ROOM = 300;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
const MAX_ROOM_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB
const SINGLE_SHOT_LIMIT = 90 * 1024 * 1024; // oltre questa soglia -> multipart
const PART_SIZE = 32 * 1024 * 1024;
const MAX_META_B64 = 1400;

const HEX64 = /^[0-9a-f]{64}$/;
const FILE_ID = /^[0-9a-z]{22}$/;
const B64 = /^[A-Za-z0-9+/=]+$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return serveAsset(request, env);
    try {
      return await api(request, env, url, ctx);
    } catch (err) {
      console.error("api error", err && err.stack);
      return json({ error: "internal_error" }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env));
  },
};

/* ------------------------------------------------------------------ utils */

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

const fail = (code, status = 400) => json({ error: code }, status);

function newFileId() {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  let out = "";
  for (const b of bytes) out += b.toString(36).padStart(2, "0");
  return out.slice(0, 22);
}

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

const clientKey = (request) => request.headers.get("cf-connecting-ip") || "anon";

/* ----------------------------------------------------------------- router */

async function api(request, env, url) {
  const seg = url.pathname.split("/").filter(Boolean); // ["api", "room", ...]
  const method = request.method;

  if (seg[1] !== "room") return fail("not_found", 404);
  if (seg.length === 2 && method === "POST") return createRoom(request, env);

  const roomId = seg[2];
  if (!HEX64.test(roomId || "")) return fail("bad_room_id");
  if (!throttle(clientKey(request), 240, 60000)) return fail("slow_down", 429);

  const room = await getRoom(env, roomId);
  if (!room) return fail("room_not_found", 404);

  // GET /api/room/:id
  if (seg.length === 3 && method === "GET") return listRoom(env, roomId, room);

  // PUT /api/room/:id/file -- upload in un colpo solo
  if (seg[3] === "file" && seg.length === 4 && method === "PUT") return putFile(request, env, roomId);

  // POST /api/room/:id/mpu -- avvia upload multipart
  if (seg[3] === "mpu" && seg.length === 4 && method === "POST") return startMpu(request, env, roomId);

  if (seg[3] === "mpu" && seg.length === 5) {
    const fileId = seg[4];
    if (!FILE_ID.test(fileId)) return fail("bad_file_id");
    if (method === "PUT") return uploadPart(request, env, roomId, fileId, url);
    if (method === "POST") return completeMpu(request, env, roomId, fileId);
    if (method === "DELETE") return abortMpu(env, roomId, fileId, url);
  }

  if ((seg[3] === "file" || seg[3] === "thumb") && seg.length === 5) {
    const fileId = seg[4];
    if (!FILE_ID.test(fileId)) return fail("bad_file_id");
    const prefix = seg[3] === "file" ? "r" : "t";
    if (method === "GET") return getBlob(request, env, prefix + "/" + roomId + "/" + fileId);
    if (method === "PUT" && prefix === "t") return putThumb(request, env, roomId, fileId);
    if (method === "DELETE") return deleteFile(env, roomId, fileId);
  }

  return fail("not_found", 404);
}

/* ------------------------------------------------------------------ rooms */

async function getRoom(env, roomId) {
  const obj = await env.BUCKET.head("m/" + roomId);
  if (!obj) return null;
  const exp = Number(obj.customMetadata?.exp || 0);
  if (!exp || exp < Date.now()) return null;
  return { exp, ttl: Number(obj.customMetadata?.ttl || 0) };
}

async function createRoom(request, env) {
  if (!throttle(clientKey(request), 20, 60000)) return fail("slow_down", 429);

  const body = await request.json().catch(() => null);
  if (!body) return fail("bad_body");

  const { roomId, ttl } = body;
  if (!HEX64.test(roomId || "")) return fail("bad_room_id");
  if (!TTL_CHOICES.includes(ttl)) return fail("bad_ttl");
  if (await getRoom(env, roomId)) return fail("room_exists", 409);

  const exp = Date.now() + ttl * 1000;
  await env.BUCKET.put("m/" + roomId, JSON.stringify({ v: 1, created: Date.now(), ttl }), {
    customMetadata: { exp: String(exp), ttl: String(ttl) },
  });

  return json({ expiresAt: exp, ttl });
}

async function listRoom(env, roomId, room) {
  const files = [];
  let bytes = 0;
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: "r/" + roomId + "/", cursor, include: ["customMetadata"] });
    for (const o of page.objects) {
      const cm = o.customMetadata || {};
      bytes += o.size;
      files.push({
        id: o.key.slice(o.key.lastIndexOf("/") + 1),
        stored: o.size,
        size: Number(cm.ps || 0),
        chunk: Number(cm.cs || 0),
        meta: cm.m || "",
        thumb: cm.th === "1",
        at: Number(cm.ts || 0),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  files.sort((a, b) => a.at - b.at);
  return json({ expiresAt: room.exp, ttl: room.ttl, bytes, files });
}

/* ---------------------------------------------------------------- uploads */

function readUploadHeaders(request) {
  const meta = request.headers.get("x-dr-meta") || "";
  const ps = Number(request.headers.get("x-dr-size") || 0);
  const cs = Number(request.headers.get("x-dr-chunk") || 0);
  const th = request.headers.get("x-dr-thumb") === "1";
  if (!meta || meta.length > MAX_META_B64 || !B64.test(meta)) return { error: "bad_meta" };
  if (!Number.isFinite(ps) || ps < 0 || ps > MAX_FILE_BYTES) return { error: "bad_size" };
  if (!Number.isFinite(cs) || cs <= 0 || cs > 64 * 1024 * 1024) return { error: "bad_chunk" };
  return {
    customMetadata: {
      m: meta,
      ps: String(ps),
      cs: String(cs),
      th: th ? "1" : "0",
      ts: String(Date.now()),
    },
  };
}

async function roomQuota(env, roomId) {
  let count = 0;
  let bytes = 0;
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: "r/" + roomId + "/", cursor });
    count += page.objects.length;
    for (const o of page.objects) bytes += o.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { count, bytes };
}

async function guardQuota(env, roomId, incoming) {
  const { count, bytes } = await roomQuota(env, roomId);
  if (count >= MAX_FILES_PER_ROOM) return fail("room_full", 507);
  if (bytes + incoming > MAX_ROOM_BYTES) return fail("room_quota", 507);
  return null;
}

async function putFile(request, env, roomId) {
  const head = readUploadHeaders(request);
  if (head.error) return fail(head.error);

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > SINGLE_SHOT_LIMIT) return fail("too_large_use_mpu", 413);

  const blocked = await guardQuota(env, roomId, declared);
  if (blocked) return blocked;

  const fileId = newFileId();
  await env.BUCKET.put("r/" + roomId + "/" + fileId, request.body, { customMetadata: head.customMetadata });
  return json({ fileId });
}

async function startMpu(request, env, roomId) {
  const head = readUploadHeaders(request);
  if (head.error) return fail(head.error);

  const declared = Number(request.headers.get("x-dr-stored") || 0);
  if (!Number.isFinite(declared) || declared <= 0) return fail("bad_stored_size");

  const blocked = await guardQuota(env, roomId, declared);
  if (blocked) return blocked;

  const fileId = newFileId();
  const mpu = await env.BUCKET.createMultipartUpload("r/" + roomId + "/" + fileId, {
    customMetadata: head.customMetadata,
  });
  return json({ fileId, uploadId: mpu.uploadId, partSize: PART_SIZE });
}

async function uploadPart(request, env, roomId, fileId, url) {
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("part"));
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return fail("bad_part");

  const mpu = env.BUCKET.resumeMultipartUpload("r/" + roomId + "/" + fileId, uploadId);
  const part = await mpu.uploadPart(partNumber, request.body);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function completeMpu(request, env, roomId, fileId) {
  const body = await request.json().catch(() => null);
  if (!body || !body.uploadId || !Array.isArray(body.parts)) return fail("bad_body");

  const mpu = env.BUCKET.resumeMultipartUpload("r/" + roomId + "/" + fileId, body.uploadId);
  await mpu.complete(body.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
  return json({ fileId });
}

async function abortMpu(env, roomId, fileId, url) {
  const uploadId = url.searchParams.get("uploadId");
  if (!uploadId) return fail("bad_part");
  await env.BUCKET.resumeMultipartUpload("r/" + roomId + "/" + fileId, uploadId).abort();
  return json({ ok: true });
}

async function putThumb(request, env, roomId, fileId) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 4 * 1024 * 1024) return fail("thumb_too_large", 413);
  const cs = request.headers.get("x-dr-chunk") || "0";
  await env.BUCKET.put("t/" + roomId + "/" + fileId, request.body, { customMetadata: { cs } });
  return json({ ok: true });
}

/* -------------------------------------------------------------- downloads */

async function getBlob(request, env, key) {
  const ranged = request.headers.has("range");
  const object = await env.BUCKET.get(key, {
    onlyIf: request.headers,
    ...(ranged ? { range: request.headers } : {}),
  });
  if (!object) return fail("not_found", 404);

  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  headers.set("cache-control", "private, max-age=300");
  headers.set("etag", object.httpEtag);
  const cm = object.customMetadata || {};
  if (cm.m) headers.set("x-dr-meta", cm.m);
  if (cm.ps) headers.set("x-dr-size", cm.ps);
  if (cm.cs) headers.set("x-dr-chunk", cm.cs);

  if (!("body" in object)) return new Response(null, { status: 304, headers });

  if (ranged && object.range && "offset" in object.range) {
    const { offset, length } = object.range;
    headers.set("content-range", "bytes " + offset + "-" + (offset + length - 1) + "/" + object.size);
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

async function deleteFile(env, roomId, fileId) {
  await env.BUCKET.delete(["r/" + roomId + "/" + fileId, "t/" + roomId + "/" + fileId]);
  return json({ ok: true });
}

/* ---------------------------------------------------------------- sweeper */

async function purgeRoom(env, roomId) {
  for (const prefix of ["r/" + roomId + "/", "t/" + roomId + "/"]) {
    let cursor;
    do {
      const page = await env.BUCKET.list({ prefix, cursor, limit: 500 });
      if (page.objects.length) await env.BUCKET.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  await env.BUCKET.delete("m/" + roomId);
}

async function sweep(env) {
  const now = Date.now();
  let cursor;
  let purged = 0;
  do {
    const page = await env.BUCKET.list({ prefix: "m/", cursor, include: ["customMetadata"], limit: 500 });
    for (const o of page.objects) {
      const exp = Number(o.customMetadata?.exp || 0);
      if (!exp || exp < now) {
        await purgeRoom(env, o.key.slice(2));
        purged++;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  console.log("sweep: " + purged + " stanze rimosse");
}
