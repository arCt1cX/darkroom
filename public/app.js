import {
  CHUNK_SIZE,
  CODE_LENGTH,
  FRAME_OVERHEAD,
  decryptChunk,
  deriveRoom,
  digestAccumulator,
  encryptChunk,
  formatCode,
  isCompleteCode,
  normalizeCode,
  openMeta,
  randomCode,
  sealMeta,
} from "./crypto.js";
import { buildZip, uniqueNames } from "./zip.js";

const $ = (sel) => document.querySelector(sel);

const TTLS = [
  { s: 900, label: "15 min" },
  { s: 1800, label: "30 min" },
  { s: 3600, label: "1 ora" },
  { s: 21600, label: "6 ore" },
  { s: 86400, label: "24 ore" },
  { s: 259200, label: "3 giorni" },
];

const state = {
  room: null, // { code, roomId, key }
  expiresAt: 0,
  ttl: 0,
  files: [],
  thumbs: new Map(),
  clock: null,
  busy: false,
};

let chosenTtl = 1800;

/* ------------------------------------------------------------- interfaccia */

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

function humanSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return (i === 0 ? value : value.toFixed(value < 10 ? 1 : 0)) + " " + units[i];
}

function countdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
}

function showView(name) {
  $("#view-home").hidden = name !== "home";
  $("#view-room").hidden = name !== "room";
  window.scrollTo({ top: 0 });
}

/* --------------------------------------------------------------- rete/XHR */

/** fetch() non espone il progresso di upload, XHR si'. */
function send(method, url, body, headers = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (onProgress) {
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    }
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
      else reject(new Error((data && data.error) || "http_" + xhr.status));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(body);
  });
}

async function api(path, options) {
  const res = await fetch("/api" + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "http_" + res.status);
  return data;
}

const ERRORS = {
  room_not_found: "Stanza inesistente o gia' scaduta.",
  file_too_large: "File troppo grande per una stanza.",
  incomplete_upload: "Trasferimento interrotto, riprova.",
  file_not_found: "Il file non c'e' piu'.",
  room_exists: "Codice gia' in uso, riprova.",
  room_full: "Stanza piena.",
  room_quota: "Spazio della stanza esaurito.",
  slow_down: "Troppe richieste, aspetta un attimo.",
  network: "Connessione interrotta.",
};

const explain = (err) => ERRORS[err.message] || "Qualcosa e' andato storto (" + err.message + ").";

/* ------------------------------------------------------------------ home */

function buildTtlChips() {
  const box = $("#ttl");
  box.innerHTML = "";
  for (const opt of TTLS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("role", "radio");
    chip.textContent = opt.label;
    chip.setAttribute("aria-checked", String(opt.s === chosenTtl));
    chip.onclick = () => {
      chosenTtl = opt.s;
      for (const other of box.children) other.setAttribute("aria-checked", String(other === chip));
    };
    box.append(chip);
  }
}

function buildCodeInput() {
  const box = $("#code-input");
  box.innerHTML = "";
  const cells = [];

  const readAll = () => cells.map((c) => c.value).join("");

  for (let i = 0; i < CODE_LENGTH; i++) {
    if (i === CODE_LENGTH / 2) {
      const sep = document.createElement("span");
      sep.className = "sep";
      box.append(sep);
    }
    const cell = document.createElement("input");
    cell.className = "code-cell";
    cell.maxLength = 1;
    cell.autocomplete = "off";
    cell.autocapitalize = "characters";
    cell.spellcheck = false;
    cell.inputMode = "text";
    cell.setAttribute("aria-label", "Carattere " + (i + 1));

    cell.oninput = () => {
      cell.value = normalizeCode(cell.value).slice(-1);
      if (cell.value && cells[i + 1]) cells[i + 1].focus();
      $("#btn-join").disabled = !isCompleteCode(readAll());
    };

    cell.onkeydown = (e) => {
      if (e.key === "Backspace" && !cell.value && cells[i - 1]) {
        cells[i - 1].focus();
        cells[i - 1].value = "";
        e.preventDefault();
        $("#btn-join").disabled = true;
      }
      if (e.key === "ArrowLeft" && cells[i - 1]) cells[i - 1].focus();
      if (e.key === "ArrowRight" && cells[i + 1]) cells[i + 1].focus();
      if (e.key === "Enter" && isCompleteCode(readAll())) $("#btn-join").click();
    };

    cell.onpaste = (e) => {
      e.preventDefault();
      const text = normalizeCode(e.clipboardData.getData("text"));
      text.split("").forEach((ch, k) => {
        if (cells[i + k]) cells[i + k].value = ch;
      });
      const next = Math.min(cells.length - 1, i + text.length);
      cells[next].focus();
      $("#btn-join").disabled = !isCompleteCode(readAll());
    };

    cells.push(cell);
    box.append(cell);
  }

  return { read: readAll, focus: () => cells[0].focus(), clear: () => cells.forEach((c) => (c.value = "")) };
}

