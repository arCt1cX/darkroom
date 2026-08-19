# DrewShare

Passare file da un dispositivo all'altro senza cavi, senza account, senza
mandarli a se stessi su WhatsApp e ritrovarseli ricompressi. Due telefoni, due
computer, un telefono e un portatile altrui: la direzione non conta.

Apri una stanza su un dispositivo, ottieni un codice di sei caratteri, ci butti
dentro quello che serve. Dall'altro dispositivo scrivi lo stesso codice e te lo
riprendi. Scaduto il tempo che hai scelto, la stanza si dissolve.

L'interfaccia è in italiano e in inglese, con lo switch in alto a destra: la
prima volta segue la lingua del browser, poi ricorda la scelta.

Chiudere il sito non chiude la stanza: riaprendolo, le stanze ancora vive sono
in cima alla home e si rientra con un tocco.

Gira interamente su Cloudflare (Worker + Durable Objects), dentro il piano
gratuito e **senza metodo di pagamento**.

---

## Le tre cose che contano

**Gli originali restano originali.** I byte del file vengono spediti così come
sono: niente `canvas`, niente ridimensionamento, niente ricompressione. EXIF,
profilo colore e data arrivano intatti. Ogni file porta con sé
un'impronta SHA-256 calcolata prima della partenza e riverificata dopo il
download: se un byte fosse cambiato, l'app lo direbbe.

**Il server non può leggere niente.** Il codice della stanza non lascia mai il
browser. Da lì si ricavano due cose diverse:

```
roomId = SHA-256("drewshare-room-v1|" + CODICE)      -> questo va al server
chiave = PBKDF2(CODICE, salt = SHA-256("drewshare-salt-v1|" + CODICE), 250k)
```

Il server riceve solo `roomId`, e da un hash non si torna indietro al codice.
Contenuti, nomi dei file, tipo MIME e impronte viaggiano cifrati in
AES-256-GCM a blocchi da 4 MiB, ognuno con il proprio IV e con l'indice del
blocco come dato autenticato (così non si possono riordinare i pezzi). Nello
storage restano blob opachi.

**Sparisce da solo.** La scadenza la scegli tu (da 15 minuti a 7 giorni). Ogni
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
niente propagazione da aspettare fra il dispositivo che carica e quello che
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
`https://drewshare.<tuo-sottodominio>.workers.dev`: il sottodominio segue il
campo `name` di `wrangler.jsonc`. La PWA e l'API stanno nello stesso Worker:
niente progetto Pages separato da collegare.

> **Se rinomini il Worker.** Cambiare `name` non rinomina quello vecchio: ne
> crea uno nuovo, con un namespace Durable Objects vuoto. Le stanze aperte
> sull'indirizzo precedente restano lì fino alla loro scadenza e poi muoiono da
> sole, ma non sono raggiungibili dal nuovo. Il vecchio Worker va cancellato a
> mano da Workers & Pages, e route o domini personalizzati vanno rifatti. Per
> lo stesso motivo le etichette `drewshare-*-v1` qui sopra si toccano solo in
> quell'occasione: entrano nell'hash, quindi cambiarle sposta indirizzo e
> chiave di ogni stanza.

### Dominio tuo (facoltativo)

