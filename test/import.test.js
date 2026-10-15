// Prueba del importador de Excel con un calendario de ejemplo (mismo formato
// que el "CTP · Calendario de contenido").
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrm-import-'));
const xlsx = path.join(dir, 'Calendario_Prueba.xlsx');
const dataDir = path.join(dir, 'data');

const utc = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const excelTime = (h, min) => utc(1899, 12, 30, h, min);

function runImport(...flags) {
  return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/import-excel.js', xlsx, ...flags], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  });
}

function query(sql, ...params) {
  const db = new DatabaseSync(path.join(dataDir, 'myredesmanager.db'), { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

before(async () => {
  const wb = new ExcelJS.Workbook();
  const events = wb.addWorksheet('Eventos');
  events.getRow(5).values = ['Código', 'Evento', 'Season', 'Tipo', 'Fecha (editar)', 'Hora'];
  events.getRow(6).values = ['CUP01', 'Cup #01', 'S1', 'Cup', utc(2026, 11, 7), excelTime(17, 0)];

  const ws = wb.addWorksheet('3_Calendario');
  ws.getCell('A1').value = 'CALENDARIO DE CONTENIDO';
  ws.getRow(4).values = [
    'Nº', 'Realizado', 'Fecha', 'Hora', 'Pieza', 'Evento', 'Season', 'T', 'Entrega a revisión', 'Redes',
    'Contenido / brief', 'CTA', 'Formatos a exportar', 'Plantilla master', 'Ayuda Envato (principal)',
    'Ayuda Envato (alternativa)', 'Responsable', 'Estado',
  ];
  ws.getRow(5).values = [
    1, '☐', { formula: 'Eventos!E6-3', result: utc(2026, 11, 4) }, excelTime(19, 30), 'ANUNCIO · CUP #01', 'CUP01', 'S1', -3,
    utc(2026, 11, 2), 'IG Feed · Story · X · YouTube Short · Threads', 'Anuncio con fecha y hora.', 'Activar el aviso',
    'IG Feed 1080×1350 · Story 1080×1920', 'MASTER_ANUNCIO', '#24 Pack', '#01 Alt', 'Diseño', '🟡 EN REVISIÓN',
  ];
  ws.getRow(6).values = [
    2, '☑', utc(2026, 11, 7), excelTime(17, 0), 'MATCHDAY · CUP #01', 'CUP01', 'S1', 0,
    utc(2026, 11, 5), 'Reel · TikTok', 'Clip del día.', '', 'Reel/TikTok 1080×1920', '', '', '', 'Edición', '🔵 PUBLICADO',
  ];
  await wb.xlsx.writeFile(xlsx);
});

after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

test('el modo prueba no guarda nada', () => {
  const out = runImport('--prueba');
  assert.match(out, /2 piezas encontradas/);
  assert.match(out, /Se crearían: 2/);
  assert.match(out, /Threads/, 'avisa de las redes que no reconoce');
  assert.equal(query('SELECT COUNT(*) AS n FROM contents')[0].n, 0);
});

test('importa las piezas como tarjetas', () => {
  const out = runImport();
  assert.match(out, /Creadas: 2/);
  assert.ok(fs.readdirSync(path.join(dataDir, 'copias')).length === 1, 'hace una copia de seguridad antes');

  const [anuncio, matchday] = query('SELECT * FROM contents ORDER BY date');
  assert.equal(anuncio.title, 'ANUNCIO · CUP #01');
  assert.equal(anuncio.date, '2026-11-04', 'usa el valor calculado de la fórmula');
  assert.equal(anuncio.time, '19:30');
  assert.equal(anuncio.status, 'revision');
  assert.equal(anuncio.owner, 'Diseño');
  assert.deepEqual(JSON.parse(anuncio.platforms), [
    { platform: 'instagram', format: 'post' },
    { platform: 'instagram', format: 'story' },
    { platform: 'x', format: 'post' },
    { platform: 'youtube', format: 'short' },
  ]);
  assert.equal(anuncio.description, 'Anuncio con fecha y hora.\n\nCTA: Activar el aviso');
  assert.match(anuncio.notes, /Evento: Cup #01 \(CUP01\) · Season: S1 · T-3/);
  assert.match(anuncio.notes, /Entrega a revisión: 02\/11\/2026/);

  const resources = query('SELECT text, done FROM resources WHERE content_id = ? ORDER BY position', anuncio.id);
  assert.deepEqual(
    resources.map((r) => r.text),
    [
      'Plantilla master: MASTER_ANUNCIO',
      'Envato: #24 Pack (alternativa: #01 Alt)',
      'Exportar IG Feed 1080×1350',
      'Exportar Story 1080×1920',
    ],
  );
  assert.ok(resources.every((r) => r.done === 0));

  assert.equal(matchday.status, 'publicado');
  assert.equal(matchday.time, '17:00');
  const done = query('SELECT done FROM resources WHERE content_id = ?', matchday.id);
  assert.ok(done.length === 1 && done[0].done === 1, 'una pieza "Realizado ☑" llega con sus recursos listos');
});

test('volver a importar no duplica y --actualizar respeta lo marcado en la app', () => {
  assert.match(runImport(), /Creadas: 0 · Actualizadas: 0 · Ya importadas \(sin tocar\): 2/);
  assert.equal(query('SELECT COUNT(*) AS n FROM contents')[0].n, 2);

  // El equipo marca un recurso en la app y cambia un título.
  const db = new DatabaseSync(path.join(dataDir, 'myredesmanager.db'));
  const [{ id }] = db.prepare("SELECT id FROM contents WHERE title = 'ANUNCIO · CUP #01'").all();
  db.prepare("UPDATE resources SET done = 1 WHERE content_id = ? AND text LIKE 'Plantilla%'").run(id);
  db.prepare('UPDATE contents SET title = ? WHERE id = ?').run('Cambiado en la app', id);
  db.close();

  assert.match(runImport('--actualizar'), /Actualizadas: 2/);
  const [card] = query('SELECT title FROM contents WHERE id = ?', id);
  assert.equal(card.title, 'ANUNCIO · CUP #01', 'el Excel manda en los datos de la pieza');
  const plantilla = query("SELECT done FROM resources WHERE content_id = ? AND text LIKE 'Plantilla%'", id);
  assert.equal(plantilla[0].done, 1, 'pero no desmarca lo que ya estaba listo');
});

test('importa las filas libres añadidas a mano sin seguir las columnas', async () => {
  // Otra descarga del mismo archivo: el " (2)" no cuenta para reconocer las piezas.
  const libre = path.join(dir, 'Calendario_Prueba (2).xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('3_Calendario');
  ws.getRow(4).values = [
    'Nº', 'Realizado', 'Fecha', 'Hora', 'Pieza', 'Evento', 'Season', 'T', 'Entrega a revisión', 'Redes',
    'Contenido / brief', 'CTA', 'Formatos a exportar', 'Plantilla master', 'Ayuda Envato (principal)',
    'Ayuda Envato (alternativa)', 'Responsable', 'Estado',
  ];
  const set = (r, cells) => Object.entries(cells).forEach(([col, value]) => (ws.getRow(r).getCell(Number(col)).value = value));
  set(5, { 1: 1, 3: utc(2026, 11, 4), 5: 'ANUNCIO · CUP #01', 6: 'CUP01' }); // ya importada
  // Sin Nº, con el texto en "Evento", el CTA al lado y el resto desplazado.
  set(6, {
    3: utc(2026, 10, 14), 4: '15:00 Y 21:00', 6: 'Presentación del equipo', 7: 'Seguir CTP', 9: 'CARTEL MIGUEL',
    10: { text: { richText: [{ text: 'post de instagram' }] }, hyperlink: 'https://elements.envato.com/x-PMC?_gl=abc' },
    11: 'd', 12: 'Diseño', 13: '🟡 EN REVISIÓN',
  });
  // Con Nº pero sin código de evento.
  set(7, {
    1: 7, 2: '☐', 3: utc(2026, 10, 18), 4: excelTime(16, 0), 6: 'Cuenta atrás',
    9: { text: 'cronometro HECHO', hyperlink: 'https://drive.google.com/file/d/abc/view?usp=drive_link' },
    10: '#13 Story Template', 11: 'RRSS', 12: '🔴 NO LISTO',
  });
  set(8, { 4: excelTime(20, 0), 6: 'Resubir cartel del modo ranked' }); // sin fecha
  await wb.xlsx.writeFile(libre);

  const run = () =>
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/import-excel.js', libre], {
      cwd: root,
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: 'utf8',
    });
  const out = run();
  assert.match(out, /4 piezas encontradas \(3 en filas libres\)/);
  assert.match(out, /Creadas: 3 · Actualizadas: 0 · Ya importadas \(sin tocar\): 1/);

  const [equipo] = query("SELECT * FROM contents WHERE title = 'Presentación del equipo'");
  assert.equal(equipo.date, '2026-10-14');
  assert.equal(equipo.time, '15:00');
  assert.equal(equipo.status, 'revision');
  assert.equal(equipo.owner, 'Diseño');
  assert.equal(equipo.description, 'CTA: Seguir CTP');
  assert.match(equipo.notes, /Hora en el Excel: 15:00 Y 21:00/);
  assert.match(equipo.notes, /Fila 6 del calendario, añadida a mano/);
  assert.deepEqual(
    query('SELECT text FROM resources WHERE content_id = ? ORDER BY position', equipo.id).map((r) => r.text),
    ['CARTEL MIGUEL', 'post de instagram (https://elements.envato.com/x-PMC)'],
  );

  const [cuenta] = query("SELECT * FROM contents WHERE source_ref = 'excel:Calendario_Prueba#7'");
  assert.equal(cuenta.title, 'Cuenta atrás');
  assert.equal(cuenta.time, '16:00');
  assert.equal(cuenta.owner, 'RRSS');
  const recursos = query('SELECT text, done FROM resources WHERE content_id = ? ORDER BY position', cuenta.id);
  assert.deepEqual(recursos.map((r) => ({ ...r })), [
    { text: 'cronometro HECHO (https://drive.google.com/file/d/abc/view)', done: 1 },
    { text: 'Envato: #13 Story Template', done: 0 },
  ]);

  const [idea] = query("SELECT * FROM contents WHERE title = 'Resubir cartel del modo ranked'");
  assert.equal(idea.date, null, 'sin fecha queda como idea');
  assert.match(idea.notes, /Hora en el Excel: 20:00/);

  assert.match(run(), /Creadas: 0 · Actualizadas: 0 · Ya importadas \(sin tocar\): 4/);
});

test('--json guarda las tarjetas y import-json.js las importa en otra base de datos', () => {
  const json = path.join(dir, 'tarjetas.json');
  const otherData = path.join(dir, 'servidor');
  const out = runImport(`--json=${json}`);
  assert.match(out, /Tarjetas guardadas/);
  const data = JSON.parse(fs.readFileSync(json, 'utf8'));
  assert.equal(data.refBase, 'excel:Calendario_Prueba');
  assert.equal(data.cards.length, 2);

  // Como en el servidor: se ejecuta desde otra carpeta, indicando dónde está la app.
  const script = path.join(root, 'scripts', 'import-json.js');
  const importJson = (...flags) =>
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', script, json, `--app=${root}`, ...flags], {
      cwd: dir,
      env: { ...process.env, DATA_DIR: otherData },
      encoding: 'utf8',
    });
  assert.match(importJson('--prueba'), /Se crearían: 2/);
  assert.match(importJson(), /Creadas: 2/);
  assert.match(importJson(), /Ya importadas \(sin tocar\): 2/);
  const db = new DatabaseSync(path.join(otherData, 'myredesmanager.db'), { readOnly: true });
  try {
    const refs = db.prepare('SELECT source_ref FROM contents ORDER BY source_ref').all().map((r) => r.source_ref);
    assert.deepEqual(refs, ['excel:Calendario_Prueba#1', 'excel:Calendario_Prueba#2']);
  } finally {
    db.close();
  }
});
