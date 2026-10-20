# Manager en producción y acceso del staff

El dominio `https://manager.playctp.com` apunta a CTP **PROD** desde el 20 de octubre de 2026. PRE conserva otro proceso, otra configuración y otra base SQLite. El cambio preservó los registros de producción y el trabajo editorial de Manager; no importa usuarios, sesiones, identificadores CTP ni comandos pendientes de PRE a producción.

La aplicación aceptada es `13b16717ba03631c6c89cd300730556c5d1363de`. El bridge compatible del repositorio `icaceresg/ConnectToPlay` es `e8b68d4f126a12e2ab859a2826e3024cacc13811`, con la migración 178 revisada y aplicada por entorno. Las revisiones son una referencia de esta publicación, no una orden para revertir publicaciones posteriores.

## Servicios y estado persistente

| Componente | Producción | PRE |
| --- | --- | --- |
| Servicio Node | `ctp-manager-prod.service` | `ctp-manager-pre.service` |
| Puerto de loopback | `3211` | `3210` |
| Release activa | `/srv/ctp-manager/prod/current` | `/srv/ctp-manager/pre/current` |
| Estado SQLite | `/var/lib/ctp-manager-prod/myredesmanager.db` | `/var/lib/ctp-manager-pre/myredesmanager.db` |
| Entorno privado | `/etc/ctp-manager/prod.env` | `/etc/ctp-manager/pre.env` |
| Origen Auth, web y API | `https://playctp.com` | `https://pre.playctp.com` |
| Bridge dedicado | `ctp-manager-prod-staff-bridge`, `127.0.0.1:9016` | `ctp-manager-pre-staff-bridge`, `127.0.0.1:9017` |

Solo Caddy publica HTTPS. No abrir los puertos internos ni compartir `DATA_DIR`, la clave de cifrado o un archivo de entorno entre servicios. El Manager de producción usa el mismo correo y contraseña que la cuenta de CTP PROD; no tiene un alta o contraseña local alternativa.

Las plantillas versionadas son `infra/vps/ctp-manager-prod.service`, `infra/vps/prod.env.example` e `infra/vps/manager.Caddyfile.fragment`. Son material de instalación y revisión: no sustituyen automáticamente los archivos privados activos. Mantener `CTP_AUTH_MODE=ctp`, los tres orígenes de producción iguales y `OBS_ENABLE_CONTROL=false`. Las plantillas nuevas empiezan con escrituras desactivadas; conservar el estado autorizado del despliegue real al preparar una actualización.

Los bridges, sus dos ejemplos de entorno y los handlers exactos de Caddy están versionados en el repositorio web bajo `infra/vps/manager/`. El compose activo reside en `/etc/ctp-manager/staff-access-bridge.compose.yml`. Las credenciales del bridge coinciden con las del Manager de su mismo entorno; no son claves del navegador. El antiguo bridge de producción en `9015` se conserva como recurso de reversión, sin recibir la ruta pública actual.

## Funciones organizativas y autoridad CTP

La migración 178 incorpora concesiones privadas `manager_staff_access` para `operations`, `referee`, `production`, `caster`, `communications`, `clubs` y `executive`. El directorio de **Usuarios y funciones** solo lo pueden usar administradores CTP o coordinación con concesión `operations` vigente. Ambos pueden asignar funciones de staff; esta interfaz no crea, degrada ni modifica administradores. SQL tampoco permite cambiar el propio acceso.

La RPC de identidad devuelve `role:staff`, `staff_kind` y únicamente `scopes:[staff.access]` para las funciones organizativas. El servidor limita cada función a sus secciones predeterminadas aunque haya asignaciones locales incorrectas. Caster obtiene escaleta, disponibilidad y dossier aprobado, sin incidencias privadas ni estadísticas pendientes. Cada petición vuelve a comprobar la cuenta central; una revocación bloquea el acceso y elimina la sesión comprobada.

Asignar Arbitraje cambia el rol central a `referee`, con su autoridad arbitral existente. Sustituir Arbitraje por otra función o retirar el acceso vuelve el rol central a `player`. Estos cambios son deliberados y auditados; no se deben sustituir por una edición aislada de los roles de SQLite. Manager elimina las asignaciones locales anteriores al detectar la transición central. Los roles locales revisados de un árbitro cuya identidad no cambia se conservan.

Coordinación organiza el trabajo local y gestiona las concesiones de staff. Este cambio no amplía `_manager_actor`: las operaciones competitivas oficiales siguen requiriendo sus permisos CTP vigentes, además de la sección local. Tener un menú de torneos no concede autoridad para publicar un cuadro. Las cuentas sin correo confirmado deben confirmarlo antes de entrar, aunque un administrador haya preparado su concesión.

## Publicación sin reemplazar datos

El workflow `.github/workflows/ci.yml` verifica y genera un artefacto; no instala servicios en la VPS. Solo reacciona a `pre`, `main`, PR hacia esas ramas o una ejecución manual. Publicar esta rama feature no cambia producción. `scripts/package-vps.mjs` incluye exclusivamente `server`, `shared`, `dist`, manifiesto y dependencias declaradas; excluye SQLite, entornos y secretos. Los assets de infraestructura se revisan aparte y no se aplican al instalar una release Node.

Antes de otra publicación:

1. Guardar un backup online coherente de cada SQLite afectado y de su configuración privada, clave de cifrado, manifiesto y unidades. Revisar el timer `ctp-manager-prod-backup.timer`, la última ejecución y los hashes; una copia en la misma VPS no sustituye un respaldo externo. No copiar solo el archivo principal mientras está en WAL.
2. Revisar qué commit está activo y comparar el estado persistente antes y después. No ejecutar seed, reset, importación PRE ni sincronización destructiva. La columna local `ctp_staff_kind` se añade sin borrar datos.
3. Preparar la release inactiva con `npm test`, build y manifiesto limpio, sin `.env` ni bases. Instalar únicamente dependencias de producción desde el lockfile; no compilar Vite en la VPS.
4. Conservar la migración 178 y el bridge compatible. Instalar Manager compatible antes de conceder funciones `staff`: `98ac` solo admite las identidades anteriores y las rechazaría. No retirar la migración al volver atrás; tampoco restaurar una base antigua encima de registros nuevos.
5. Cambiar únicamente el enlace `current` del entorno previsto y reiniciar su servicio. Comprobar HTTPS, `/api/auth/status`, Host/Origin, cuenta autorizada y denegada, revocación y la respuesta paginada del directorio. Las comprobaciones de lectura no deben crear cuentas, mandar correos ni aplicar decisiones de competición.

Conservar la release anterior y sus recibos privados. Una reversión de aplicación o proxy no revierte cambios de permisos centrales ya autorizados ni implica restaurar Supabase. Volver a una versión que rechaza `staff` exige evaluar antes la continuidad de acceso del equipo.
