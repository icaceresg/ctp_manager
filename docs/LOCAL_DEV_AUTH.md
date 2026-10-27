# Manager con CTP DEV local

## Perfil aislado del candidato PRE

El launcher sin perfil sólo admite el worktree propietario `D:/CTP/worktrees/ctp-manager-dev-local-20261026`. Desde otro worktree falla antes de leer secretos, consultar servicios o abrir SQLite. El candidato tiene un perfil opt-in finito, validado y fijado antes de operar:

```json
{
  "schemaVersion": 1,
  "projectId": "ctp-pre-candidate-20261027",
  "dataRoot": "D:/CTP/dev/pre-candidate-20261027",
  "ctpRoot": "D:/CTP/worktrees/ConnectToPlay-ops-ranked-alerts-pre-20261027",
  "ctpToolRoot": "D:/CTP/output/ops-ranked-alerts-pre-20261027/isolated-tools/infra/dev",
  "managerRoot": "D:/CTP/worktrees/ctp-manager-ops-ranked-alerts-pre-20261027",
  "apiOrigin": "http://127.0.0.1:59021",
  "webOrigin": "http://localhost:59080",
  "managerOrigin": "http://localhost:59090",
  "controlPort": 59091
}
```

El archivo debe ser regular, sin enlaces y estar directamente bajo ese `dataRoot`, por ejemplo `manager-profile.json`. No contiene secretos. Cualquier clave, ruta, proyecto o puerto distinto se rechaza. El tooling CTP adaptado es creado por el coordinador en `ctpToolRoot`, con sus hashes de origen y adaptación; el launcher sólo invoca su `stack.py status` y exige el mismo proyecto/sourceRoot, PostgreSQL17, cero cron y cero Vault.

Comandos desde el worktree candidato, sólo después de preparar su stack propio:

```powershell
npm run dev:local -- check --profile D:/CTP/dev/pre-candidate-20261027/manager-profile.json
npm run dev:local -- start --profile D:/CTP/dev/pre-candidate-20261027/manager-profile.json
npm run dev:local -- status --profile D:/CTP/dev/pre-candidate-20261027/manager-profile.json
npm run dev:local -- stop --profile D:/CTP/dev/pre-candidate-20261027/manager-profile.json
```

Usa SQLite `dataRoot/manager/manager-dev.sqlite`, secretos propios `dataRoot/ctp/secrets.private.json`, marcador de propietario con proyecto/sourceRoot y referencias privadas de runtime propias. Antes de arrancar comprueba SQLite y sus archivos `-wal`/`-shm`: si existen deben ser regulares, sin enlaces, con ruta real exacta y un único enlace físico. Sirve el build en59090 y control privado en59091; este launcher no inicia Vite. No admite clave ni opciones PC Check. No lee ni modifica las bases, sesiones o secretos del DEV anterior.

## Modo Auth local

El modo compartido utiliza la cuenta de CTP también en desarrollo: GoTrue local,
la RPC real `manager_link_own_identity()` y los permisos de staff de esa base.
No habilita administradores independientes de Manager ni acepta jugadores.

La excepción está desactivada por defecto. Sólo se permite con
`CTP_DEV_LOCAL_AUTH=true`, `CTP_AUTH_MODE=ctp` y `PUBLIC_ORIGIN` vacío. El origen
debe ser HTTP, loopback literal (`127.0.0.1`, `localhost` o `[::1]`) y tener un
puerto explícito. No se aceptan IP alternativas, alias DNS, credenciales o rutas
en ese origen. PRE y PROD mantienen sus orígenes HTTPS exactos y rechazan esta
opción DEV.

Auth, web y puente deben usar **el mismo origen**, por ejemplo
`http://127.0.0.1:58080`. El proxy DEV debe enviar `/auth/v1`, `/rest/v1`,
`/functions/v1` y `/storage/v1` al stack local y el resto a Vite. No apuntar el
login local a un servicio alojado para completar un entorno DEV.

Configuración del proceso Manager, usando sólo valores locales recién creados:

```dotenv
CTP_AUTH_MODE=ctp
CTP_DEV_LOCAL_AUTH=true
PUBLIC_ORIGIN=
CTP_AUTH_URL=http://127.0.0.1:58080
CTP_WEB_ORIGIN=http://127.0.0.1:58080
CTP_OPERATIONS_URL=http://127.0.0.1:58080/functions/v1/manager-operations
CTP_AUTH_CAPTCHA_REQUIRED=false
CTP_SYNC_SECONDS=0
OBS_ENABLE_CONTROL=false
```

