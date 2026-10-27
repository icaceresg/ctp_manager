# Moderación y privacidad de Ranked móvil

Implementación local en rama `codex/ctp-mobile-google-20261027`. No aplica migraciones ni inicia servicios remotos. Requiere el candidato CTP con 244, 248, 249 y 251 y los servicios firmados `ugc`, `ugc_avatar` y `erasure` de `manager-operations`.

## Operación

- Administración → Moderación consulta reportes, su evidencia de texto y el ticket relacionado. Una retirada/archivo exige motivo, versión actual y UUID de solicitud. Una respuesta incierta conserva exactamente la intención y su nonce para reintentar. El estado oficial lo decide CTP con el administrador real, permisos, CAS y recibo idempotente.
- Administración → Privacidad lista únicamente peticiones vinculadas por la relación privada 244. CTP entrega las versiones de solicitud y cuenta. El administrador escribe el nombre exacto para preparar; después procesa datos/archivos y comprueba Manager/PC Check. El ticket conserva su conversación habitual. El acceso antiguo `users/:id/delete` devuelve 422 y dirige a este proceso.
- El cliente nunca envía `actor`, `status`, `receipt_sha256`, dirección de correo ni un nombre de RPC. La única intención de inspección es `POST /api/administration/erasure/jobs/:id/inspect` con `{expected_version}`. El servidor resuelve ticket/sujeto desde su referencia privada, relee el estado oficial y exige la fase `external` y las verificaciones previas.
- Sólo `completed` con fase `complete`, cuatro verificaciones, fecha y `confirmation_state=sent` se presenta como completado. Pendientes, bloqueos de conservación y respuestas ambiguas no se convierten en éxito.

## Avatares denunciados

Un reporte con contexto `user` añade el snapshot del avatar denunciado, el perfil actual y su versión. Sólo se incrustan previews tipadas del origen público de Storage configurado y el namespace UUID propio, sin query, credenciales o navegación arbitraria; el servidor Manager no descarga las URL de avatar. Una referencia externa/emoji se muestra sin preview remota. La edición de nombre/biografía usa el diálogo de perfil existente y vuelve a leer la versión actual.

`GET /api/administration/ugc/:reportId/avatar` consulta el servicio HMAC `ugc_avatar`. `POST .../:reportId/avatar/remove` admite exclusivamente `expected_report_version`, `expected_user_version`, `reason` y `request_id`. El actor se deriva de la sesión administrativa; el servidor no acepta un UUID de usuario, archivo, bucket, URL o resultado elegidos por el navegador. Un fallo incierto conserva el nonce y ambas versiones para reintentar la misma retirada. `POST /api/administration/ugc/avatar-jobs/:jobId/retry` recibe sólo `expected_version`, y usa el mismo trabajo durable. Tras una respuesta incierta de retry se exige volver a consultar.

Desvincular el avatar del perfil no completa la limpieza del objeto. Los trabajos pendientes/reintentables mantienen su estado visible. Una retirada de archivo propio requiere `completed`, fase `complete`, `storage_verified=true` y `object_removed=true`. `display_only` exige ambos indicadores falsos y explica que sólo se ha retirado el avatar del perfil, sin borrar archivos externos. 251 impide archivar un reporte mientras su limpieza siga activa; el cliente no ofrece un bypass del estado o de Storage.

## Cobertura de la inspección externa

`server/erasure-local.js` trabaja sobre la conexión SQLite de esta instancia, en una transacción local. Comprueba el esquema real, tablas PC Check, un límite de filas y tamaño de proyecciones. Retira perfiles/cachés operativos identificados, invalida sesiones y asignaciones de carga PC Check y sustituye los campos personales conocidos de proyecciones deportivas, preservando claves, estadísticas y resultados.

Los expedientes, revisiones, notas, auditorías y referencias no clasificadas se conservan como `blocked_policy`. Los esquemas/columnas con datos desconocidos, JSON inválido, errores de lectura o límites producen `retryable`; nunca `clear` por una excepción. No se descifra ni elimina evidencia PC Check. No se inventa un plazo de conservación ni se ofrece un botón para declarar una evidencia libre.

Una marca pseudónima impide que una lectura antigua vuelva a introducir los campos personales conocidos en una proyección y evita nuevas recogidas PC Check del sujeto. La inspección exige `secure_delete` y un checkpoint WAL terminado antes de dar por limpia su cobertura. No acredita otras bases, copias de seguridad, archivos exportados, procesadores externos ni datos en dispositivos del personal: su política y control operativo siguen siendo una condición de publicación.

El recibo conserva sólo fecha, cobertura, conteos y códigos de motivo, sin UUID del jugador, nombres, correos ni textos. Su SHA-256 vincula ese informe al identificador opaco del trabajo y su versión. El backend recibe únicamente el resultado y el hash mediante el canal HMAC privado; el navegador no decide el resultado.

## Validación

Las pruebas usan bases SQLite efímeras y respuestas CTP sintéticas. Cubren autorización, inyección de autoridad/recibo, versiones y nonces, custodia PC Check, bloqueo de layouts nuevos, anonimización operativa sin alterar marcadores, proyecciones antiguas, DTOs y representación SSR segura. No representan una eliminación de jugador, envío SMTP ni aceptación humana real en PRE/PROD. Ejecutar `npm test` y `npm run build` antes de integrar.