/* ------------------------------------------------------------ stanze */

async function createRoom() {
  const btn = $("#btn-create");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Apertura...";
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const room = await deriveRoom(randomCode());
      try {
        const res = await api("/room", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: room.roomId, ttl: chosenTtl }),
        });
        await enterRoom(room, res);
        return;
      } catch (err) {
        if (err.message !== "room_exists") throw err;
      }
    }
    throw new Error("room_exists");
  } catch (err) {
    toast(explain(err));
  } finally {
    btn.disabled = false;
    btn.querySelector("span").textContent = "Apri la stanza";
  }
}

async function joinRoom(rawCode, { silent = false } = {}) {
  const btn = $("#btn-join");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Apertura...";
  try {
    const room = await deriveRoom(rawCode);
    const res = await api("/room/" + room.roomId);
    await enterRoom(room, res);
  } catch (err) {
    if (!silent) toast(explain(err));
    location.hash = "#/";
  } finally {
    btn.querySelector("span").textContent = "Entra";
    btn.disabled = false;
  }
}

async function enterRoom(room, info) {
  state.room = room;
  state.expiresAt = info.expiresAt;
  state.ttl = info.ttl;
  state.files = [];
  state.thumbs.clear();

  $("#room-code").textContent = formatCode(room.code);
  showView("room");

  const target = "#/r/" + room.code;
  if (location.hash !== target) history.replaceState(null, "", target);

  startClock();
  if (info.files) await paintFiles(info.files);
  else await refresh();
}

function leaveRoom() {
  state.room = null;
  state.files = [];
  for (const url of state.thumbs.values()) URL.revokeObjectURL(url);
  state.thumbs.clear();
  clearInterval(state.clock);
  $("#grid").innerHTML = "";
  $("#queue").hidden = true;
  $("#queue").innerHTML = "";
  location.hash = "#/";
  showView("home");
}

function startClock() {
  clearInterval(state.clock);
  const tick = () => {
    const left = state.expiresAt - Date.now();
    if (left <= 0) {
      clearInterval(state.clock);
      toast("La stanza e' scaduta. I file sono stati cancellati.");
      leaveRoom();
      return;
    }
    $("#timer-fill").style.transform = "scaleX(" + Math.min(1, left / (state.ttl * 1000)) + ")";
    $("#timer-text").textContent = "si dissolve tra " + countdown(left);
    $(".timer").classList.toggle("urgent", left < 120000);
  };
  tick();
  state.clock = setInterval(tick, 1000);
}

/* ------------------------------------------------------------ lista file */

async function refresh() {
  if (!state.room) return;
  try {
    const res = await api("/room/" + state.room.roomId);
    state.expiresAt = res.expiresAt;
    state.ttl = res.ttl;
    await paintFiles(res.files);
  } catch (err) {
    if (err.message === "room_not_found") {
      toast("La stanza non esiste piu'.");
      leaveRoom();
    }
  }
}

async function paintFiles(rawFiles) {
  const files = [];
  for (const f of rawFiles) {
    const meta = await openMeta(state.room.key, f.meta);
    files.push({ ...f, name: meta?.n || "file", type: meta?.t || "", hash: meta?.h || "", lm: meta?.lm });
  }
  state.files = files;
  renderGrid();
  files.filter((f) => f.thumb && !state.thumbs.has(f.id)).forEach(loadThumb);
}

function renderGrid() {
  const grid = $("#grid");
  grid.innerHTML = "";
  const bytes = state.files.reduce((n, f) => n + f.size, 0);
  $("#file-count").textContent = state.files.length ? state.files.length + " file · " + humanSize(bytes) : "";
  $("#empty").hidden = state.files.length > 0;
  $("#btn-zip").hidden = state.files.length < 2;

  for (const f of state.files) grid.append(fileCard(f));
}

function fileCard(f) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.id = f.id;

  const thumb = document.createElement("div");
  thumb.className = "card-thumb";
  const url = state.thumbs.get(f.id);
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    thumb.append(img);
  } else {
    thumb.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M13 3v5h5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  }

  const body = document.createElement("div");
  body.className = "card-body";

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = f.name;
  name.title = f.name;

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = humanSize(f.size);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const get = document.createElement("button");
  get.className = "btn ghost tiny";
  get.type = "button";
  get.textContent = "Scarica";
  get.onclick = () => downloadOne(f, card);

  const del = document.createElement("button");
  del.className = "btn ghost tiny danger";
  del.type = "button";
  del.textContent = "Elimina";
  del.onclick = async () => {
    del.disabled = true;
    try {
      await api("/room/" + state.room.roomId + "/file/" + f.id, { method: "DELETE" });
      await refresh();
    } catch (err) {
      toast(explain(err));
      del.disabled = false;
    }
  };

  const progress = document.createElement("div");
  progress.className = "card-progress";

  actions.append(get, del);
  body.append(name, meta, actions);
  card.append(thumb, body, progress);
  return card;
}