El arranque DEV debe aportar además `DATA_DIR` y `DB_PATH` propios, la clave anon
del stack nuevo, una `CTP_AUTH_TOKEN_KEY` de 32 bytes aleatorios en base64url y
credenciales nuevas e independientes del puente. Nunca copiar `.env`, sesiones,
tokens o bases persistentes de PRE/PROD. Los permisos para escritura local se
configuran por separado mediante `CTP_ENABLE_WRITES=true` y
`CTP_ALLOW_LOCAL_WRITES=true`; la firma, los nonces y las ACL de CTP siguen siendo
obligatorios.

Crear las cuentas de desarrollo en Auth local y confirmarlas. Los usuarios CTP
locales de rol `admin` o `referee` obtienen su binding canónico en el primer
acceso, mediante la RPC existente; una cuenta sin acceso de staff recibe 403.
Mantener las integraciones de pagos, push, correo externo, Discord y Twitch sin
credenciales de proveedor. El correo de pruebas debe terminar en el buzón local.

Las pruebas HTTP automatizadas de esta opción arrancan Manager con SQLite nueva
y un servidor Auth sintético en loopback. Comprueban el destino exacto, la cookie
de sesión, los permisos y el bloqueo de redirecciones. Son pruebas de transporte
y acceso; no sustituyen la verificación del stack Supabase local real.

## Arranque del entorno persistente

Con el stack CTP DEV preparado, migrado y con su proxy web en `58080`:

```powershell
npm.cmd run build
npm.cmd run dev:local
```

Manager se abre en `http://localhost:58090`. El launcher lee únicamente
`D:\CTP\dev\ctp\secrets.private.json` del proyecto `ctp-dev-20261026`, comprueba
la identidad de la base mediante el verificador local de CTP, Auth y el contrato
REST a través del proxy DEV. No admite seleccionar una URL o base alternativa.
La SQLite persiste en `D:\CTP\dev\manager\manager-dev.sqlite`; nunca se copia la
de PRE/PROD. La cuenta es la del Auth CTP local, sin bootstrap de Manager.

El proceso hijo sólo hereda variables de sistema y la configuración DEV
construida por el launcher. Se rechaza un `.env` en el worktree para no mezclar
configuraciones. No se transmite la clave `service_role` a Manager. Las
escrituras se habilitan contra el puente local con las comprobaciones reales de
firma y permisos; sincronización automática y OBS permanecen desactivados.

```powershell
npm.cmd run dev:local -- check
npm.cmd run dev:local -- status
npm.cmd run dev:local -- stop
```

`stop` se comunica con el launcher mediante un canal privado de loopback y sólo
detiene el hijo que éste creó. No mata procesos buscando su nombre ni usa un PID
guardado como autorización. Conserva la SQLite y todos sus datos. Si el archivo
privado de runtime pertenece a este proyecto y worktree pero su control devuelve
`ECONNREFUSED`, sólo `start` comprueba que `58090` esté libre en IPv4 e IPv6 y
archiva esa referencia como `runtime.stale-<fecha>-<nonce>.private.json` dentro
de su carpeta de datos. No mata PIDs ni modifica SQLite. Timeouts, otro origen,
puertos ocupados o una referencia que cambie durante la comprobación detienen
el arranque; `status` y `stop` tampoco recuperan referencias automáticamente.
Para recoger cambios de interfaz, compilar y reiniciar este Manager
DEV; el script no publica en PRE ni PROD.

## Promoción de cambios

La preparación de PostgreSQL, Auth, Functions y datos propios está descrita en
la [guía CTP DEV](../../ConnectToPlay-dev-local-20261026/infra/dev/README.md)
del worktree hermano de este entorno. La base DEV conserva su identidad local;
no sirve como origen de una restauración ni como paquete de migraciones para
PRE/PROD.

1. Crear una rama y un worktree aislados desde la base remota vigente del
   repositorio. Revisar la rama `pre` actual y las integraciones de otros
   colaboradores antes de preparar la integración. Desarrollar y verificar los
   cambios en el stack DEV propio, manteniendo los roles, ACL y firmas reales.
   Identificar por separado pruebas con fixtures, recorridos reales del stack
   local y verificaciones sobre PRE.
