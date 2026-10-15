// Importa las tarjetas que `npm run importar -- calendario.xlsx --json=tarjetas.json`
// sacó de un Excel. Es para el servidor, donde la app va sin exceljs (solo
// dependencias de producción): se copian este archivo, import-cards.js y el
// JSON, y se ejecuta con el node de la app indicando dónde está instalada.
//
// Uso:
//   node import-json.js tarjetas.json --app=/ruta/de/la/app [--prueba] [--actualizar]
//
// La carpeta de datos se toma de DATA_DIR, como en la app.
import fs from 'node:fs';
import path from 'node:path';
import { importCards } from './import-cards.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const app = args.find((a) => a.startsWith('--app='))?.slice('--app='.length);

if (!file || !fs.existsSync(file)) {
  console.error('Uso: node import-json.js tarjetas.json [--app=/ruta/de/la/app] [--prueba] [--actualizar]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (typeof data.refBase !== 'string' || !Array.isArray(data.cards)) {
  console.error('Este JSON no viene de "npm run importar -- calendario.xlsx --json=tarjetas.json".');
  process.exit(1);
}

console.log(`\n${data.cards.length} piezas de ${data.source}.`);
await importCards(data, {
  app: app && path.resolve(app),
  dryRun: args.includes('--prueba'),
  overwrite: args.includes('--actualizar'),
});
