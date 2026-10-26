# CI/CD de Manager PRE

Manager PRE se publica solo, igual que la web de ConnectToPlay PRE: cada push a `pre` comprueba, empaqueta y publica en la VPS. PROD dispone de un workflow manual separado, con validación sin publicación por defecto; ver [CI_CD_PROD.md](CI_CD_PROD.md).

| Rama | Destino | Inicio |
| --- | --- | --- |
| `pre` | `https://pre.manager.playctp.com` (`ctp-manager-pre.service`) | Automático al subir a `pre`; también **Run workflow** sobre `pre`. |
| `main` | `https://manager.playctp.com` | CI comprueba y empaqueta; PROD sólo publica con el workflow manual y confirmación explícita. |

## Qué hace cada push a `pre`

`.github/workflows/deploy-pre.yml`:

1. Ejecuta las mismas comprobaciones que `ci.yml` (acción compartida `.github/actions/manager-checks`): `npm ci`, `npm audit --audit-level=high`, `npm test`, tests Python y `npm run build`.
2. Instala **solo** las dependencias de producción desde el lockfile (`npm ci --omit=dev --ignore-scripts`) y las empaqueta con `scripts/package-vps.mjs --deps`. La VPS no ejecuta npm ni compila nada.
3. Envía el paquete por SSH a la cuenta `ctp-manager-deploy-pre`, que solo puede ejecutar `deploy pre <commit> <run> <intento> <sha256>`. No tiene shell, TTY, reenvíos ni sudo.
4. El broker root (`ctp-manager-release-pre.socket`) comprueba que la conexión viene de esa cuenta, el SHA-256, la rama `refs/heads/pre`, el commit, que el árbol no estaba modificado y el hash de **cada archivo** del manifiesto. Rechaza enlaces, archivos especiales, rutas ocultas o fuera de `server`, `shared`, `dist`, `node_modules` y los dos `package*.json`.
5. Instala la release inmutable en `/srv/ctp-manager/pre/releases/<commit>-<run>-<intento>` (root, solo lectura para el servicio).
6. Detiene Manager PRE, copia el SQLite (con su WAL) a `/var/backups/ctp-manager-release/pre/<release>/myredesmanager.db`, comprueba su integridad, cambia `current` de forma atómica y arranca el servicio.
7. Verifica que el proceso nuevo corre **en esa release**, que `/api/auth/status` responde `provider:"ctp"` con origen `https://pre.playctp.com`, que la página servida es exactamente el `index.html` compilado y que `https://pre.manager.playctp.com` responde.
8. Si algo falla, vuelve a la release anterior, la reinicia y la verifica. El resumen del workflow indica `rolledBack: true/false`.

La base de datos **no se restaura** automáticamente: Manager aplica su esquema al arrancar con `CREATE TABLE IF NOT EXISTS`, así que la versión anterior sigue funcionando. La copia queda disponible para una recuperación manual.

Se conservan las 5 releases más recientes creadas por CI y las 10 últimas copias de despliegue; las releases instaladas a mano, la actual y la anterior nunca se borran. El timer diario `ctp-manager-pre-backup` y su directorio no se tocan.

No toca CTP (Supabase, migraciones, puente), Caddy, `/etc/ctp-manager/pre.env` ni producción. Si un cambio de Manager depende de una migración nueva de CTP, publicar antes ConnectToPlay `pre`.

## Configuración en GitHub

Repositorio `icaceresg/ctp_manager` → *Settings → Secrets and variables → Actions*:

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `MANAGER_VPS_PRE_SSH_KEY` | Secret | Clave privada ed25519 dedicada a este despliegue. |
| `MANAGER_VPS_KNOWN_HOSTS` | Variable | Línea `knownHosts` que imprime el instalador (la misma clave de host que `CTP_VPS_KNOWN_HOSTS` de ConnectToPlay). |
| `MANAGER_VPS_HOST` | Variable | Host SSH verificado de la VPS. |

