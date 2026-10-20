# CTP Manager: instalación y conexión privada

El dominio público usa producción desde el **20 de octubre de 2026**. Consultar el [runbook vigente](MANAGER_PRODUCTION_2026-10-20.md) y las plantillas `infra/vps/ctp-manager-prod.service` y `infra/vps/prod.env.example`. La sección PRE del 15 de octubre y su ejemplo de instalación se conservan como antecedentes; no deben reemplazar `/etc/ctp-manager/prod.env` ni el proxy público actual.

Manager es el backoffice de staff, competición y arbitraje. La aplicación conserva SQLite para organización interna, comandos y proyecciones. El backend CTP compartido con la web de jugadores mantiene la fuente oficial de partidos, estadísticas, clubes y resoluciones; un comando pendiente en Manager no cambia el estado oficial. CTP Panel es una herramienta externa del PC de realización y controla la emisión; desplegar Manager no instala, abre ni conecta ese Panel.

Las decisiones oficiales se preparan en Manager y se envían explícitamente al backend CTP, con identidad y permisos del operador. Esto no crea una segunda base competitiva ni permite acceso directo a Supabase desde el navegador. La [matriz funcional](OPERATIONS_IMPLEMENTATION.md) describe los siete bloques implementados, incluidos torneos, inscripciones, sorteo oficial, publicación, horarios e histórico. Requieren desplegar el puente y las migraciones compatibles; véase el [plan de PRE](PRE_RELEASE_2026-10-02.md).

## Estado de PRE verificado el 15 de octubre de 2026

`https://manager.playctp.com` sirve la revisión `b867c885c75abf76a0099584b3515aa5d3df4cba`. Autenticación, enlaces web y puente de operaciones apuntan exclusivamente a `https://pre.playctp.com`. En esta instalación están activos `CTP_AUTH_MODE=ctp`, `CTP_ENABLE_WRITES=true` y `CTP_SYNC_SECONDS=30`; el backend PRE admite las operaciones firmadas. Las propuestas siguen necesitando el envío explícito de administración y un ACK válido, conservando la identidad del autor original.

`OBS_ENABLE_CONTROL=false` y el corte exclusivo de competición continúa con `enforced=false`: no se han retirado las herramientas de gestión existentes de la web CTP. Esta revisión no aplicó migraciones ni modificó producción. Las plantillas de instalación de este documento y de `infra/vps` mantienen deliberadamente las escrituras desactivadas para instalaciones nuevas. No copiar la activación de PRE a otro entorno sin validarlo.

La [recepción QA](MANAGER_PRE_QA_2026-10-15.md) distingue pruebas automatizadas aisladas, flujos reales de PRE y límites de la revisión. El paquete del 2 de octubre citado arriba es histórico, no el estado actual de despliegue.

## Acceso público con la misma cuenta CTP

En la VPS se usa `CTP_AUTH_MODE=ctp`: el staff entra con **el mismo correo y contraseña de CTP**. No crear administradores ni contraseñas independientes en Manager. GoTrue verifica las credenciales en el servidor y `manager_link_own_identity` confirma exclusivamente la identidad propia `ctp:<UUID>`. Se admiten administradores y árbitros CTP, además de jugadores con una concesión organizativa explícita y vigente de la migración 178. Un jugador sin concesión no entra. La identidad `staff` solo contiene `staff.access`; no adquiere ámbitos competitivos o administrativos por tener una sección local.

SQLite conserva un espejo de la identidad y las asignaciones internas, sin la contraseña CTP. Los tokens de sesión CTP se cifran con AES-256-GCM y una clave exclusiva del servidor; no se devuelven al navegador. Cada petición autenticada vuelve a verificar el staff en CTP, y las renovaciones concurrentes de una misma sesión se agrupan para evitar reutilizar tokens de refresco. Una caída de CTP bloquea las operaciones privadas; no activa un acceso local alternativo.

En modo público, la identidad y contraseña se gestionan desde la web CTP. Un administrador CTP puede organizar las secciones locales del staff y desactivar su acceso a Manager, pero no crear cuentas, cambiar su identidad ni otorgar autoridad de administrador CTP. La retirada del rol oficial se aplica en la siguiente petición. Conservar la clave de cifrado en los respaldos privados; perderla exige iniciar sesión de nuevo.

## Instalación local de desarrollo

1. Usar Node 22.13 o posterior, `npm ci` y `npm run build`.
2. Usar explícitamente `CTP_AUTH_MODE=local`, mantener `PUBLIC_ORIGIN` sin definir y arrancar con `npm run serve`.
3. Solo en ese entorno de desarrollo se crea el primer administrador desde `http://localhost:3210`.
4. No trasladar esa base, sus sesiones o sus contraseñas a la VPS. El despliegue público usa el acceso central CTP descrito arriba y bloquea el alta local aunque no exista ningún espejo todavía.

