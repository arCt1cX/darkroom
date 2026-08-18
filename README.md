# Darkroom

Passare foto e video dal telefono al computer senza cavi, senza account, senza
mandarli a se stessi su WhatsApp e ritrovarseli ricompressi.

Apri una stanza dal telefono, ottieni un codice di otto caratteri, ci butti
dentro i file. Dal computer scrivi lo stesso codice e te li riprendi. Scaduto il
tempo che hai scelto, la stanza si dissolve.

Gira interamente su Cloudflare (Worker + Durable Objects), dentro il piano
gratuito e **senza metodo di pagamento**.

---

## Le tre cose che contano

**Gli originali restano originali.** I byte del file vengono spediti così come
sono: niente `canvas`, niente ridimensionamento, niente ricompressione. EXIF,
profilo colore e data di scatto arrivano intatti. Ogni file porta con sé
un'impronta SHA-256 calcolata prima della partenza e riverificata dopo il
download: se un byte fosse cambiato, l'app lo direbbe.

**Il server non può leggere niente.** Il codice della stanza non lascia mai il
browser. Da lì si ricavano due cose diverse:

```
roomId = SHA-256("darkroom-room-v1|" + CODICE)      -> questo va al server
chiave = PBKDF2(CODICE, salt = SHA-256("darkroom-salt-v1|" + CODICE), 250k)
```

Il server riceve solo `roomId`, e da un hash non si torna indietro al codice.
Contenuti, nomi dei file, tipo MIME e impronte viaggiano cifrati in
AES-256-GCM a blocchi da 4 MiB, ognuno con il proprio IV e con l'indice del
blocco come dato autenticato (così non si possono riordinare i pezzi). Nello
storage restano blob opachi.

**Sparisce da solo.** La scadenza la scegli tu (da 15 minuti a 3 giorni). Ogni
stanza programma un `alarm()` all'ora esatta della propria morte: scatta da
sola e cancella tutto, senza cron da aspettare. Chi arriva dopo trova 404.

---

## Dove finiscono i file

Ogni stanza è una **Durable Object** con storage SQLite: un oggetto per codice,
creato al volo. Il flusso cifrato viene spezzato in blocchi da 96 KiB (sotto il
limite di 128 KiB per valore) e riletto in ordine in streaming.

Perché non R2: attivarlo richiede un metodo di pagamento sulla dashboard, anche
restando dentro il piano gratuito. Le Durable Objects sono incluse nel piano
Free dal 2025 e non chiedono nulla. In cambio danno pure consistenza forte —
niente propagazione da aspettare fra il telefono che carica e il computer che
guarda — e la scadenza precisa via `alarm()`.

Limiti attuali del piano Free, per orientarsi: 5 GB di storage complessivo,
100.000 richieste al giorno, 100.000 righe scritte al giorno (una riga = un
blocco da 96 KiB, quindi una foto da 5 MB ne consuma ~55). Per un uso personale
sono numeri larghissimi.

## Deploy su Cloudflare

Serve solo un account Cloudflare gratuito.

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Fine — la Durable Object nasce da sola con la migrazione dichiarata in
`wrangler.jsonc`, non c'è niente da creare a mano. Wrangler stampa l'indirizzo,
del tipo
`https://darkroom.<tuo-sottodominio>.workers.dev`. La PWA e l'API stanno nello
stesso Worker: niente progetto Pages separato da collegare.

### Dominio tuo (facoltativo)

Se hai un dominio su Cloudflare, aggiungi in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "darkroom.tuodominio.it", "custom_domain": true }]
```

e rilancia `npx wrangler deploy`.

### Deploy automatico a ogni push

Due strade, scegline una.

**Workers Builds** (dalla dashboard, zero configurazione): Workers & Pages →
`darkroom` → Settings → Builds → Connect repository, scegli questo repo. Da lì
in poi ogni push su `main` fa il deploy.

**GitHub Actions**: il repo contiene già
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Serve un segreto
`CLOUDFLARE_API_TOKEN` nelle impostazioni del repo, creato su
dash.cloudflare.com → My Profile → API Tokens → template *Edit Cloudflare
Workers*.

---

## Come si usa

1. **Telefono** — apri il sito, scegli la durata, `Apri la stanza`. Compare un
   codice tipo `K7QM-3XPD`.
2. Tocca `Scegli i file` e prendi le foto dalla galleria. Puoi continuare ad
   aggiungerne finché la stanza è viva.
3. **Computer** — apri lo stesso sito, scrivi il codice, `Entra`. Trovi tutto lì:
   `Scarica` per un file, `Scarica tutto (.zip)` per l'intero blocco.

`Copia link` mette negli appunti un indirizzo che contiene già il codice: chi ce
l'ha entra senza digitare niente. Comodo, ma trattalo come una chiave, perché lo è.

Sul telefono conviene installarla come app: dal menù del browser,
*Aggiungi a schermata Home*.

---

## Note pratiche

**iPhone e HEIC.** Scegliendo le foto dal picker *Foto*, iOS a volte converte in
JPEG prima di consegnare il file all'app: in quel caso Darkroom riceve già un
JPEG e lo spedisce intatto, ma l'HEIC originale non è mai arrivato. Per avere il
file esatto, usa la voce *Sfoglia*/*File* del picker, oppure disattiva
Impostazioni → Foto → *Trasferisci su Mac o PC* → **Mantieni originali**. Su
Android arrivano sempre i byte originali.

**Anteprime.** Per le immagini viene generata una miniatura JPEG separata, anche
lei cifrata, giusto per riconoscere i file a colpo d'occhio. L'originale non
viene toccato. Per gli HEIC il browser spesso non sa disegnare l'anteprima: si
vede l'icona generica, il download resta perfetto.

**Memoria.** Cifratura e decifratura passano per la RAM del browser: le foto
non sono un problema, un video da qualche centinaio di MB su un telefono
modesto sì. L'upload parte comunque a pezzi da 6 MiB, così il limite di 100 MB
sul corpo delle richieste Workers non si vede mai.

**Limiti.** 300 file e 1 GiB per stanza, 300 MB per singolo file. Si cambiano
poco sotto metà di [`src/worker.js`](src/worker.js), tenendo d'occhio i 5 GB di
storage complessivi del piano Free.

**Sicurezza.** Il codice ha 40 bit di entropia (32^8) e vive al massimo tre
giorni: indovinarlo a tentativi è impraticabile, e comunque il Worker frena chi
insiste. Chi ottiene il codice ottiene la stanza — è quello il modello. Se ti
serve di più, accorcia la durata.

---

## Sviluppo

```bash
npm run dev      # wrangler dev, storage simulato in locale
npm run icons    # rigenera le icone PNG della PWA
```

Con il dev server acceso:

```bash
node tools/e2e-test.mjs http://127.0.0.1:8787
```

Cifra, carica, riscarica, decifra e confronta i byte uno per uno, prova la
chiave sbagliata, i metadati, lo zip e la cancellazione. Con
`DARKROOM_TEST_BIG=1` aggiunge un file da 60 MB spedito in undici pezzi.

## Struttura

```
src/worker.js        smistamento + la Durable Object. Vede solo blob opachi.
public/index.html    la pagina, unica
public/app.js        stanze, upload, download, anteprime
public/crypto.js     derivazione della chiave e cifratura a blocchi
public/zip.js        archivio "store", senza ricomprimere niente
public/sw.js         service worker: in cache il guscio, mai i file
tools/gen-icons.mjs  icone PNG generate senza dipendenze
tools/e2e-test.mjs   prova end-to-end
```

## Licenza

MIT.
