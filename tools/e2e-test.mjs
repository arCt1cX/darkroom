/**
 * Prova end-to-end contro un `wrangler dev` gia' avviato: cifra, carica,
 * riscarica, decifra e confronta i byte uno per uno.
 *
 *   node tools/e2e-test.mjs http://127.0.0.1:8787
 */

import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const here = dirname(fileURLToPath(import.meta.url));
const C = await import(pathToFileURL(join(here, "..", "public", "crypto.js")).href);
const { buildZip, uniqueNames } = await import(pathToFileURL(join(here, "..", "public", "zip.js")).href);

let failures = 0;
function check(label, ok, extra = "") {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (extra ? "  " + extra : ""));
  if (!ok) failures++;
}

async function call(path, options) {
  const res = await fetch(BASE + path, options);
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(data.error || "http_" + res.status + " " + text.slice(0, 120));
  return data;
}

async function encryptAll(bytes, key) {
  const frames = [];
  const digest = C.digestAccumulator();
  const total = Math.max(1, Math.ceil(bytes.length / C.CHUNK_SIZE));
  for (let i = 0; i < total; i++) {
    const slice = bytes.subarray(i * C.CHUNK_SIZE, (i + 1) * C.CHUNK_SIZE);
    await digest.add(slice);
    frames.push(await C.encryptChunk(key, i, slice));
  }
  return { frames, hash: await digest.finish() };
}

async function decryptAll(cipher, chunkSize, key) {
  const frameSize = chunkSize + C.FRAME_OVERHEAD;
  const digest = C.digestAccumulator();
  const parts = [];
  let index = 0;
  for (let offset = 0; offset < cipher.length; offset += frameSize, index++) {
    const frame = cipher.subarray(offset, Math.min(offset + frameSize, cipher.length));
    const plain = await C.decryptChunk(key, index, frame);
    await digest.add(plain);
    parts.push(plain);
    }
  return { parts, hash: await digest.finish() };
}

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/* ------------------------------------------------------------------ prova */

console.log("Darkroom e2e ->", BASE);

const code = C.randomCode();
console.log("codice stanza:", C.formatCode(code));
const room = await C.deriveRoom(code);

const again = await C.deriveRoom(code.toLowerCase().slice(0, 4) + "-" + code.slice(4));
check("il codice normalizzato deriva la stessa stanza", again.roomId === room.roomId);

await call("/api/room", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ roomId: room.roomId, ttl: 1800 }),
});
check("stanza creata", true);

let duplicate = null;
try {
  await call("/api/room", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: room.roomId, ttl: 1800 }),
  });
} catch (err) {
  duplicate = err.message;
}
check("codice gia' esistente rifiutato", duplicate === "room_exists", duplicate || "");

const wrong = await C.deriveRoom(C.randomCode());
let missing = null;
try {
  await call("/api/room/" + wrong.roomId);
} catch (err) {
  missing = err.message;
}
check("stanza sconosciuta -> 404", missing === "room_not_found", missing || "");

// Un file piccolo (blocco singolo) e uno che attraversa piu' blocchi.
const samples = [
  { name: "scatto.jpg", type: "image/jpeg", bytes: new Uint8Array(randomBytes(700 * 1024)) },
  { name: "clip.mp4", type: "video/mp4", bytes: new Uint8Array(randomBytes(9 * 1024 * 1024 + 12345)) },
  { name: "vuoto.txt", type: "text/plain", bytes: new Uint8Array(0) },
];

for (const sample of samples) {
  const { frames, hash } = await encryptAll(sample.bytes, room.key);
  const stored = frames.reduce((n, f) => n + f.length, 0);
  check(
    sample.name + ": dimensione cifrata prevista",
    stored === C.storedSize(sample.bytes.length, C.CHUNK_SIZE),
    stored + " vs " + C.storedSize(sample.bytes.length, C.CHUNK_SIZE)
  );

  const meta = await C.sealMeta(room.key, { n: sample.name, t: sample.type, h: hash, lm: Date.now() });
  const res = await call("/api/room/" + room.roomId + "/file", {
    method: "PUT",
    headers: {
      "x-dr-meta": meta,
      "x-dr-size": String(sample.bytes.length),
      "x-dr-chunk": String(C.CHUNK_SIZE),
      "x-dr-thumb": "0",
    },
    body: concat(frames),
  });
  sample.id = res.fileId;
  check(sample.name + ": caricato", !!res.fileId);
}

const listing = await call("/api/room/" + room.roomId);
check("la lista contiene tutti i file", listing.files.length === samples.length, String(listing.files.length));