La base de datos está en `DATA_DIR/myredesmanager.db`; proteger el directorio y `.env` con permisos exclusivos del usuario de servicio. Respaldar SQLite mediante su API de backup o con el servicio detenido; copiar solo el archivo principal durante escrituras WAL puede perder datos. Comprobar restauración antes de aplicar migraciones a una base real.

## Proxy HTTPS en la misma VPS

Variables para el único dominio público admitido, conectado a PRE:

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
```

Express escucha únicamente en loopback. El proxy debe terminar HTTPS, conservar el `Host` público exacto y no reescribir `Origin`. No abrir el puerto 3210 en el cortafuegos ni activar `trust proxy` indiscriminadamente. Los encabezados `X-Forwarded-Host`/`X-Forwarded-Proto` no conceden acceso.

Ejemplo del bloque de proxy dentro del servidor HTTPS de Nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3210;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    client_max_body_size 1m;
}
```

El proxy debe rechazar hosts no reconocidos en su servidor predeterminado. Con `PUBLIC_ORIGIN` las cookies llevan `Secure`, `HttpOnly` y `SameSite=Lax`. Host, Origin y Fetch Metadata se comprueban antes de procesar cualquier API. Solo acceden administradores y cuentas con roles clasificados como staff. Las sesiones se invalidan al retirar todas sus funciones de staff. Un rol desconocido antiguo no concede acceso hasta que un administrador lo clasifique; se conservan sus permisos anteriores sin ampliarlos automáticamente.

## Puente de operaciones CTP

El repositorio de CTP contiene la Edge Function `manager-operations` y su migración. Deben revisarse y desplegarse por separado antes de configurar una VPS. La conexión QA de este PC se describe en [LOCAL_CTP_CONNECTION.md](LOCAL_CTP_CONNECTION.md); no constituye un despliegue remoto ni habilita escrituras oficiales.

```dotenv
CTP_OPERATIONS_URL=https://pre.playctp.com/functions/v1/manager-operations
CTP_OPERATIONS_TOKEN=<token aleatorio de 32 caracteres o más>
CTP_SIGNING_SECRET=<otro secreto aleatorio independiente de 32 caracteres o más>
CTP_ENABLE_WRITES=false
CTP_SYNC_SECONDS=0
```

El token se configura como `MANAGER_INTEGRATION_TOKEN` y la clave de firma como `MANAGER_SIGNING_SECRET` en CTP. Deben ser diferentes; no utilizar la `service_role` de Supabase como token del Manager. Nunca poner secretos en variables `VITE_`, código del cliente, enlaces o repositorios. La URL admite HTTPS y, para pruebas locales, HTTP solo con un host literal de loopback. No admite credenciales, parámetros ni redirecciones.

Cada petición lleva HMAC-SHA256 del cuerpo exacto, método, ruta canónica, origen `https://manager.playctp.com`, timestamp y nonce. La función verifica ambos secretos, una ventana temporal de 120 segundos y un nonce de un solo uso guardado en PostgreSQL. CORS/Origin por sí solos no autentican un servidor ([OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)). La seguridad depende de mantener estas credenciales exclusivamente en el backend autorizado.

Las escrituras remotas exigen `PUBLIC_ORIGIN=https://manager.playctp.com`. `CTP_ALLOW_LOCAL_WRITES=true` solo admite un puente HTTP de loopback para pruebas aisladas; no permite escribir en PRE desde localhost. Las lecturas remotas pueden probarse en local una vez desplegado el puente. La función debe usar `verify_jwt=false`: aplica su propia autenticación privada y no recibe JWT de jugadores.

La instalación del puente y la retirada de las herramientas anteriores son pasos separados. La migración 079 deja `competition_cutover_enabled=false`: conserva los permisos de la gestión web existente. Cuando el Manager esté accesible en su dominio y el staff esté vinculado, el servicio de despliegue puede llamar a `manager_set_competition_cutover(true, motivo)`. La operación es privada, exige un motivo y queda auditada. `false` restaura las concesiones originales; cualquier desviación de permisos o cadena de concesiones que no pueda reconstruirse provoca un rollback completo. No hay botón para activar este cambio desde una sesión web. La pantalla Conexión muestra el estado confirmado por CTP y trata un valor ausente como desconocido.

Este estado de transición no rebaja la autenticación del Manager: su firma, token, identidad y permisos se comprueban siempre. Antes de habilitar la exclusividad, probar el acceso real del staff y drenar operaciones pendientes de la web anterior. No activar el corte solo porque el puente responda.

El botón Sincronizar usa `{action: "snapshot"}`. El intervalo opcional `CTP_SYNC_SECONDS` solo efectúa lecturas (0 lo desactiva, mínimo 30). Si falla la conexión se conserva la última proyección válida y se muestra el estado de sincronización; no se transforma una caída en listas vacías ni en resultados cero. Las respuestas tienen límite de 4 MiB y 10 segundos.

