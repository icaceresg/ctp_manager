// Importa las piezas de la hoja de calendario de un Excel (formato del
// "CTP · Calendario de contenido": Nº, Fecha, Hora, Pieza, Redes, Estado…)
// como tarjetas de la app.
//
// Uso:
//   npm run importar -- "C:\ruta\calendario.xlsx"               importa las piezas nuevas
//   npm run importar -- "C:\ruta\calendario.xlsx" --prueba      muestra qué haría, sin guardar
//   npm run importar -- "C:\ruta\calendario.xlsx" --actualizar  además sobrescribe las ya importadas
//   npm run importar -- "C:\ruta\calendario.xlsx" --json=tarjetas.json
//       solo guarda las tarjetas en un JSON, para importarlas con import-json.js
//       en un servidor donde la app no lleva exceljs
//
// Cada pieza se identifica por el nombre del archivo y su Nº, así que volver a
// importar el mismo archivo no crea duplicados.
//
// También entran las filas "libres" que el equipo añade a mano sin seguir las
// columnas (sin Nº, o con el texto en "Evento" en vez de un código): la fecha,
// la hora y la pieza se leen de su columna, el texto de "Evento" pasa a ser la
// descripción y el resto de celdas se reparten por su contenido (estado,
// responsable, plantillas de Envato, enlaces y encargos → recursos).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { DEFAULT_OWNERS } from '../shared/catalog.js';
import { importCards } from './import-cards.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--prueba');
const overwrite = args.includes('--actualizar');
const jsonOut = args.find((a) => a.startsWith('--json='))?.slice('--json='.length);

if (!file || !fs.existsSync(file)) {
  console.error('Uso: npm run importar -- "ruta\\al\\calendario.xlsx" [--prueba] [--actualizar] [--json=tarjetas.json]');
  process.exit(1);
}

// ---------- Lectura de celdas ----------

function plain(value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (value.richText) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return value.result; // fórmula: valor calculado guardado en el archivo
    if (value.text) return plain(value.text); // enlace: su texto puede ser a su vez texto enriquecido
    if (value.error) return null;
  }
  return value;
}

/** URL de una celda con enlace, sin los parámetros de seguimiento. */
function link(value) {
  const url = value && typeof value === 'object' ? value.hyperlink : null;
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url.split('?')[0] : null;
}

const text = (v) => (v === null || v === undefined ? '' : String(plain(v)).trim());
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const pad = (n) => String(n).padStart(2, '0');

// Excel guarda fechas y horas sin zona horaria; ExcelJS las devuelve en UTC.
function toDateKey(v) {
  const d = plain(v);
  return d instanceof Date ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : null;
}