2. Completar las comprobaciones locales. En Manager, ejecutar las mismas
   comprobaciones de [.github/actions/manager-checks](../.github/actions/manager-checks/action.yml):

   ```powershell
   npm.cmd ci
   npm.cmd audit --audit-level=high
   npm.cmd test
   python -B test/metrics-traffic.test.py
   python -B test/metrics-collector.test.py
   python -B test/manager-release.test.py
   npm.cmd run build
   ```

   En CTP, seguir el conjunto vigente de
   [VPS checks](../../ConnectToPlay-dev-local-20261026/.github/workflows/vps-ci.yml):
   dependencias y auditorías de aplicación/servicios, pruebas de workers,
   `i18n:check`, pruebas de aplicación, Discord y herramientas de publicación,
   self-test del instalador y build. Completar también las pruebas SQL de
   [PostgreSQL 17 efímero](../../ConnectToPlay-dev-local-20261026/.github/workflows/vps-release-postgres.yml).
   Un build correcto o un fixture HTTP no sustituye las demás comprobaciones.
3. Con el candidato terminado y sus evidencias, obtener la orden explícita del
   usuario para publicarlo en PRE **antes de integrar o hacer push a `pre`**.
   Ambos repositorios publican PRE automáticamente al recibir un push a esa
   rama. Actualizar el candidato con las integraciones concurrentes y repetir
   las comprobaciones afectadas. Si Manager depende de un contrato privado de
   CTP nuevo, validar primero ese contrato y coordinar el orden de publicación.
4. Verificar el resultado del workflow PRE, el commit, el recibo de publicación
   y la salud del runtime. Validar el recorrido candidato con cuentas y permisos
   reales autorizados, conservando datos y resultados. No interpretar una página
   pública HTTP 200 como validación del recorrido autenticado. Anotar cualquier
   parte pendiente de aceptación.
5. Sólo tras la orden explícita del usuario para PROD, revisar qué cambios del
   candidato se promueven a `main`, preservando el trabajo ajeno. Comprobar el
   diff y las dependencias frente a la versión publicada; no incorporar todos
   los cambios de PRE por su mera presencia en la rama. Lanzar manualmente el
   workflow PROD desde `main`, primero con `dry_run=true`. Para la publicación
   autorizada, usar los campos exactos indicados debajo. Después verificar
   commit, recibo, runtime y recorrido afectado en PROD.

| Repositorio | PRE al hacer push a `pre` | PROD manual desde `main` |
| --- | --- | --- |
| Manager | `Manager PRE automatic deployment` (`deploy-pre.yml`) | `Manager PROD manual deployment` (`deploy-prod.yml`): `dry_run=false`, `confirm=PUBLICAR PRODUCCION` |
| CTP | `VPS PRE automatic deployment` (`vps-pre.yml`) | `VPS production application - manual only` (`vps-prod.yml`): `dry_run=false`, `confirmation=PUBLICAR PRODUCCION` |

Estos pasos documentan el CI/CD existente; no cambian sus triggers ni autorizan
una publicación. La opción `CTP_DEV_LOCAL_AUTH` sólo pertenece a DEV. No incluir
las claves locales, sesiones, SQLite o archivos privados de runtime en el
artefacto de una publicación.

### Alcance comprobado del CI/CD

Auditoría del código de workflows del 26 de octubre de 2026: ambos PROD sólo
admiten `workflow_dispatch` sobre `main`, tienen `dry_run=true` por defecto y
exigen la frase exacta para publicar. Manager comprueba además ese evento,
rama y confirmación en `scripts/deploy-vps.sh`. El dry run de CTP envía el
artefacto al adaptador restringido con `--dry-run`; el de Manager comprueba el
acceso SSH restringido sin ejecutar su paso de publicación. Ambos consultan
infraestructura remota, por lo que no forman parte del desarrollo diario local.

Los workflows construyen el SHA seleccionado de `main`; no prueban por sí solos
que ese conjunto de cambios haya sido aceptado en PRE. PRE y PROD compilan con
configuraciones de entorno distintas: verificar la procedencia del código y el
plan de backend, sin exigir hashes idénticos de frontend. Declarar
`environment: Production` tampoco demuestra que GitHub tenga revisores o
protecciones de rama configurados; esa política remota no se ha auditado aquí.

CTP conserva workflows `[LEGACY OFF]` para Vercel, migraciones y Functions cloud,
manuales y condicionados a `CTP_LEGACY_DEPLOY_ENABLED=true`. No habilitarlos como
atajo para este flujo ni confundir sus resultados con el despliegue VPS. No se
ha encontrado un despliegue automático de PROD por push a `main` en los
workflows revisados.
