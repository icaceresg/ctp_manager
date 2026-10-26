# CI/CD de Manager PROD

Manager tiene dos destinos independientes. `pre` publica automáticamente en PRE. `main` ejecuta comprobaciones y genera artefactos; publicar PROD exige iniciar **Manager PROD manual deployment** desde Actions sobre `main`.

No se debe fusionar toda la rama `pre` para habilitar este circuito: el cambio de CI/CD puede publicarse sin promover funciones de la aplicación que aún estén en PRE.

## Validar sin publicar

En **Run workflow**, seleccionar `main` y mantener `dry_run: true` (valor predeterminado). El workflow ejecuta instalación, auditoría, tests y build; empaqueta el runtime con sus dependencias de producción; comprueba la autenticación SSH, el broker PROD y la salud anónima del runtime actual mediante `check prod`.

`check prod` no recibe un paquete ni cambia releases, procesos, bases de datos o configuración de la aplicación. Un resultado `ready` valida el acceso y las comprobaciones indicadas; no prueba un flujo autenticado de usuario.

## Publicar

Revisar el commit de `main` y sus dependencias de CTP. Iniciar el mismo workflow con `dry_run: false` y `confirm: PUBLICAR PRODUCCION`. No hay publicación por push ni por pull request. El script vuelve a exigir evento manual, rama `main`, modo de publicación y confirmación antes de conectar por SSH.

El broker acepta únicamente manifiestos limpios de `refs/heads/main` para PROD. Verifica checksum y archivos, crea backup de SQLite, cambia `current`, reinicia sólo `ctp-manager-prod.service` y verifica la release servida. Si falla, intenta volver al código anterior y deja recibo. La base de datos no se restaura automáticamente. La copia de seguridad queda para una recuperación manual.

## Configuración

| Nombre | Tipo y alcance |
| --- | --- |
| `MANAGER_VPS_PROD_SSH_KEY` | Secret del environment `Production`, clave exclusiva de `ctp-manager-deploy-prod`. |
| `MANAGER_VPS_PRE_SSH_KEY` | Secret de PRE, clave distinta de producción. |
| `MANAGER_VPS_HOST` | Variable de repositorio con el host SSH. |
| `MANAGER_VPS_KNOWN_HOSTS` | Variable de repositorio con la clave pública de host verificada. |

`secrets.NOMBRE` y `vars.NOMBRE` son almacenes distintos: guardar el host o su pin como Secret no proporciona una Variable. No se generan ni aceptan claves de host durante CI. SSH exige el pin guardado y rechaza contraseñas y forwarding.

## Infraestructura separada

El instalador `infra/vps/cicd/manager_release.py install --environment prod --public-key <clave-publica>` crea sólo el acceso y el broker. Ejecutar primero con `--dry-run`; revisar el plan y después instalar. Requiere que el servicio existente esté sano y corra desde su `current`. Nunca publica una release como parte de la instalación.

| Recurso | PRE | PROD |
| --- | --- | --- |
| Cuenta de despliegue | `ctp-manager-deploy-pre` | `ctp-manager-deploy-prod` |
| Broker socket | `ctp-manager-release-pre.socket` | `ctp-manager-release-prod.socket` |
| Servicio de aplicación | `ctp-manager-pre.service` | `ctp-manager-prod.service` |
| Releases | `/srv/ctp-manager/pre/releases` | `/srv/ctp-manager/prod/releases` |
| Estado del broker | `/var/lib/ctp-manager-release/pre` | `/var/lib/ctp-manager-release/prod` |
| Copias del broker | `/var/backups/ctp-manager-release/pre` | `/var/backups/ctp-manager-release/prod` |

Las cuentas no tienen sudo, Docker, contraseña, shell interactiva, TTY ni forwarding. El comando forzado rechaza otro entorno antes de conectar al socket; el broker también verifica el UID del peer. Un helper compartido contiene las dos configuraciones fijas, pero cada entrada, clave, socket, lock y ruta están separados.

No se modifican Caddy, los archivos `.env`, las unidades de aplicación, los timers de copias existentes ni el backend de ConnectToPlay. Las migraciones CTP que requiera una versión de Manager deben publicarse por su circuito correspondiente antes de esa versión.
