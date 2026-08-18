/**
 * DrewShare - crittografia lato client.
 *
 * Il codice della stanza e' insieme indirizzo e chiave:
 *   roomId = SHA-256("drewshare-room-v1|" + CODICE)      -> va al server
 *   key    = PBKDF2(CODICE, SHA-256("drewshare-salt-v1|" + CODICE), 250k)
 *
 * Il server riceve solo roomId: da li' non si torna al codice, quindi non si
 * torna alla chiave. Chi non ha il codice vede blob opachi e nient'altro.
 *
 * Le due stringhe entrano nell'hash: cambiarle cambia l'indirizzo e la chiave
 * di ogni stanza, quindi si toccano solo insieme a un cambio di Worker, che
 * comunque riparte con un namespace Durable Objects vuoto.
 */

export const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // niente 0 1 I O
export const CODE_LENGTH = 6;
export const CHUNK_SIZE = 4 * 1024 * 1024; // testo in chiaro per blocco
export const FRAME_OVERHEAD = 12 + 16; // IV + tag GCM

const te = new TextEncoder();
const td = new TextDecoder();

export function randomCode() {
  const raw = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = "";
  for (const b of raw) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function normalizeCode(input) {
  return String(input || "")
    .toUpperCase()
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("")
    .slice(0, CODE_LENGTH);
}

export const isCompleteCode = (code) => normalizeCode(code).length === CODE_LENGTH;

export function formatCode(code) {
  const half = Math.ceil(CODE_LENGTH / 2);
  return code.length > half ? code.slice(0, half) + "-" + code.slice(half) : code;
}

function hex(buffer) {
  const view = new Uint8Array(buffer);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}

const sha256 = (data) => crypto.subtle.digest("SHA-256", data);

/** Deriva identita' e chiave della stanza dal solo codice. */
export async function deriveRoom(rawCode) {
  const code = normalizeCode(rawCode);
  if (code.length !== CODE_LENGTH) throw new Error("codice incompleto");

  const roomId = hex(await sha256(te.encode("drewshare-room-v1|" + code)));
  const salt = await sha256(te.encode("drewshare-salt-v1|" + code));

  const material = await crypto.subtle.importKey("raw", te.encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return { code, roomId, key };
}

/* ------------------------------------------------------------ blocchi AES */

function aad(index) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, index, false);
  return buf;
}

/** Un blocco cifrato = IV(12) || ciphertext || tag(16). */
export async function encryptChunk(key, index, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(index) }, key, plain);
  const frame = new Uint8Array(12 + ct.byteLength);
  frame.set(iv, 0);
  frame.set(new Uint8Array(ct), 12);
  return frame;
}

export async function decryptChunk(key, index, frame) {
  const iv = frame.subarray(0, 12);
  const body = frame.subarray(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(index) }, key, body);
  return new Uint8Array(plain);
}

/** Dimensione del file una volta cifrato, calcolabile in anticipo. */
export function storedSize(plainSize, chunkSize = CHUNK_SIZE) {
  if (plainSize === 0) return FRAME_OVERHEAD;
  const full = Math.floor(plainSize / chunkSize);
  const rest = plainSize % chunkSize;
  return full * (chunkSize + FRAME_OVERHEAD) + (rest ? rest + FRAME_OVERHEAD : 0);
}

/* ------------------------------------------------------------- metadati   */

export function toBase64(bytes) {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Nome file, tipo MIME e impronta viaggiano cifrati come tutto il resto. */
export async function sealMeta(key, obj) {
  const frame = await encryptChunk(key, 0xffffffff, te.encode(JSON.stringify(obj)));
  return toBase64(frame);
}

export async function openMeta(key, b64) {
  try {
    const plain = await decryptChunk(key, 0xffffffff, fromBase64(b64));
    return JSON.parse(td.decode(plain));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- impronta  */

/**
 * Impronta incrementale: SHA-256 della concatenazione degli SHA-256 di ogni
 * blocco. WebCrypto non espone un hash in streaming, questo lo aggira senza
 * tenere l'intero file in memoria.
 */
export function digestAccumulator() {
  const parts = [];
  return {
    async add(chunk) {
      parts.push(new Uint8Array(await sha256(chunk)));
    },
    async finish() {
      const joined = new Uint8Array(parts.length * 32);
      parts.forEach((p, i) => joined.set(p, i * 32));
      return hex(await sha256(joined));
    },
  };
}