async function loadThumb(f) {
  try {
    const res = await fetch("/api/room/" + state.room.roomId + "/thumb/" + f.id);
    if (!res.ok) return;
    const frame = new Uint8Array(await res.arrayBuffer());
    const plain = await decryptChunk(state.room.key, 0, frame);
    const url = URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
    state.thumbs.set(f.id, url);
    const card = $('.card[data-id="' + f.id + '"] .card-thumb');
    if (card) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      card.innerHTML = "";
      card.append(img);
    }
  } catch {
    /* miniatura assente: pazienza, il file resta scaricabile */
  }
}

/* --------------------------------------------------------------- upload */

function addJob(label) {
  const queue = $("#queue");
  queue.hidden = false;
  const row = document.createElement("div");
  row.className = "job";
  row.innerHTML =
    '<span class="job-name"></span><span class="job-stage"></span><span class="job-bar"><i></i></span>';
  row.querySelector(".job-name").textContent = label;
  queue.append(row);

  return {
    set(stage, ratio) {
      row.querySelector(".job-stage").textContent = stage;
      if (ratio != null) row.querySelector(".job-bar i").style.width = Math.round(ratio * 100) + "%";
    },
    fail(message) {
      row.classList.add("error");
      row.querySelector(".job-stage").textContent = message;
      setTimeout(() => row.remove(), 6000);
    },
    done() {
      row.remove();
      if (!queue.children.length) queue.hidden = true;
    },
  };
}

async function makeThumb(file) {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const side = 640;
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.72));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null; // HEIC e formati esotici: si scarica comunque l'originale
  }
}

/** Cifra il file a blocchi, senza mai toccare i byte originali. */
async function encryptFile(file, key, job) {
  const frames = [];
  const digest = digestAccumulator();
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  for (let index = 0; index < total; index++) {
    const slice = await file.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE).arrayBuffer();
    await digest.add(slice);
    frames.push(await encryptChunk(key, index, slice));
    job.set("cifratura", ((index + 1) / total) * 0.4);
  }

  return { frames, hash: await digest.finish() };
}

async function uploadFile(file) {
  const room = state.room;
  const job = addJob(file.name);

  try {
    job.set("cifratura", 0.02);
    const thumbData = await makeThumb(file);
    const { frames, hash } = await encryptFile(file, room.key, job);

    const meta = await sealMeta(room.key, {
      n: file.name,
      t: file.type || "application/octet-stream",
      h: hash,
      lm: file.lastModified,
    });

    const headers = {
      "x-dr-meta": meta,
      "x-dr-size": String(file.size),
      "x-dr-chunk": String(CHUNK_SIZE),
      "x-dr-thumb": thumbData ? "1" : "0",
    };

    // Il flusso cifrato parte a pezzi: la stanza li deposita a blocchi e li
    // rimette in fila da sola. L'offset e' assoluto, quindi un pezzo rispedito
    // dopo un errore di rete riscrive lo stesso posto invece di duplicarsi.
    const cipher = new Blob(frames);
    const start = await send("POST", "/api/room/" + room.roomId + "/file", null, {
      ...headers,
      "x-dr-stored": String(cipher.size),
    });
    const fileId = start.fileId;

    for (let offset = 0; offset < cipher.size; offset += start.partSize) {
      const slice = cipher.slice(offset, Math.min(offset + start.partSize, cipher.size));
      const base = offset;
      await send(
        "PUT",
        "/api/room/" + room.roomId + "/file/" + fileId + "?offset=" + offset,
        slice,
        {},
        (r) => job.set("invio", 0.4 + ((base + slice.size * r) / cipher.size) * 0.55)
      );
    }

    await send("POST", "/api/room/" + room.roomId + "/file/" + fileId + "/commit", null, {});

    if (thumbData) {
      job.set("anteprima", 0.99);
      const sealed = await encryptChunk(room.key, 0, thumbData);
      await send("PUT", "/api/room/" + room.roomId + "/thumb/" + fileId, new Blob([sealed]), {
        "x-dr-chunk": String(thumbData.length),
      });
    }

    job.done();
    await refresh();
  } catch (err) {
    job.fail(explain(err));
  }
}

