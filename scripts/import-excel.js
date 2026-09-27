// Importa las piezas de la hoja de calendario de un Excel (formato del
// "CTP · Calendario de contenido": Nº, Fecha, Hora, Pieza, Redes, Estado…)
// como tarjetas de la app.
//
// Uso:
//   npm run importar -- "C:\ruta\calendario.xlsx"               importa las piezas nuevas
//   npm run importar -- "C:\ruta\calendario.xlsx" --prueba      muestra qué haría, sin guardar
//   npm run importar -- "C:\ruta\calendario.xlsx" --actualizar  además sobrescribe las ya importadas
//
// Cada pieza se identifica por el nombre del archivo y su Nº, así que volver a
// importar el mismo archivo no crea duplicados.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { DATA_DIR } from '../server/config.js';
import { db } from '../server/db.js';
import { createContent, findBySourceRef, getContent, updateContent } from '../server/contents.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--prueba');
const overwrite = args.includes('--actualizar');

if (!file || !fs.existsSync(file)) {
  console.error('Uso: npm run importar -- "ruta\\al\\calendario.xlsx" [--prueba] [--actualizar]');
  process.exit(1);
}

// ---------- Lectura de celdas ----------

function plain(value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (value.richText) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return value.result; // fórmula: valor calculado guardado en el archivo
    if (value.text) return value.text;
    if (value.error) return null;
  }
  return value;
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
  const m = String(d || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : null;
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

function readEvents(workbook) {
  const names = new Map();
  const ws = workbook.worksheets.find((w) => norm(w.name) === 'eventos');
  if (!ws) return names;
  ws.eachRow((row) => {
    const code = text(row.getCell(1).value);
    const name = text(row.getCell(2).value);
    if (/^[A-Z]{2,}\d*$/.test(code) && name) names.set(code, name);
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
    n,
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
const refBase = `excel:${path.parse(file).name}`;
const unknown = new Set();

const cards = [];
for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
  const row = ws.getRow(r);
  if (typeof plain(row.getCell(cols.n).value) !== 'number') continue;
  cards.push(buildCard(row, cols, events, fileBase, unknown));
}

console.log(`\nHoja "${ws.name}": ${cards.length} piezas encontradas.`);
if (unknown.size) console.log(`Aviso: redes no reconocidas (se ignoran): ${[...unknown].join(', ')}`);

const plan = cards.map((c) => ({ ...c, existingId: findBySourceRef(`${refBase}#${c.n}`) }));
const toWrite = plan.filter((c) => !c.existingId || overwrite);
const skipped = plan.length - toWrite.length;

if (!dryRun && toWrite.length) {
  // Copia de seguridad consistente de la base de datos antes de tocar nada.
  const backupDir = path.join(DATA_DIR, 'copias');
  fs.mkdirSync(backupDir, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backup = path.join(backupDir, `antes-de-importar-${stamp}.db`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`Copia de seguridad: ${backup}`);
}

let created = 0;
let updated = 0;
const failed = [];

for (const { n, body, existingId } of toWrite) {
  const ref = `${refBase}#${n}`;
  try {
    if (dryRun) {
      if (existingId) updated += 1;
      else created += 1;
      continue;
    }
    if (existingId) {
      // Conserva como "listos" los recursos que ya se marcaron en la app.
      const doneBefore = new Set(getContent(existingId).resources.filter((r) => r.done).map((r) => r.text));
      body.resources = body.resources.map((r) => ({ ...r, done: r.done || doneBefore.has(r.text) }));
      updateContent(existingId, body);
      updated += 1;
    } else {
      createContent(body, { sourceRef: ref });
      created += 1;
    }
  } catch (err) {
    failed.push(`Nº ${n}: ${err.message}`);
  }
}

const verb = dryRun ? 'Se crearían' : 'Creadas';
console.log(`${verb}: ${created} · ${dryRun ? 'Se actualizarían' : 'Actualizadas'}: ${updated} · Ya importadas (sin tocar): ${skipped}`);
if (failed.length) {
  console.log(`Con error (${failed.length}):`);
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
if (dryRun) console.log('Modo prueba: no se ha guardado nada.');
