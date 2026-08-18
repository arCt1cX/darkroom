/**
 * ZIP minimale, solo "store" (nessuna compressione): le foto sono gia'
 * compresse, ricomprimerle costerebbe tempo per zero guadagno - e soprattutto
 * i byte finiscono nell'archivio identici a come sono usciti dalla fotocamera.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(chunks) {
  let c = 0xffffffff;
  for (const part of chunks) {
    for (let i = 0; i < part.length; i++) c = CRC_TABLE[(c ^ part[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosStamp(date) {
  const d = date && !isNaN(date) ? date : new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

/** Rende univoci i nomi in collisione: foto.jpg, foto (2).jpg, ... */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((raw) => {
    const name = raw.replace(/[\\/:*?"<>|]/g, "_") || "file";
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    return stem + " (" + n + ")" + ext;
  });
}

/**
 * @param {{name: string, chunks: Uint8Array[], date?: Date}[]} entries
 * @returns {Blob}
 */
export function buildZip(entries) {
  const enc = new TextEncoder();
  const output = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const size = entry.chunks.reduce((n, c) => n + c.length, 0);
    const crc = crc32(entry.chunks);
    const { time, day } = dosStamp(entry.date);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versione necessaria
    local.setUint16(6, 0x0800, true); // nomi in UTF-8
    local.setUint16(8, 0, true); // metodo: store
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    output.push(new Uint8Array(local.buffer), nameBytes, ...entry.chunks);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, day, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);

    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...output, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
