# CTP Manager en la VPS: PRE

Este paquete prepara un servicio Node independiente conectado a la API de
`https://pre.playctp.com`. El dominio público del Manager es
`https://manager.playctp.com`. No crea otra base competitiva, publica la web de
jugadores ni controla OBS: torneos, resultados y permisos oficiales siguen en
CTP; el SQLite del Manager contiene sus cuentas de staff, organización,
proyecciones y comandos pendientes.

La configuración y esta unidad no prueban que exista un despliegue activo.
El alta del administrador, el puente firmado, DNS, TLS y los flujos reales
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
Si el puente aún no está preparado, omitir las tres variables `CTP_OPERATIONS_*`
y `CTP_SIGNING_SECRET` juntas: Manager puede arrancar sin conexión externa y
debe mostrar esa limitación. No activar una configuración incompleta.

Mantener `CTP_ENABLE_WRITES=false` hasta validar el puente, los operadores y
sus permisos en CTP. El token y la firma no conceden por sí solos permisos a
todos los usuarios del Manager. No activar cron, corte competitivo ni el
agente OBS como consecuencia de instalar este servicio.

## Administrador inicial y puesta en marcha

1. Crear el usuario de sistema `ctp-manager-pre`, sin contraseña interactiva,
   sin grupos privilegiados y con su estado privado vacío. Preparar runtime,
   release y enlace `current`, todavía sin publicar el vhost HTTPS.
2. Antes del primer arranque público, crear el administrador desde loopback
   según [DEPLOYMENT.md](../../docs/DEPLOYMENT.md), usando un túnel SSH y un
   proceso temporal con `PUBLIC_ORIGIN` sin definir y el mismo `DATA_DIR`.
   No ejecutar ese proceso mientras el servicio tenga ocupado el puerto 3210.
   No reutilizar usuarios, sesiones ni contraseñas de una base local.
3. Detener el proceso temporal, cargar el archivo privado final y comprobar
   que contiene el origen HTTPS exacto. Con `PUBLIC_ORIGIN` activo el endpoint
   de alta inicial queda bloqueado, aunque no exista todavía un administrador.
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
bloque público hasta que el DNS resuelva correctamente, el administrador esté
creado y el servicio pase las comprobaciones locales. No cambiar el bloque
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

La primera debe indicar `setup:true`, `authenticated:false`; la segunda debe
rechazarse con `403`. Después de habilitar DNS/TLS, probar desde el dominio
real: acceso de administrador y staff, cookies seguras, rechazo de Host y
Origin ajenos, usuario sin permisos, cierre de sesión y desactivación de una
cuenta. Sincronizar con PRE y cortar la conexión para verificar que conserva
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
