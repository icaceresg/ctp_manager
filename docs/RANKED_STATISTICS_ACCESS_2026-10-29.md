# Lectura individual de estadísticas Ranked

Candidato DEV basado en `origin/main` de Manager, commit
`9f12179e4e344e22026a021d46eb7ff6ef7afe8d`, en la rama aislada
`codex/manager-ranked-statistics-reader-20261029`.

## Permisos y contratos

- `canManageRanked` conserva sus comprobaciones de administrador/árbitro.
- `canReadRankedStatistics` admite también una identidad CTP `staff` con los
  scopes exactos `staff.access` y `ranked.statistics.read`. La nueva lectura
  sirve exclusivamente a `/ranked/estadisticas` y a su GET agregado; no abre
  monitor, jugadores, chat, decisiones, bloqueos ni administración.
- La identidad central se valida en cada petición autenticada. La columna
  aditiva SQLite `ctp_ranked_statistics_read` es una copia de esa identidad,
  con valor inicial cero; una revocación reemplaza la copia y un rechazo de
  identidad la borra. Los permisos almacenados localmente no sustituyen esa
  validación ni la comprobación vigente de CTP al leer el informe.
- El directorio de staff acepta `ranked_statistics_enabled` booleano y toma
  su ausencia como `false`, para permitir el despliegue previo a la migración.
- Administradores y coordinación pueden usar
  `PATCH /api/staff-access/:id/ranked-statistics`, con cuerpo exclusivo
  `{"enabled":true|false}`. El puente firmado recibe exactamente
  `{action:"ranked_statistics_access_set",actor_id,user_id,enabled}`.
  La respuesta debe confirmar `{id,enabled,updated_at,changed}`; `updated_at`
  puede ser `null` cuando se deshabilita un permiso que no existía.
- El checkbox individual del directorio está separado de la función del
  usuario. Sólo se ofrece a jugadores confirmados con staff activo. No
  modifica su rol competitivo ni asigna una función nueva.
- CTP debe implementar la migración 296 y la acción firmada correspondiente.
  La migración inicialmente reservada como 295 se renumeró antes de publicarse,
  sin cambiar sus bytes SQL, para dejar 295 al horario de Halloween.
  Los rechazos de un backend anterior conservan el acceso cerrado.

## Validación local

- `npm test`: 489 pruebas; 484 correctas, 0 fallos, 5 omitidas.
- `npm run build`: correcto.
- `git diff --check`: correcto.
- Las pruebas nuevas verifican identidad con/sin concesión individual,
  rechazo de scopes inesperados o repetidos, navegación sólo a estadísticas,
  ausencia de autoridad arbitral, revocación al siguiente request,
  manipulación de la copia SQLite, rechazo de CTP durante una carrera de
  revocación, entrada estricta y actor de gestión ligado a sesión, recibos
  incoherentes, compatibilidad del directorio anterior y controles JSX.
- La suite completa emitió un aviso no fatal de puerto WebSocket de Vite
  ocupado durante los renders SSR concurrentes; terminó sin fallos.

Se han usado únicamente bases SQLite temporales, sesiones sintéticas y CTP
interceptado dentro de las pruebas. No se han utilizado datos, credenciales
ni servicios de PRE/PROD, no se ha iniciado un flujo real de jugador, no se
ha concedido acceso a ninguna cuenta y no se ha publicado este candidato.
La aceptación sobre entornos alojados y el grant individual quedan a cargo
del flujo CI y de la orden del usuario.