Se hai un dominio su Cloudflare, aggiungi in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "drewshare.tuodominio.it", "custom_domain": true }]
```

e rilancia `npx wrangler deploy`.

### Deploy automatico a ogni push

Due strade, scegline una.

**Workers Builds** (dalla dashboard, zero configurazione): Workers & Pages →
`drewshare` → Settings → Builds → Connect repository, scegli questo repo. Da lì
in poi ogni push su `main` fa il deploy.

**GitHub Actions**: il repo contiene già
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Serve un segreto
`CLOUDFLARE_API_TOKEN` nelle impostazioni del repo, creato su
dash.cloudflare.com → My Profile → API Tokens → template *Edit Cloudflare
Workers*.

---

## Come si usa

1. **Dispositivo che manda** — apri il sito, scegli la durata, `Apri la stanza`.
   Compare un codice tipo `K7Q-M3X`.
2. Scegli i file (dalla galleria, dal disco, trascinandoli dentro o
   incollandoli). Puoi continuare ad aggiungerne finché la stanza è viva.
3. **Dispositivo che riceve** — che sia un altro telefono, un computer o il
   portatile di qualcun altro: apri lo stesso sito, scrivi il codice, `Entra`.
   Trovi tutto lì.
   Clicca su una miniatura per aprire il file a schermo intero: le foto si
   guardano, i video si riproducono, si passa da uno all'altro con le frecce.
   `Scarica` prende il singolo file, `Scarica tutto (.zip)` l'intero blocco.

`Copia link` mette negli appunti un indirizzo che contiene già il codice: chi ce
l'ha entra senza digitare niente. Comodo, ma trattalo come una chiave, perché lo è.

**Stanze recenti.** Ogni stanza in cui entri resta annotata in `localStorage`
(le ultime sei), e sulla home compare come pastiglia con il tempo che le resta:
un tocco e sei dentro, senza ridigitare il codice. Serve proprio a questo — dal
PC ti prendi i file, dal telefono ne aggiungi altri, e nessuno dei due deve
ricordarsi niente. Le stanze scadute spariscono da sole; la × le toglie subito.

Il codice però *è* la chiave, quindi lì dentro resta in chiaro: chi mette le
mani su quel dispositivo rientra nelle stanze ancora vive. Su un computer non
tuo, usa la × quando hai finito.

Sul telefono conviene installarla come app: dal menù del browser,
*Aggiungi a schermata Home*. In quella modalità la pagina occupa tutto lo
schermo e tiene conto da sola di tacca, Dynamic Island e barra dei gesti.

---

## Note pratiche

**iPhone e HEIC.** Scegliendo le foto dal picker *Foto*, iOS a volte converte in
JPEG prima di consegnare il file all'app: in quel caso DrewShare riceve già un
JPEG e lo spedisce intatto, ma l'HEIC originale non è mai arrivato. Per avere il
file esatto, usa la voce *Sfoglia*/*File* del picker, oppure disattiva
Impostazioni → Foto → *Trasferisci su Mac o PC* → **Mantieni originali**. Su
Android arrivano sempre i byte originali.

**Video.** Trattati come tutto il resto: byte invariati, nessuna
transcodifica. La miniatura è un fotogramma preso poco dopo l'inizio, e nel
visualizzatore partono con i comandi di riproduzione. Il browser deve saper
decodificare il formato: MP4/H.264 e WebM vanno sempre, qualche registrazione
esotica no — in quel caso resta il download, intatto.

**Anteprime.** Sia per le foto sia per i video viene generata una miniatura JPEG
separata, anche lei cifrata, giusto per riconoscere i file a colpo d'occhio.
L'originale non viene toccato. Per gli HEIC il browser spesso non sa disegnare
l'anteprima: si vede l'icona generica, il download resta perfetto.

**Visualizzatore.** Aprire un file significa scaricarlo e decifrarlo per intero:
non c'è modo di mostrare metà di un blocco AES-GCM. Gli ultimi sei file aperti
restano in memoria, così rivederli o scaricarli dopo averli guardati è
immediato.

**Memoria.** Cifratura e decifratura passano per la RAM del browser: le foto
non sono un problema, un video da qualche centinaio di MB su un telefono
modesto sì. L'upload parte comunque a pezzi da 6 MiB, così il limite di 100 MB
sul corpo delle richieste Workers non si vede mai.

**Limiti.** 300 file e 1 GiB per stanza, 300 MB per singolo file. Si cambiano
poco sotto metà di [`src/worker.js`](src/worker.js), tenendo d'occhio i 5 GB di
storage complessivi del piano Free.

**Sicurezza.** Il codice ha 30 bit di entropia (32^6 ≈ 1,07 miliardi di
combinazioni) e vive al massimo sette giorni. Non essendo indovinabile offline —
serve una richiesta al server per ogni tentativo — la difesa è il costo dei
tentativi: il Worker conta solo i buchi nell'acqua e ne concede 40 al minuto per
indirizzo, cioè ~403.000 in una settimana intera, meno dello 0,04% dello spazio
dei codici; passarlo tutto da un solo indirizzo vorrebbe dire una cinquantina
d'anni. Chi sta usando una stanza davvero non viene mai frenato. Chi ottiene il
codice ottiene la stanza: è quello il modello, e una settimana è una finestra
sette volte più larga di prima — se il contenuto è delicato, scegli una durata
corta.

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
`DREWSHARE_TEST_BIG=1` aggiunge un file da 60 MB spedito in undici pezzi.

## Struttura

```
src/worker.js        smistamento + la Durable Object. Vede solo blob opachi.
public/index.html    la pagina, unica
public/app.js        stanze, upload, download, anteprime
public/crypto.js     derivazione della chiave e cifratura a blocchi
public/i18n.js       dizionari italiano/inglese e traduzione della pagina
public/recents.js    le ultime stanze visitate, per rientrarci senza codice
public/zip.js        archivio "store", senza ricomprimere niente
public/sw.js         service worker: in cache il guscio, mai i file
tools/gen-icons.mjs  icone PNG generate senza dipendenze
tools/e2e-test.mjs   prova end-to-end
```

## Licenza

MIT.