El aviso `possibly_truncated` del puente se conserva para indicar que la lista puede ser parcial. El contexto privado de cada incidencia se carga aparte y paginado, solo a petición del staff de arbitraje: el identificador del operador procede de su sesión local y CTP comprueba su vínculo y permisos. Los mensajes no se copian a la caché de casters ni a la proyección general.

Para enviar una solicitud oficial, tras revisión y autorización de despliegue:

1. Con la migración 159 aplicada, la cuenta CTP del propio staff obtiene su vinculación `ctp:<UUID>` y los ámbitos derivados de su rol al autenticarse. La RPC no admite elegir otra cuenta ni reactivar una vinculación desactivada manualmente. Los vínculos manuales de identidades locales antiguas corresponden únicamente al modo de desarrollo y no sustituyen este acceso central.
2. En el dominio autorizado, activar deliberadamente `CTP_ENABLE_WRITES=true` y reiniciar Manager. Activar también `MANAGER_OPERATIONS_ENABLED=true` en CTP.
3. Sincronizar para conocer las acciones admitidas por CTP. El administrador revisa la solicitud pendiente y pulsa Enviar. No existe envío automático de comandos.
4. El adaptador comprueba que el autor original continúa activo y conserva el permiso local; CTP valida además su vinculación, permisos, versión y reglas de negocio.

El envío usa un identificador de idempotencia estable. Ante un timeout no se presupone éxito; un reintento usa el mismo identificador y CTP debe devolver el resultado guardado sin repetir el efecto. Solo un ACK `{applied:true}` con el mismo identificador, tipo y destino se convierte en confirmación local. Si la primera entrega recibe una denegación definitiva 401/403, se registra como rechazada y no aplicada, y puede descartarse expresamente para corregir la propuesta. Una respuesta posterior no elimina la incertidumbre de un intento anterior ambiguo: ese comando conserva su identidad y exige reconciliación. Las acciones que el puente no anuncie como admitidas permanecen pendientes. Las sanciones oficiales requieren además la migración CTP 070 y sus permisos explícitos.

Las rutas `/api/operations/integration` requieren sesión; sincronizar exige Operaciones o administrador y enviar exige administrador. Las respuestas de estado nunca incluyen URL de conexión privada, tokens o credenciales. El origen público `CTP_WEB_ORIGIN` sirve únicamente para enlaces a la web y es visible: HTTPS o HTTP exclusivamente de loopback para QA local.

## Preparación y emisión con CTP Panel

**Preparación** conserva partido, escaleta, notas, personal asignado y estados manuales de coordinación, manteniendo la ruta y el permiso `realizacion`. No envía órdenes a OBS ni consulta su estado. «En preparación», «Preparado», «En seguimiento», «Seguimiento en pausa» y «Cerrado» no son confirmaciones de OBS ni modifican resultados competitivos. Los códigos históricos `live` y `paused` permanecen en la base, pero se muestran con las nuevas etiquetas de seguimiento.

El equipo describe CTP Panel como un dock HTML externo que emite el estado del overlay y maneja tarjetas, marcador, mapas, descansos, casters, cámaras y acceso OBS local. Su archivo HTML no está disponible en este workspace: esta documentación no certifica su comportamiento. Debe existir una sola instancia de Panel por emisión; no abrir otra desde Manager ni ejecutar un segundo controlador OBS.

Mantener `OBS_ENABLE_CONTROL=false` y no iniciar `scripts/obs-agent.mjs`. El [backend y agente anteriores](OBS_AGENT.md) se conservan sin borrar tablas o historial, pero ya no forman parte del alta ni del despliegue recomendado de Manager. Sus variables no son necesarias para preparar una jornada.

La lectura JSON desde el Panel es una integración futura pendiente de revisar el HTML y acordar el contrato. La propuesta es adaptar en servidor solo los datos aprobados y necesarios, con acceso de lectura limitado; no exponer la proyección privada completa, conversaciones, credenciales Supabase ni el secreto del puente. No se ha creado un endpoint, un formato de campos, una URL de Panel ni un mapeo automático. Las credenciales y el estado de emisión del Panel permanecen en el PC; el dato competitivo oficial se mantiene separado de la edición manual en pantalla.

## Verificación antes de abrirlo al equipo

- Probar dominio HTTPS, cookies y rechazo de Host/Origin ajenos; no depender de que funcione por localhost.
- Comprobar cuentas con permisos distintos, desactivación de usuarios y ausencia de notas arbitrales en casters.
- Sincronizar contra un entorno CTP de pruebas y comprobar un corte de red conservando los datos anteriores.
- Probar una operación permitida y otra denegada, versión obsoleta y reintento del mismo comando sin duplicar efectos.
- Probar copia y restauración de SQLite, registros sin secretos y el control de acceso al servicio.

Las pruebas locales automatizadas usan bases y servidores temporales; no prueban credenciales, proxy, webhooks, notificaciones o despliegues reales.
