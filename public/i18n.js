/*
 * DrewShare - traduzioni.
 *
 * Un dizionario piatto per lingua, chiavi puntate. Le stringhe che contengono
 * markup (a capo, trattini insecabili) si applicano con data-i18n-html; tutte
 * le altre passano da textContent, cosi' una traduzione non puo' iniettare
 * niente nella pagina.
 */

export const LANGS = ["it", "en"];
export const LANG_NAMES = { it: "Italiano", en: "English" };

const STORE_KEY = "drewshare-lang";

const DICT = {
  it: {
    "app.title": "DrewShare",
    "app.description":
      "Passa file da un dispositivo all'altro. Cifrati end-to-end, originali intatti, cancellati da soli.",
    "app.brandAria": "DrewShare, home",
    "app.tag": "cifrato end‑to‑end",
    "app.langAria": "Lingua",
    "app.langSwitch": "Passa all'inglese",

    "home.title": "Trasferimento file temporaneo,<br>cifrato end&#8209;to&#8209;end.",
    "home.lede":
      "Si apre una stanza da un dispositivo e si carica quello che serve: foto, video, documenti. Da un altro dispositivo — un secondo telefono, un computer, il portatile di qualcun altro — si scrive lo stesso codice e si ritrova tutto. I file arrivano identici all’originale e vengono cancellati alla scadenza scelta.",

    "home.create.h": "Apri una stanza",
    "home.create.p": "Durata della stanza. Allo scadere i file vengono rimossi dallo storage.",
    "home.create.ttlAria": "Durata della stanza",
    "home.create.btn": "Apri la stanza",
    "home.create.btnBusy": "Apertura…",

    "home.join.h": "Entra con il codice",
    "home.join.p": "Sei caratteri, maiuscole e minuscole indifferenti. Si possono incollare in blocco.",
    "home.join.codeAria": "Codice della stanza",
    "home.join.cellAria": "Carattere {n}",
    "home.join.btn": "Entra",
    "home.join.btnBusy": "Apertura…",

    "facts.1.h": "Nessuna ricompressione",
    "facts.1.p":
      "I byte vengono trasferiti invariati: risoluzione, EXIF e profilo colore restano quelli di partenza. Un’impronta SHA‑256 viene verificata al download.",
    "facts.2.h": "Cifratura sul dispositivo",
    "facts.2.p":
      "AES‑256‑GCM con chiave derivata dal codice via PBKDF2. Al server arriva solo un hash del codice: contenuti e nomi dei file restano illeggibili.",
    "facts.3.h": "Cancellazione automatica",
    "facts.3.p":
      "Ogni stanza registra la propria scadenza alla creazione e si cancella da sola quando la raggiunge. I singoli file si possono rimuovere prima.",

    "recents.h": "Stanze recenti",
    "recents.note":
      "Restano solo su questo dispositivo, e il codice e’ la chiave: se il dispositivo non e’ tuo, dimenticale.",
    "recents.left": "ancora {t}",
    "recents.forget": "Dimentica la stanza {code}",

    "room.codeLabel": "Codice stanza",
    "room.copyCode": "Copia codice",
    "room.copyLink": "Copia link",
    "room.leave": "Esci",
    "room.expiresIn": "scade tra {t}",
    "room.expired": "Stanza scaduta. I file sono stati cancellati.",
    "room.gone": "La stanza non esiste piu’.",
    "room.codeCopied": "Codice copiato.",
    "room.linkCopied": "Link copiato. Chi ce l’ha entra nella stanza.",
    "room.copyFailed": "Copia non riuscita: seleziona il codice a mano.",

    "drop.title": "Scegli foto, video o altri file",
    "drop.sub": "oppure trascinali qui dentro",
    "drop.note":
      "La cifratura avviene sul dispositivo prima dell’invio. I file originali non vengono modificati.",

    "files.h": "Nella stanza",
    "files.zip": "Scarica tutto (.zip)",
    "files.empty": "Ancora niente qui dentro.",
    "files.count": "{n} file · {size}",
    "files.download": "Scarica",
    "files.delete": "Elimina",
    "files.open": "Apri {name}",

    "job.encrypting": "cifratura",
    "job.sending": "invio",
    "job.thumb": "anteprima",
    "job.archive": "Archivio di {n} file",
    "job.fetching": "scarico {i}/{n}",
    "job.zipping": "creo l’archivio",
    "job.broken": "{n} file con impronta non corrispondente.",
    "job.mismatch": "Attenzione: l’impronta di {name} non combacia.",

    "viewer.download": "Scarica",
    "viewer.close": "Chiudi",
    "viewer.prev": "Precedente",
    "viewer.next": "Successivo",
    "viewer.meta": "{size} · {i} di {n}",
    "viewer.decrypting": "decifratura in corso",
    "viewer.unsupported":
      "Questo tipo di file non si puo’ mostrare nel browser. Scaricalo per aprirlo.",

    "foot.storage": "storage cifrato su Cloudflare, per la durata impostata",

    "ttl.900": "15 min",
    "ttl.1800": "30 min",
    "ttl.3600": "1 ora",
    "ttl.21600": "6 ore",
    "ttl.86400": "24 ore",
    "ttl.259200": "3 giorni",

    "err.room_not_found": "Stanza inesistente o gia’ scaduta.",
    "err.file_too_large": "File troppo grande per una stanza.",
    "err.incomplete_upload": "Trasferimento interrotto, riprova.",
    "err.file_not_found": "Il file non c’e’ piu’.",
    "err.room_exists": "Codice gia’ in uso, riprova.",
    "err.room_full": "Stanza piena.",
    "err.room_quota": "Spazio della stanza esaurito.",
    "err.slow_down": "Troppe richieste, aspetta un attimo.",
    "err.network": "Connessione interrotta.",
    "err.generic": "Qualcosa e’ andato storto ({code}).",
  },

  en: {
    "app.title": "DrewShare",
    "app.description":
      "Move files from one device to another. End-to-end encrypted, originals untouched, deleted on their own.",
    "app.brandAria": "DrewShare, home",
    "app.tag": "end‑to‑end encrypted",
    "app.langAria": "Language",
    "app.langSwitch": "Switch to Italian",

    "home.title": "Temporary file transfer,<br>end&#8209;to&#8209;end encrypted.",
    "home.lede":
      "Open a room on one device and drop in whatever you need: photos, videos, documents. From another device — a second phone, a computer, someone else’s laptop — type the same code and it’s all there. Files arrive byte-identical to the originals and are deleted when the timer you picked runs out.",

    "home.create.h": "Open a room",
    "home.create.p": "How long the room lives. When it expires the files are wiped from storage.",
    "home.create.ttlAria": "Room lifetime",
    "home.create.btn": "Open the room",
    "home.create.btnBusy": "Opening…",

    "home.join.h": "Join with a code",
    "home.join.p": "Six characters, case doesn’t matter. You can paste them all at once.",
    "home.join.codeAria": "Room code",
    "home.join.cellAria": "Character {n}",
    "home.join.btn": "Join",
    "home.join.btnBusy": "Joining…",

    "facts.1.h": "No re-compression",
    "facts.1.p":
      "Bytes travel untouched: resolution, EXIF and colour profile stay exactly as they were. An SHA‑256 fingerprint is checked on download.",
    "facts.2.h": "Encrypted on your device",
    "facts.2.p":
      "AES‑256‑GCM with a key derived from the code via PBKDF2. The server only ever sees a hash of the code: contents and file names stay unreadable.",
    "facts.3.h": "Deletes itself",
    "facts.3.p":
      "Every room records its own expiry when it is created and wipes itself the moment it arrives. Individual files can be removed sooner.",

    "recents.h": "Recent rooms",
    "recents.note":
      "They live on this device only, and the code is the key: if the device isn’t yours, forget them.",
    "recents.left": "{t} left",
    "recents.forget": "Forget room {code}",

    "room.codeLabel": "Room code",
    "room.copyCode": "Copy code",
    "room.copyLink": "Copy link",
    "room.leave": "Leave",
    "room.expiresIn": "expires in {t}",
    "room.expired": "Room expired. The files have been deleted.",
    "room.gone": "This room no longer exists.",
    "room.codeCopied": "Code copied.",
    "room.linkCopied": "Link copied. Anyone with it walks straight into the room.",
    "room.copyFailed": "Couldn’t copy: select the code by hand.",

    "drop.title": "Pick photos, videos or any other file",
    "drop.sub": "or drag them in here",
    "drop.note":
      "Encryption happens on this device before anything is sent. Your original files are never modified.",

    "files.h": "In the room",
    "files.zip": "Download all (.zip)",
    "files.empty": "Nothing in here yet.",
    "files.count": "{n} files · {size}",
    "files.download": "Download",
    "files.delete": "Delete",
    "files.open": "Open {name}",

    "job.encrypting": "encrypting",
    "job.sending": "sending",
    "job.thumb": "preview",
    "job.archive": "Archive of {n} files",
    "job.fetching": "fetching {i}/{n}",
    "job.zipping": "building the archive",
    "job.broken": "{n} files with a mismatching fingerprint.",
    "job.mismatch": "Careful: the fingerprint of {name} doesn’t match.",

    "viewer.download": "Download",
    "viewer.close": "Close",
    "viewer.prev": "Previous",
    "viewer.next": "Next",
    "viewer.meta": "{size} · {i} of {n}",
    "viewer.decrypting": "decrypting",
    "viewer.unsupported": "This kind of file can’t be shown in the browser. Download it to open it.",

    "foot.storage": "encrypted storage on Cloudflare, for as long as you set",

    "ttl.900": "15 min",
    "ttl.1800": "30 min",
    "ttl.3600": "1 hour",
    "ttl.21600": "6 hours",
    "ttl.86400": "24 hours",
    "ttl.259200": "3 days",

    "err.room_not_found": "No such room, or it has already expired.",
    "err.file_too_large": "That file is too large for a room.",
    "err.incomplete_upload": "Transfer interrupted, try again.",
    "err.file_not_found": "That file is gone.",
    "err.room_exists": "Code already in use, try again.",
    "err.room_full": "Room is full.",
    "err.room_quota": "The room is out of space.",
    "err.slow_down": "Too many requests, hold on a second.",
    "err.network": "Connection dropped.",
    "err.generic": "Something went wrong ({code}).",
  },
};

function stored() {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null; // Safari in navigazione privata puo' rifiutarsi
  }
}

/** Preferenza salvata, altrimenti la lingua del browser, altrimenti inglese. */
function detect() {
  const saved = stored();
  if (saved && LANGS.includes(saved)) return saved;
  for (const tag of navigator.languages || [navigator.language || ""]) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return "en";
}

let current = detect();

export const getLang = () => current;

export function setLang(lang) {
  if (!LANGS.includes(lang) || lang === current) return false;
  current = lang;
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {}
  return true;
}

/** t("files.count", { n: 3, size: "1.2 MB" }) */
export function t(key, vars) {
  const raw = DICT[current][key] ?? DICT.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/**
 * Applica le traduzioni al markup statico.
 *   data-i18n="chiave"            -> testo
 *   data-i18n-html="chiave"       -> markup (solo stringhe nostre)
 *   data-i18n-attr="aria-label:chiave, title:altra"
 */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);

  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(",")) {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }

  document.documentElement.lang = current;
  document.title = t("app.title");
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", t("app.description"));
}
