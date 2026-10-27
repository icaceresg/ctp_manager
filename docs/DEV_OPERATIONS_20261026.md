# Candidato PRE de operaciones y avisos

Rama `codex/manager-ops-ranked-alerts-pre-20261027`, desde PRE/main `5fbab53`. Selecciona operaciones de `84bc66f`, `a7b8ced`, `13a690f` y la integración `1a2df22`, junto al panel/transporte de avisos `6270b01`. No deriva del candidato móvil completo.

**Inicio** reúne pendientes y un resumen Ranked con fecha de lectura. **Ranked** separa directo, revisión y estadísticas; conserva filtros al abrir una ficha y ordena las personas por espera original, destacando tres minutos o más. Leer el monitor no renueva presencia ni forma partidas.

**Jugadores** reúne identidad, Activision ID, actividad actual, valoración e historiales paginados de partidas, incidencias y sanciones según permisos. La edición mantiene su autorización administrativa. Véase [PLAYER_WORKSPACE.md](PLAYER_WORKSPACE.md).

**Incidencias** conserva la asignación oficial al responder, distingue notas internas y acciones CTP, valida ACK y conserva la referencia de una respuesta incierta. Desde una disputa Ranked abre la ficha completa. Las pruebas adjuntas son enlaces seguros sin incrustar contenido remoto. El buscador consulta sólo fuentes autorizadas, cancela peticiones anteriores y distingue ausencia, error y falta de permiso.

Se conservan los cambios de Iván `5046618` y `6d42161`: chat sin «Mensajes anteriores» y Clubes/Estadísticas fuera del menú, manteniendo sus páginas. El chat muestra mensajes recientes mientras carga el historial, avisa de fallos/límites y permite reintentarlo. Mantiene40 páginas/2000 mensajes, cancelación y una sola carga por vista. El refresco manual revalida el historial; el periódico no lo descarga completo otra vez.

**Avisos de staff** añade configuración versionada Discord/Telegram y estados en Administración → Integraciones. Requiere CTP247 y servicio privado `staff_alerts`. La interfaz no instala ni activa worker, proveedores o destinos. Las entregas inciertas no se reenvían automáticamente.

La ficha requiere `player_workspace` y lector252 junto a la reconciliación243/252/253: no aplicar la243workspace histórica sobre243season. El matchmaking pertenece a CTP245, desactivada por defecto; el Manager sólo presenta la espera y estado. No se promete una espera máxima si faltan personas o grupos factibles.

PC Check queda fuera: sin núcleo, catálogo, UI, menús, enlaces, endpoints, parser ampliado ni clave. También quedan fuera UGC/avatar, eliminación móvil y las capas de privacidad posteriores a627. Se mantienen las protecciones de la base PRE.

Las pruebas usan SQLite temporal, CTP sintético y JSX real. La prueba HTTP crea su propia SQLite temporal y sólo contacta con un proveedor loopback sintético; comprueba404 en endpoints PC. No usa bases o cuentas PRE/PROD ni acredita partidas o entregas reales.

Los checks del candidato constan en [PRE_CANDIDATE_20261027.md](PRE_CANDIDATE_20261027.md). El arranque del stack candidato se acredita por separado, con perfil y SQLite propios; véase [LOCAL_DEV_AUTH.md](LOCAL_DEV_AUTH.md). PROD requiere nueva orden expresa.