for (const entry of listing.files) {
  const meta = await C.openMeta(room.key, entry.meta);
  const sample = samples.find((s) => s.id === entry.id);
  check(sample.name + ": metadati decifrati", meta && meta.n === sample.name, meta ? meta.n : "null");

  const res = await fetch(BASE + "/api/room/" + room.roomId + "/file/" + entry.id);
  const cipher = new Uint8Array(await res.arrayBuffer());
  const { parts, hash } = await decryptAll(cipher, entry.chunk, room.key);
  const plain = concat(parts);

  check(sample.name + ": lunghezza identica", plain.length === sample.bytes.length, plain.length + " vs " + sample.bytes.length);
  check(sample.name + ": byte identici", Buffer.compare(Buffer.from(plain), Buffer.from(sample.bytes)) === 0);
  check(sample.name + ": impronta verificata", hash === meta.h);
  sample.plain = parts;
}

// Chiave sbagliata: i blob restano illeggibili.
const intruder = await C.deriveRoom(C.randomCode());
const first = listing.files[0];
const res = await fetch(BASE + "/api/room/" + room.roomId + "/file/" + first.id);
const cipher = new Uint8Array(await res.arrayBuffer());
let denied = false;
try {
  await C.decryptChunk(intruder.key, 0, cipher.subarray(0, first.chunk + C.FRAME_OVERHEAD));
} catch {
  denied = true;
}
check("chiave sbagliata -> decifratura impossibile", denied);
check("metadati illeggibili senza la chiave", (await C.openMeta(intruder.key, first.meta)) === null);

// Archivio zip
const names = uniqueNames(samples.map((s) => s.name).concat(samples[0].name));
check("nomi duplicati resi univoci", names[3] === "scatto (2).jpg", names[3]);
const zip = buildZip(samples.map((s, i) => ({ name: names[i], chunks: s.plain })));
const zipBytes = Buffer.from(await zip.arrayBuffer());
check("zip: firma locale", zipBytes.readUInt32LE(0) === 0x04034b50);
check("zip: coda centrale", zipBytes.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])));

// Percorso multipart: si attiva solo oltre i 90 MiB, quindi e' opzionale.
if (process.env.DARKROOM_TEST_MPU === "1") {
  const big = new Uint8Array(randomBytes(100 * 1024 * 1024 + 4321));
  const { frames, hash } = await encryptAll(big, room.key);
  const total = frames.reduce((n, f) => n + f.length, 0);
  const meta = await C.sealMeta(room.key, { n: "grande.bin", t: "application/octet-stream", h: hash, lm: Date.now() });

  const start = await call("/api/room/" + room.roomId + "/mpu", {
    method: "POST",
    headers: {
      "x-dr-meta": meta,
      "x-dr-size": String(big.length),
      "x-dr-chunk": String(C.CHUNK_SIZE),
      "x-dr-thumb": "0",
      "x-dr-stored": String(total),
    },
  });

  const perPart = Math.max(1, Math.floor(start.partSize / (C.CHUNK_SIZE + C.FRAME_OVERHEAD)));
  const parts = [];
  for (let i = 0, n = 1; i < frames.length; i += perPart, n++) {
    const res = await call(
      "/api/room/" + room.roomId + "/mpu/" + start.fileId + "?uploadId=" + encodeURIComponent(start.uploadId) + "&part=" + n,
      { method: "PUT", body: concat(frames.slice(i, i + perPart)) }
    );
    parts.push({ partNumber: res.partNumber, etag: res.etag });
  }

  await call("/api/room/" + room.roomId + "/mpu/" + start.fileId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId: start.uploadId, parts }),
  });

  const back = new Uint8Array(await (await fetch(BASE + "/api/room/" + room.roomId + "/file/" + start.fileId)).arrayBuffer());
  const round = await decryptAll(back, C.CHUNK_SIZE, room.key);
  const plain = concat(round.parts);
  check("multipart: " + parts.length + " parti, byte identici", Buffer.compare(Buffer.from(plain), Buffer.from(big)) === 0);
  check("multipart: impronta verificata", round.hash === hash);
  await call("/api/room/" + room.roomId + "/file/" + start.fileId, { method: "DELETE" });
}

// Cancellazione
await call("/api/room/" + room.roomId + "/file/" + first.id, { method: "DELETE" });
const after = await call("/api/room/" + room.roomId);
check("file cancellato", after.files.length === samples.length - 1);

console.log(failures ? "\n" + failures + " controlli falliti" : "\nTutti i controlli superati.");
process.exit(failures ? 1 : 0);
