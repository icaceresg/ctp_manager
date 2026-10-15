# CTP Manager en la VPS: PRE

Este paquete prepara un servicio Node independiente conectado a la API de
`https://pre.playctp.com`. El dominio público del Manager es
`https://manager.playctp.com`. No crea otra base competitiva, publica la web de
jugadores ni controla OBS: torneos, resultados y permisos oficiales siguen en
CTP; el SQLite del Manager contiene espejos del staff, organización,
proyecciones y comandos pendientes.

La configuración y esta unidad no prueban que exista un despliegue activo.
El acceso con la misma cuenta CTP, el puente firmado, DNS, TLS y los flujos reales
deben comprobarse antes de abrirlo al equipo. Véase también
[DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## Runtime, release y estado

| Ruta | Propiedad y contenido |
| --- | --- |
| `/opt/ctp-manager/runtime` | Runtime oficial Node **24.15.0**, propiedad de root y sin escritura del servicio. |
| `/srv/ctp-manager/pre/releases/<revision>` | Release inmutable con `server`, `shared`, `dist`, `package.json`, lockfile y dependencias de producción. |
| `/srv/ctp-manager/pre/current` | Enlace a la release aceptada; lo cambia exclusivamente el despliegue. |
| `/var/lib/ctp-manager-pre` | Estado persistente, usuario/grupo `ctp-manager-pre`, modo `0700`. |
| `/etc/ctp-manager/pre.env` | Variables privadas, root:root `0600`; systemd las carga antes de bajar privilegios. |

Mantener el runtime fuera de `/opt/ctp`: ese directorio tiene modo `0700` y
protege los secretos y respaldos de Supabase. No cambiar sus permisos para
permitir acceso a Manager. `/opt/ctp-manager` y sus directorios de runtime
deben permitir lectura/travesía, conservando propiedad root y escritura solo
de root. El servicio no pertenece a `docker`, `sudo` ni otros grupos del host.

Obtener el archivo oficial de Node correspondiente a la arquitectura de la
VPS y verificar su SHA-256 contra `SHASUMS256.txt` de esa misma versión antes
de extraerlo. Guardar la procedencia, versión y digest verificados en el
recibo privado de instalación. El tar oficial incluye `npm`; no instalar
otro Node global ni usar un runtime de desarrollo como supervisor.

La compilación y los tests se ejecutan en el ordenador de desarrollo o en
GitHub Actions. **No ejecutar Vite, `npm run build`, `npm start` ni instalar
dependencias de desarrollo en esta VPS.** `npm start` compila antes de servir.

Si el artefacto no incluye dependencias de producción, instalarlas únicamente
dentro de una release nueva y todavía inactiva, usando su lockfile revisado:

```sh
cd /srv/ctp-manager/pre/releases/<revision>
PATH=/opt/ctp-manager/runtime/bin:/usr/bin:/bin \
  /opt/ctp-manager/runtime/bin/node \
  /opt/ctp-manager/runtime/lib/node_modules/npm/bin/npm-cli.js \
  ci --omit=dev --ignore-scripts --no-audit --no-fund
```

No usar el usuario del servicio para editar releases. Conservarlas legibles
pero sin escritura para él y excluir `.env`, bases SQLite, `data`, logs,
credenciales y material de desarrollo del artefacto. No copiar la base local
del desarrollador. Crear el estado de la VPS de forma independiente.

## Variables privadas

El archivo de entorno debe existir; la unidad falla si falta. Los valores del
archivo prevalecen sobre los valores predeterminados de la unidad, por lo que
hay que revisar especialmente puerto, rutas y origen antes de reiniciar:

```dotenv
PORT=3210
DATA_DIR=/var/lib/ctp-manager-pre
PUBLIC_ORIGIN=https://manager.playctp.com
CTP_AUTH_MODE=ctp
CTP_AUTH_URL=https://pre.playctp.com
CTP_AUTH_ANON_KEY=<JWT público anon vigente de PRE>
CTP_AUTH_TOKEN_KEY=<32 bytes aleatorios en base64url canónico>
CTP_WEB_ORIGIN=https://pre.playctp.com
CTP_OPERATIONS_URL=https://pre.playctp.com/functions/v1/manager-operations
CTP_OPERATIONS_TOKEN=<secreto dedicado del puente>
CTP_SIGNING_SECRET=<otro secreto independiente del puente>
CTP_ENABLE_WRITES=false
CTP_SYNC_SECONDS=0
OBS_ENABLE_CONTROL=false
OPEN_BROWSER=0
```

`CTP_OPERATIONS_TOKEN` debe coincidir con `MANAGER_INTEGRATION_TOKEN` del
backend PRE; la firma debe coincidir con `MANAGER_SIGNING_SECRET`. No son la
clave `service_role`, no se publican en el frontend y no se guardan en Git.
`CTP_AUTH_URL`, `CTP_WEB_ORIGIN` y el origen de `CTP_OPERATIONS_URL` deben
coincidir exactamente: esta instalación autentica y opera contra PRE. La clave
anon es pública y debe pertenecer a esa instancia; no usar `service_role`.
La clave de cifrado requiere 32 bytes aleatorios en base64url, es independiente
de los dos secretos del puente y permanece exclusivamente en el servidor.
No activar una configuración incompleta ni cambiar a autenticación local
para resolver una caída de CTP.

Mantener `CTP_ENABLE_WRITES=false` hasta validar el puente, los operadores y
sus permisos en CTP. El token y la firma no conceden por sí solos permisos a
todos los usuarios del Manager. No activar cron, corte competitivo ni el
agente OBS como consecuencia de instalar este servicio.

## Acceso CTP y puesta en marcha

1. Crear el usuario de sistema `ctp-manager-pre`, sin contraseña interactiva,
   sin grupos privilegiados y con su estado privado vacío. Preparar runtime,
   release y enlace `current`, todavía sin publicar el vhost HTTPS.
2. Preparar en CTP PRE la RPC de identidad propia de la migración 159 y el
   puente firmado. Configurar `CTP_AUTH_MODE=ctp`: **no crear administrador,
   usuario ni contraseña independientes en Manager** y no importar cuentas o
   sesiones del desarrollo local.
3. Cargar el archivo privado final, comprobar sus tres orígenes PRE y el
   origen público exacto. El staff entra con el mismo correo y contraseña de
   CTP; solo se admiten los roles CTP `admin` y `referee`. El primer acceso
   válido crea un espejo sin contraseña y la identidad de operador `ctp:<UUID>`.
   Las altas locales quedan bloqueadas incluso con SQLite vacío.
4. Instalar y verificar la unidad; arrancar primero de forma controlada:

```sh
install -o root -g root -m 0644 infra/vps/ctp-manager-pre.service \
  /etc/systemd/system/ctp-manager-pre.service
systemd-analyze verify /etc/systemd/system/ctp-manager-pre.service
systemctl daemon-reload
systemctl start ctp-manager-pre.service
systemctl status ctp-manager-pre.service --no-pager
```

La unidad ejecuta directamente el Node verificado. Solo puede escribir en su
estado y en su `/tmp` privado; runtime, release y sistema son de solo lectura.
No tiene capacidades, privilegios nuevos ni acceso al socket Docker. El
límite es **384 MiB**: comprobar memoria y reinicios con la carga prevista;
el límite no constituye una prueba de capacidad. No añadir
`MemoryDenyWriteExecute=true`: V8 necesita memoria ejecutable para su JIT.

## DNS y proxy Caddy

Preparar un registro A de `manager.playctp.com` hacia la VPS. No habilitar el
bloque público hasta que el DNS resuelva correctamente, el acceso central
esté configurado y el servicio pase las comprobaciones locales. No cambiar el bloque
de `playctp.com`, que sigue siendo la landing de espera.

Bloque de Caddy propuesto, para incorporar al archivo existente solo después
de cumplir esas condiciones:

```caddyfile
manager.playctp.com {
    encode zstd gzip
    header {
        X-Robots-Tag "noindex, nofollow, noarchive"
        Cache-Control "no-store"
        -Server
    }
    reverse_proxy 127.0.0.1:3210 {
        header_up Host manager.playctp.com
    }
}
```

Caddy termina TLS con un certificado público y reenvía el host exacto que
valida la aplicación. No publicar `3210` en el cortafuegos, no habilitar
`trust proxy` indiscriminadamente y no reescribir `Origin`. La aplicación
escucha únicamente en `127.0.0.1` y `::1`; las restricciones de familias de
direcciones de la unidad permiten además DNS y HTTPS saliente hacia PRE.
No añadir una política que bloquee toda salida salvo loopback: rompería el
puente a CTP. No registrar cookies, cuerpos de autenticación ni secretos en
logs del proxy.

Validar Caddy antes de recargarlo. Un vhost guardado en documentación no
demuestra que DNS, HTTPS ni la renovación del certificado estén aceptados.

## Aceptación y reversión

Comprobar la escucha local y las respuestas sin iniciar una sesión:

```sh
curl --fail --silent --show-error \
  -H 'Host: manager.playctp.com' \
  http://127.0.0.1:3210/api/auth/status
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  http://127.0.0.1:3210/api/auth/status
```

La primera debe indicar `provider:"ctp"`, `setup:true`, `authenticated:false`
y `web_origin:"https://pre.playctp.com"`; la segunda debe
rechazarse con `403`. Después de habilitar DNS/TLS, probar desde el dominio
real: acceso de administrador y staff, cookies seguras, rechazo de Host y
Origin ajenos, usuario sin permisos, cierre de sesión y desactivación de una
cuenta. Comprobar que un jugador no entra, que no se crean cuentas locales y
que una degradación o revocación CTP se aplica en la siguiente petición. Los
tokens permanecen cifrados en SQLite y solo una cookie opaca llega al navegador;
la clave se conserva en el respaldo privado. Un error de autenticación o una
caída de CTP no permite recurrir a cuentas locales. Los administradores pueden
asignar secciones internas, pero la autoridad CTP y la contraseña se gestionan
en la web central. Sincronizar con PRE y cortar la conexión para verificar que conserva
la última proyección válida. Las escrituras requieren una aceptación aparte.

Revisar `journalctl -u ctp-manager-pre.service`, memoria, reinicios y permisos
del estado sin mostrar secretos. Solo tras pasar la aceptación:

```sh
systemctl enable ctp-manager-pre.service
```

Una publicación debe conservar la versión anterior, cambiar `current` de
forma atómica, reiniciar exclusivamente `ctp-manager-pre` y verificar API,
login y conexión con PRE. Para volver atrás, restaurar el enlace anterior y
reiniciar el mismo servicio. SQLite puede migrar al arrancar: antes de cada
release guardar un backup coherente mediante su API o con el servicio
detenido; no copiar únicamente el archivo principal mientras usa WAL.
Revisar compatibilidad de esquema antes de arrancar una versión anterior.
Guardar el respaldo fuera de las releases y probar su restauración aislada.

Esta reversión no modifica Supabase, Caddy, la web de jugadores ni la landing.

## Copia diaria privada de Manager PRE

El script `scripts/backup-vps.mjs` usa la API de backup online de SQLite de
Node 24.15.0. Abre el origen de solo lectura e incluye las transacciones ya
confirmadas en WAL sin detener Manager. Comprueba `PRAGMA integrity_check` y
normaliza únicamente la copia a `journal_mode=DELETE`, para que el respaldo
no dependa de archivos WAL o SHM adicionales.

Cada generación privada bajo `/opt/ctp/backups/manager-pre` contiene:

- `myredesmanager.db`: instantánea coherente del estado de Manager.
- `configs.private.tar.gz`: `/etc/ctp-manager/pre.env`, la unidad del servicio
  y el manifiesto de la release activa. **Incluye secretos y la clave que
  permite descifrar las sesiones CTP.** No publicarlo ni adjuntarlo a GitHub.
- `manifest.json`: commit, fecha, tamaños y SHA-256 de los dos archivos.

El directorio y las generaciones son exclusivos de root (`0700`; archivos
`0600`). El script rechaza enlaces o rutas inesperadas, comprueba que la
configuración y la release no cambien durante la copia y publica una generación
solo cuando está completa. El registro muestra únicamente su identificador,
commit y resultado; nunca credenciales o cuerpos de sesión.

Preparación, todavía **sin instalación ni activación automática**:

```sh
install -d -o root -g root -m 0700 /opt/ctp/backups/manager-pre
install -o root -g root -m 0700 scripts/backup-vps.mjs /opt/ctp-manager/backup-vps.mjs
install -o root -g root -m 0644 infra/vps/ctp-manager-pre-backup.service /etc/systemd/system/
install -o root -g root -m 0644 infra/vps/ctp-manager-pre-backup.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/ctp-manager-pre-backup.service /etc/systemd/system/ctp-manager-pre-backup.timer
systemctl daemon-reload
systemctl start ctp-manager-pre-backup.service
```

Verificar la generación y sus hashes, y ensayar su restauración en una copia
aislada, antes de ejecutar `systemctl enable --now ctp-manager-pre-backup.timer`.
El timer programa la copia a las **04:50–04:55, hora de Madrid**, después del
backup de la base CTP PRE. `flock` evita dos copias simultáneas. El directorio
privado debe existir antes de arrancar la unidad por sus restricciones de
escritura. No se borran generaciones automáticamente: la retención es manual y
hay que vigilar el espacio. El timer tampoco crea una copia fuera de la VPS.

Para restaurar, detener únicamente Manager, preservar el estado actual y
verificar primero los hashes de la generación elegida. Restaurar SQLite junto
con la configuración y su clave de cifrado correspondientes, corregir
propietario/permisos del estado y comprobar la compatibilidad de la release.
No extraer el archivo privado directamente sobre `/` sin revisar su inventario.
La restauración no escribe en Supabase, la web principal ni su landing.
