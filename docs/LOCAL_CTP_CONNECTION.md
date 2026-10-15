# Conexión CTP en este PC

Configurada y comprobada el 30 de septiembre de 2026, usando exclusivamente la base QA local. No se han desplegado funciones, migraciones ni cambios de repositorio a servicios remotos.

## Direcciones

- Manager conectado: `http://localhost:3211`.
- Web general QA: `http://127.0.0.1:5181`.
- API QA: `http://127.0.0.1:56921`.
- Puente privado: `http://127.0.0.1:56921/functions/v1/manager-operations`.

El proceso previo en 3210 se ha conservado. No ofrece esta configuración de conexión y no debe usarse para comprobarla. El archivo privado `.env` de Manager fija ahora `PORT=3211`. Ambos procesos conservan la misma base interna: no crear otro administrador ni sustituir la base de datos al cambiar de dirección.

## Configuración privada

`.env` contiene el token dedicado, la URL del puente y `CTP_WEB_ORIGIN=http://127.0.0.1:5181`. El token coincide con `MANAGER_INTEGRATION_TOKEN` del archivo ignorado `D:/CTP/worktrees/ConnectToPlay-broadcast/validation.local/env/.env.edge-local`, cargado por el runtime Edge local. No copiar este token al frontend, al chat o a Git.

`CTP_SYNC_SECONDS=30` actualiza la proyección mediante lecturas. También se puede pulsar Sincronizar. `CTP_ENABLE_WRITES=false` mantiene bloqueado el envío de decisiones, cambios de estadísticas, sanciones y reintentos de notificaciones. OBS permanece deshabilitado.

El administrador existente de Manager conserva su contraseña y su UUID estable de operador. Este UUID está vinculado **solo en QA** al usuario existente `QA_Referee`, mediante el administrador QA autorizado. El único ámbito concedido es `incident.reply`, necesario para que el puente permita leer el contexto privado; no se han concedido ámbitos de sanciones o resolución. El bloqueo de escrituras de Manager continúa activo. No se han creado usuarios ni elevado cuentas reales.

## Arranque

Mantener Docker y el runtime Edge QA en ejecución antes de abrir Manager. El runtime de Edge se gestiona desde el arranque local del bot; no lanzar una segunda copia. Desde esta carpeta, `npm run serve` utiliza `.env` y abre el servicio en 3211. Ejecutarlo solo si ese puerto está libre. Para compilar cambios de interfaz antes, `npm run build`.

El proceso conectado iniciado en esta revisión se registra en `data/local-manager.pid`; verificar el propietario del puerto antes de administrar un proceso, porque un PID puede reciclarse. Cerrar una consola no garantiza que un proceso iniciado oculto termine. No detener procesos de otros proyectos ni borrar archivos WAL mientras estén abiertos.

## Evidencia de la comprobación

`data/local-connection-evidence.json` guarda exclusivamente metadatos, identificadores QA y contadores, sin contraseñas ni tokens. La primera lectura real importó 17 partidos, 1 incidencia, 7 clubes y 18 registros de entrega; no había estadísticas pendientes ni sanciones. La lectura del contexto de la incidencia QA devolvió su mensaje existente. Las cifras pueden cambiar al utilizar QA.

Antes de configurar se creó una copia SQLite mediante la API de backup, con `PRAGMA integrity_check=ok`, en `data/pre-ctp-local-connection-2026-09-30T10-33-28-213Z.sqlite`. No se reaplicaron las migraciones 069, 070 o 071: ya estaban en la base QA. Las pruebas automatizadas de integración usan servidores y bases temporales separados.

También se comprobó la interfaz con la sesión de administrador existente: Jornada mostró los 17 partidos, Conexión indicó configuración correcta y escrituras desactivadas, y el botón Cargar conversación recuperó el mensaje QA de la incidencia. No se enviaron comandos oficiales. Las rutas privadas rechazaron las peticiones sin sesión con 401 y un Origin ajeno con 403.

Para repetir la comprobación, entrar con la cuenta existente en Manager, abrir Operaciones y Conexión, comprobar la última sincronización y abrir la incidencia. Cargar su conversación consulta CTP bajo el operador vinculado. Los enlaces de CTP deben abrir la web QA en 5181. No activar escrituras oficiales como parte de esta comprobación.
