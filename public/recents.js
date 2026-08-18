/*
 * DrewShare - stanze recenti.
 *
 * Chiudere la scheda non chiude la stanza: quella vive fino alla scadenza. Qui
 * si tiene traccia di quelle in cui si e' entrati, cosi' riaprendo il sito si
 * rientra con un tocco invece di ridigitare il codice.
 *
 * Attenzione a cosa c'e' dentro: il codice E' la chiave, quindi resta in chiaro
 * nel localStorage di questo dispositivo e di nessun altro. Chi usa il
 * dispositivo puo' rientrare nelle stanze ancora vive: per questo ogni riga ha
 * il suo "dimentica", e le stanze scadute spariscono da sole alla prima
 * lettura.
 */

const KEY = "drewshare-rooms";
const MAX = 6;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // storage negato (Safari privato) o contenuto illeggibile
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

const valid = (r, now) =>
  r && typeof r.code === "string" && Number(r.expiresAt) > now && Number(r.seen) > 0;

/** Le stanze ancora vive, dalla piu' recente. Le scadute vengono buttate. */
export function recentRooms() {
  const now = Date.now();
  const alive = read().filter((r) => valid(r, now));
  alive.sort((a, b) => b.seen - a.seen);
  const capped = alive.slice(0, MAX);
  if (capped.length !== read().length) write(capped);
  return capped;
}

export function rememberRoom(code, expiresAt) {
  if (!code || !(Number(expiresAt) > Date.now())) return;
  const list = recentRooms().filter((r) => r.code !== code);
  list.unshift({ code, expiresAt: Number(expiresAt), seen: Date.now() });
  write(list.slice(0, MAX));
}

export function forgetRoom(code) {
  write(recentRooms().filter((r) => r.code !== code));
}