async function handleFiles(list) {
  const files = Array.from(list).filter((f) => f.size >= 0);
  if (!files.length) return;
  state.busy = true;
  for (const file of files) await uploadFile(file);
  state.busy = false;
}

/* ------------------------------------------------------------- download */

async function fetchAndDecrypt(f, onProgress) {
  const res = await fetch("/api/room/" + state.room.roomId + "/file/" + f.id);
  if (!res.ok) throw new Error("http_" + res.status);

  const expected = Number(res.headers.get("x-dr-stored") || res.headers.get("content-length") || 0);
  const reader = res.body.getReader();
  const blocks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    blocks.push(value);
    received += value.length;
    if (onProgress && expected) onProgress((received / expected) * 0.7);
  }

  const cipher = new Uint8Array(received);
  let at = 0;
  for (const b of blocks) {
    cipher.set(b, at);
    at += b.length;
  }

  const frameSize = (f.chunk || CHUNK_SIZE) + FRAME_OVERHEAD;
  const digest = digestAccumulator();
  const plain = [];
  let index = 0;

  for (let offset = 0; offset < cipher.length; offset += frameSize, index++) {
    const frame = cipher.subarray(offset, Math.min(offset + frameSize, cipher.length));
    const chunk = await decryptChunk(state.room.key, index, frame);
    await digest.add(chunk);
    plain.push(chunk);
    if (onProgress) onProgress(0.7 + ((offset + frameSize) / cipher.length) * 0.3);
  }

  const intact = !f.hash || (await digest.finish()) === f.hash;
  return { chunks: plain, intact };
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadOne(f, card) {
  const bar = card.querySelector(".card-progress");
  try {
    const { chunks, intact } = await fetchAndDecrypt(f, (r) => (bar.style.width = Math.round(r * 100) + "%"));
    save(new Blob(chunks, { type: f.type || "application/octet-stream" }), f.name);
    bar.style.width = "0";
    if (!intact) toast("Attenzione: l'impronta del file non combacia.");
  } catch (err) {
    bar.style.width = "0";
    toast(explain(err));
  }
}

async function downloadAll() {
  const job = addJob("Archivio di " + state.files.length + " file");
  try {
    const names = uniqueNames(state.files.map((f) => f.name));
    const entries = [];
    let broken = 0;

    for (let i = 0; i < state.files.length; i++) {
      const f = state.files[i];
      job.set("scarico " + (i + 1) + "/" + state.files.length, i / state.files.length);
      const { chunks, intact } = await fetchAndDecrypt(f);
      if (!intact) broken++;
      entries.push({ name: names[i], chunks, date: f.lm ? new Date(f.lm) : new Date(f.at) });
    }

    job.set("creo l'archivio", 0.98);
    save(buildZip(entries), "darkroom-" + state.room.code.toLowerCase() + ".zip");
    job.done();
    if (broken) toast(broken + " file con impronta non corrispondente.");
  } catch (err) {
    job.fail(explain(err));
  }
}

/* ----------------------------------------------------------------- avvio */

function route() {
  const match = location.hash.match(/^#\/r\/([A-Za-z0-9-]+)/);
  if (match) {
    const code = normalizeCode(match[1]);
    if (state.room && state.room.code === code) return;
    if (isCompleteCode(code)) {
      joinRoom(code, { silent: false });
      return;
    }
  }
  if (state.room) leaveRoom();
  else showView("home");
}

function wire() {
  buildTtlChips();
  const codeInput = buildCodeInput();

  $("#btn-create").onclick = createRoom;
  $("#btn-join").onclick = () => joinRoom(codeInput.read());
  $("#btn-leave").onclick = leaveRoom;
  $("#btn-zip").onclick = downloadAll;

  $("#btn-copy-code").onclick = async () => {
    await navigator.clipboard.writeText(state.room.code);
    toast("Codice copiato.", "ok");
  };

  $("#btn-copy-link").onclick = async () => {
    await navigator.clipboard.writeText(location.origin + "/#/r/" + state.room.code);
    toast("Link copiato. Chi ce l'ha entra nella stanza.", "ok");
  };

  const input = $("#file-input");
  input.onchange = () => {
    handleFiles(input.files);
    input.value = "";
  };

  const drop = $("#drop");
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add("hot");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.remove("hot");
    });
  }
  drop.addEventListener("drop", (e) => e.dataTransfer && handleFiles(e.dataTransfer.files));

  window.addEventListener("paste", (e) => {
    if (!state.room || !e.clipboardData?.files.length) return;
    handleFiles(e.clipboardData.files);
  });

  window.addEventListener("beforeunload", (e) => {
    if (!state.busy) return;
    e.preventDefault();
    e.returnValue = "";
  });

  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.room && !state.busy) refresh();
  });

  route();
  if (!state.room) codeInput.focus();
}

wire();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
