// Recuperación de acceso: pone una contraseña nueva a un usuario desde la
// terminal de este ordenador (por si se olvida la del administrador).
//
// Uso:  npm run nueva-contrasena -- admin
import readline from 'node:readline';
import { db } from '../server/db.js';
import { hashPassword, validatePassword } from '../server/auth.js';

const username = process.argv[2];
if (!username) {
  console.error('Uso: npm run nueva-contrasena -- <usuario>');
  process.exit(1);
}

const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
if (!user) {
  const all = db.prepare('SELECT username FROM users ORDER BY username').all().map((u) => u.username);
  console.error(`No existe el usuario "${username}". Usuarios: ${all.join(', ') || '(ninguno)'}`);
  process.exit(1);
}

/** Pide un texto sin mostrarlo en pantalla. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await askHidden(`Nueva contraseña para "${user.username}": `);
const repeat = await askHidden('Repítela: ');
if (password !== repeat) {
  console.error('Las contraseñas no coinciden. No se ha cambiado nada.');
  process.exit(1);
}
try {
  validatePassword(password);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?').run(hashPassword(password), user.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
console.log(`Listo: "${user.username}" ya puede entrar con la contraseña nueva.`);