function toTime(v) {
  const d = plain(v);
  if (d instanceof Date) return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (typeof d === 'number' && d >= 0 && d < 1) {
    const minutes = Math.round(d * 24 * 60);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }
  // Texto escrito a mano: "16:00", "16;00" o "15:00 Y 21:00" (se toma la primera).
  const m = String(d || '').trim().match(/^(\d{1,2})[:;.,](\d{2})/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${pad(m[1])}:${m[2]}` : null;
}

function formatDateEs(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

// ---------- Traducción al modelo de la app ----------

const NETWORK_TOKENS = {
  'ig story': ['instagram', 'story'],
  'ig stories': ['instagram', 'story'],
  story: ['instagram', 'story'],
  stories: ['instagram', 'story'],
  'ig feed': ['instagram', 'post'],
  'ig post': ['instagram', 'post'],
  'ig carrusel': ['instagram', 'carrusel'],
  carrusel: ['instagram', 'carrusel'],
  reel: ['instagram', 'reel'],
  'ig reel': ['instagram', 'reel'],
  'ig directo': ['instagram', 'directo'],
  tiktok: ['tiktok', 'video'],
  'tiktok directo': ['tiktok', 'directo'],
  x: ['x', 'post'],
  'x hilo': ['x', 'hilo'],
  twitter: ['x', 'post'],
  youtube: ['youtube', 'video'],
  'youtube short': ['youtube', 'short'],
  'youtube shorts': ['youtube', 'short'],
  'youtube directo': ['youtube', 'directo'],
};

function parseNetworks(value, unknown) {
  const platforms = [];
  for (const token of text(value).split(/[·,;/]| \+ /)) {
    const t = norm(token);
    if (!t) continue;
    const hit = NETWORK_TOKENS[t];
    if (hit) platforms.push({ platform: hit[0], format: hit[1] });
    else unknown.add(token.trim());
  }
  return platforms;
}

function parseStatus(value) {
  const s = norm(value);
  if (s.includes('no listo')) return 'no_listo';
  if (s.includes('revision')) return 'revision';
  if (s.includes('publicad')) return 'publicado';
  if (s.includes('listo')) return 'listo';
  return 'no_listo';
}

const isDone = (v) => {
  const s = text(v);
  return s === '☑' || s === '✅' || s === '✔' || /^(si|sí|x|true|hecho)$/i.test(s) || plain(v) === true;
};

// Cabeceras reconocidas (sin tildes ni mayúsculas) → campo.
const HEADERS = {
  n: 'n',
  realizado: 'done',
  fecha: 'date',
  hora: 'time',
  pieza: 'title',
  evento: 'event',
  season: 'season',
  t: 't',
  'entrega a revision': 'review',
  redes: 'networks',
  'contenido brief': 'brief',
  cta: 'cta',
  'formatos a exportar': 'exports',
  'plantilla master': 'template',
  'ayuda envato principal': 'envato',
  'ayuda envato alternativa': 'envatoAlt',
  responsable: 'owner',
  estado: 'status',
};

function findCalendarSheet(workbook) {
  for (const ws of workbook.worksheets) {
    for (let r = 1; r <= Math.min(15, ws.rowCount); r += 1) {
      const cols = {};
      ws.getRow(r).eachCell((cell, col) => {
        const field = HEADERS[norm(plain(cell.value))];
        if (field && !(field in cols)) cols[field] = col;
      });
      if (cols.n && cols.title && cols.date) return { ws, headerRow: r, cols };
    }
  }
  return null;
}

const EVENT_CODE = /^[A-Z]{2,}\d*$/;

function readEvents(workbook) {
  const names = new Map();
  const ws = workbook.worksheets.find((w) => norm(w.name) === 'eventos');
  if (!ws) return names;
  ws.eachRow((row) => {
    const code = text(row.getCell(1).value);
    const name = text(row.getCell(2).value);
    if (EVENT_CODE.test(code) && name) names.set(code, name);
  });
  return names;
}

function buildCard(row, cols, events, fileBase, unknown) {
  const get = (field) => (cols[field] ? row.getCell(cols[field]).value : null);
  const n = plain(get('n'));
  const date = toDateKey(get('date'));
  const done = isDone(get('done'));

  const brief = text(get('brief'));
  const cta = text(get('cta'));
  const description = [brief, cta && `CTA: ${cta}`].filter(Boolean).join('\n\n');

  const eventCode = text(get('event'));
  const eventName = events.get(eventCode);
  const t = plain(get('t'));
  const tLabel = typeof t === 'number' ? `T${t > 0 ? '+' : ''}${t === 0 ? '0' : t}` : '';
  const season = text(get('season'));
  const eventLine = [
    eventCode && `Evento: ${eventName ? `${eventName} (${eventCode})` : eventCode}`,
    season && `Season: ${season}`,
    tLabel,
  ]
    .filter(Boolean)
    .join(' · ');
  const review = toDateKey(get('review'));
  const notes = [
    eventLine,
    review && `Entrega a revisión: ${formatDateEs(review)}`,
    `Nº ${n} del calendario (importado de ${fileBase})`,
  ]
    .filter(Boolean)
    .join('\n');

  const resources = [];
  const template = text(get('template'));
  if (template) resources.push(`Plantilla master: ${template}`);
  const envato = text(get('envato'));
  const envatoAlt = text(get('envatoAlt'));
  if (envato) resources.push(`Envato: ${envato}${envatoAlt ? ` (alternativa: ${envatoAlt})` : ''}`);
  for (const fmt of text(get('exports')).split('·')) {
    if (fmt.trim()) resources.push(`Exportar ${fmt.trim()}`);
  }

  return {
    key: String(n),
    label: `Nº ${n}`,
    body: {
      title: text(get('title')) || `Pieza ${n}`,
      status: parseStatus(get('status')),
      owner: text(get('owner')),
      date,
      time: date ? toTime(get('time')) : null,
      platforms: parseNetworks(get('networks'), unknown),
      description,
      copy: '',
      notes,
      resources: resources.map((r) => ({ text: r.slice(0, 300), done })),
    },
  };
}

// ---------- Filas libres (añadidas a mano sin seguir las columnas) ----------

/** Una fila sigue las columnas si tiene Nº y en "Evento" hay un código (o nada). */
function isFreeRow(row, cols) {
  if (typeof plain(row.getCell(cols.n).value) !== 'number') return true;
  const event = cols.event ? text(row.getCell(cols.event).value) : '';
  return Boolean(event) && !EVENT_CODE.test(event);
}

const STATUS_CELL = /^[🔴🟡🟢🔵]/u;
const STATUS_WORDS = new Set(['no listo', 'en revision', 'listo', 'publicado']);
const OWNERS = new Map(DEFAULT_OWNERS.map((o) => [norm(o), o]));

const flat = (s) => s.replace(/\s+/g, ' ').trim();

function shorten(s, max) {
  const f = flat(s);
  if (f.length <= max) return f;
  const cut = f.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

function buildFreeCard(row, r, cols, fileBase) {
  const cell = (col) => (col ? row.getCell(col).value : null);
  const n = plain(cell(cols.n));
  const numbered = typeof n === 'number';
  const date = toDateKey(cell(cols.date));
  const timeValue = plain(cell(cols.time));
  const parsedTime = toTime(timeValue);
  const time = date ? parsedTime : null;
  const rawTime = typeof timeValue === 'string' ? flat(timeValue) : '';
  const done = cols.done ? isDone(cell(cols.done)) : false;

  const piece = text(cell(cols.title));
  const what = cols.event ? text(cell(cols.event)) : '';
  if (!date && !piece && !what) return null;

  // "Pieza" corta es el título; si es una instrucción larga, el título sale de
  // la descripción y la instrucción se guarda entera en la descripción.
  const pieceIsTitle = piece && flat(piece).length <= 80;
  const title = pieceIsTitle ? flat(piece) : shorten(what || piece, 80);
  const parts = pieceIsTitle ? [what] : [shorten(what, 80) !== flat(what) ? what : '', piece];
  // Justo después de "Evento" el equipo pone el CTA.
  const cta = cols.event ? flat(text(cell(cols.event + 1))) : '';
  if (cta) parts.push(`CTA: ${cta}`);

  let status = 'no_listo';
  let owner = '';
  const resources = [];
  const seen = new Set([norm(piece), norm(what), norm(cta)]);
  for (let col = (cols.event || cols.title) + 2; col <= row.cellCount; col += 1) {
    const value = cell(col);
    const s = flat(text(value));
    const url = link(value);
    const key = norm(s);
    if (!url && (s.length <= 2 || seen.has(key))) continue; // restos ("d", "g") o texto repetido
    seen.add(key);
    if (STATUS_CELL.test(s) || STATUS_WORDS.has(key)) {
      status = parseStatus(s);
    } else if (OWNERS.has(key)) {
      owner = OWNERS.get(key);
    } else if (/^https?:\/\//.test(s)) {
      resources.push({ text: `Enlace: ${url || s.split('?')[0]}`, done });
    } else {
      const label = /^#\d+\s/.test(s) ? `Envato: ${s}` : s;
      resources.push({
        text: url ? `${shorten(label, Math.max(40, 296 - url.length))} (${url})` : label,
        done: done || /\bhecho\b/i.test(s),
      });
    }
  }

  // La hora se apunta tal cual si no cabe en el campo Hora ("15:00 Y 21:00",
  // "todo el dia") o si la fila no tiene fecha.
  const timeNote = rawTime && !/^\d{1,2}[:;.,]\d{2}$/.test(rawTime) ? rawTime : !date && parsedTime ? parsedTime : '';
  const notes = [
    timeNote && `Hora en el Excel: ${timeNote}`,
    date ? '' : 'Sin fecha en el Excel.',
    `${numbered ? `Nº ${n}, fila ${r}` : `Fila ${r}`} del calendario, añadida a mano (importado de ${fileBase})`,
  ];

  const hash = crypto.createHash('sha1').update([date, parsedTime || rawTime, piece, what].join('|')).digest('hex').slice(0, 10);
  return {
    key: numbered ? String(n) : `f-${hash}`,
    label: numbered ? `Nº ${n}` : `fila ${r}`,
    free: true,
    body: {
      title: title || `Fila ${r}`,
      status,
      owner,
      date,
      time,
      platforms: [],
      description: parts.filter(Boolean).join('\n\n'),
      copy: '',
      notes: notes.filter(Boolean).join('\n'),
      resources: resources.map((r) => ({ ...r, text: r.text.slice(0, 300) })),
    },
  };
}

// ---------- Importación ----------

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const found = findCalendarSheet(workbook);
if (!found) {
  console.error('No encuentro una hoja con las columnas "Nº", "Fecha" y "Pieza".');
  process.exit(1);
}
const { ws, headerRow, cols } = found;
const events = readEvents(workbook);
const fileBase = path.basename(file);
// Sin el " (3)" que añade el navegador al descargar otra versión del mismo
// archivo, para que esa versión actualice las tarjetas en vez de duplicarlas.
const refBase = `excel:${path.parse(file).name.replace(/ \(\d+\)$/, '')}`;
const unknown = new Set();

const cards = [];
const keys = new Set();
for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
  const row = ws.getRow(r);
  const card = isFreeRow(row, cols) ? buildFreeCard(row, r, cols, fileBase) : buildCard(row, cols, events, fileBase, unknown);
  if (!card) continue;
  // Dos filas libres iguales (mismo día, hora y texto) no se pisan entre sí.
  let { key } = card;
  for (let i = 2; keys.has(key); i += 1) key = `${card.key}-${i}`;
  keys.add(key);
  cards.push({ ...card, key });
}

const free = cards.filter((c) => c.free);
console.log(`\nHoja "${ws.name}": ${cards.length} piezas encontradas (${free.length} en filas libres).`);
if (unknown.size) console.log(`Aviso: redes no reconocidas (se ignoran): ${[...unknown].join(', ')}`);
if (dryRun && free.length) {
  console.log('Filas libres (sin Nº o con otras columnas):');
  for (const { label, body } of free) {
    console.log(`  ${label.padEnd(8)} ${body.date || 'sin fecha '} ${body.time || '     '}  ${body.title}`);
  }
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, `${JSON.stringify({ source: fileBase, refBase, cards }, null, 1)}\n`);
  console.log(`Tarjetas guardadas en ${jsonOut}. Impórtalas con import-json.js.`);
} else {
  await importCards({ refBase, cards }, { dryRun, overwrite });
}