El job usa el environment **Preview**. La clave es un Secret; el host y su pin son Variables. Antes de publicar ejecuta `check pre` para verificar acceso y runtime sin cambios. Sin el secret o la variable, el workflow falla al principio con un mensaje claro y no publica nada.

## Instalación única en la VPS

Se hace una vez, como root. Solo crea la cuenta de despliegue, su política SSH y el broker; **no publica ninguna release**.

1. Generar en el PC una clave exclusiva, sin frase de paso (no reutilizar `id_ed25519` ni las claves de ConnectToPlay):

   ```sh
   ssh-keygen -t ed25519 -N "" -C ctp-manager-pre-deploy -f ~/.ssh/ctp-manager-pre-deploy
   ```

2. Copiar a la VPS el instalador y la clave **pública**:

   ```sh
   scp infra/vps/cicd/manager_release.py ~/.ssh/ctp-manager-pre-deploy.pub root@31.70.157.157:/root/
   ```

3. En la VPS, primero en modo ensayo y después de verdad:

   ```sh
   python3 /root/manager_release.py install --environment pre --public-key /root/ctp-manager-pre-deploy.pub --dry-run
   python3 /root/manager_release.py install --environment pre --public-key /root/ctp-manager-pre-deploy.pub
   ```

   El ensayo comprueba que `ctp-manager-pre.service` corre en la release a la que apunta `current`, que responde en `pre.manager.playctp.com` y que `sshd -t` es válido. La instalación escribe:

   - `/usr/local/libexec/ctp-manager-release.py` y el comando forzado `/usr/local/libexec/ctp-manager-deploy-pre`.
   - `/etc/ctp-manager-deploy/keys/pre` (`restrict,command=...`) y `/etc/ssh/sshd_config.d/41-ctp-manager-deploy-pre.conf`.
   - `ctp-manager-release-pre.socket` y `ctp-manager-release-pre@.service`.
   - Estado privado `/var/lib/ctp-manager-release/pre` y copias `/var/backups/ctp-manager-release/pre` (root, `0700`).

   Valida la política SSH efectiva antes de recargar `ssh` y deshace los archivos si algo falla.

4. Guardar en GitHub el contenido de `~/.ssh/ctp-manager-pre-deploy` como `MANAGER_VPS_PRE_SSH_KEY` y la línea `knownHosts` como `MANAGER_VPS_KNOWN_HOSTS`. Después se puede borrar la clave privada del PC.

5. Lanzar **Run workflow** en *Manager PRE automatic deployment* sobre `pre`, o subir a `pre`.

Para actualizar el broker, repetir los pasos 2 y 3 con la versión nueva del archivo.

## Operación

- Recibo del último despliegue: `/var/lib/ctp-manager-release/pre/last-success.json`. Registro del broker: `journalctl -u 'ctp-manager-release-pre@*'`.
- `deployment_locked`: ya hay otro despliegue en curso.
- `rolledBack: false`: el broker no pudo verificar la release anterior. Queda `pending.json` y el siguiente despliegue intenta recuperar primero; revisar `journalctl -u ctp-manager-pre.service` antes de repetir.
- Volver atrás a mano: `ln -sfn /srv/ctp-manager/pre/releases/<anterior> /srv/ctp-manager/pre/current.new && mv -T /srv/ctp-manager/pre/current.new /srv/ctp-manager/pre/current && systemctl restart ctp-manager-pre.service`.
- Restaurar el SQLite es una operación aparte: detener solo Manager PRE, conservar la base actual, copiar la de `/var/backups/ctp-manager-release/pre/<release>/` con propietario `ctp-manager-pre:ctp-manager-pre` y modo `0600`, y arrancar.

## Comprobaciones locales

```text
npm test
python3 -B test/manager-release.test.py -v
```

Los tests de despliegue simulan systemd y HTTP en directorios temporales; necesitan Linux o macOS (symlinks y `flock`). En CI se ejecutan siempre.
