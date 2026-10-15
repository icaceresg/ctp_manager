// Guarda en la base de datos las tarjetas leídas de un calendario en Excel:
// copia de seguridad, altas y, con --actualizar, sobrescritura de las ya
// importadas. La usan import-excel.js e import-json.js.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pad = (n) => String(n).padStart(2, '0');

/**
 * `cards`: [{ key, label, body }]; cada tarjeta se reconoce por `${refBase}#${key}`.
 * `app`: carpeta de la app cuya base de datos se usa (por defecto, este proyecto).
 */
export async function importCards({ refBase, cards }, { app, dryRun = false, overwrite = false } = {}) {
  const root = app || path.resolve(import.meta.dirname, '..');
  const load = (file) => import(pathToFileURL(path.join(root, file)).href);
  const { DATA_DIR } = await load('server/config.js');
  const { db } = await load('server/db.js');
  const { createContent, findBySourceRef, getContent, updateContent } = await load('server/contents.js');

  const plan = cards.map((c) => ({ ...c, existingId: findBySourceRef(`${refBase}#${c.key}`) }));
  const toWrite = plan.filter((c) => !c.existingId || overwrite);
  const skipped = plan.length - toWrite.length;

  if (!dryRun && toWrite.length) {
    // Copia de seguridad consistente de la base de datos antes de tocar nada.
    const backupDir = path.join(DATA_DIR, 'copias');
    fs.mkdirSync(backupDir, { recursive: true });
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    let backup = path.join(backupDir, `antes-de-importar-${stamp}.db`);
    for (let i = 2; fs.existsSync(backup); i += 1) backup = path.join(backupDir, `antes-de-importar-${stamp}-${i}.db`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    console.log(`Copia de seguridad: ${backup}`);
  }

  let created = 0;
  let updated = 0;
  const failed = [];

  for (const { key, label, body, existingId } of toWrite) {
    const ref = `${refBase}#${key}`;
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
      failed.push(`${label}: ${err.message}`);
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
  return { created, updated, skipped, failed };
}
