# Centro operativo: contrato API

Todas las rutas se montan bajo `/api`, requieren sesión y aplican permisos en servidor. Los IDs externos son cadenas. Las respuestas de mutaciones son el recurso actualizado, salvo comandos oficiales `{command, resource}`. Las modificaciones llevan `expected_version` entero; versión desactualizada devuelve 409. Ningún comando cambia por sí mismo un resultado oficial.

## Consultas

- `GET /operations/bootstrap`: `{matches, incidents, assignments, staff, stats, clubs, deliveries, sanctions, production, audit, connection, commands, rundowns}`. Se filtran colecciones y campos privados según `operaciones`, `arbitraje`, `casters`, `realizacion`, `clubes`, `comunicaciones`; administrador accede a todo.
- `GET /operations/matches/:id`: `{match, incidents, assignments, statistics, notes, production, audit}`; mismas restricciones. Solo notas públicas para personal ajeno a arbitraje, notas internas nunca a casters/comunicación.
- `GET /operations/incidents/:id`: `{incident,notes,audit}` restringido a arbitraje. `staff` contiene `{id,name,username,sections,availability:[{date,status,note}]}`. Solo administración recibe además `integration_actor_id`, UUID para vincular al operador en CTP. La disponibilidad solo se entrega a la propia persona y a coordinación (`operaciones`)/administración. No se incluyen contraseñas ni sesiones. Un recurso retirado de un feed completo deja de ser accesible aunque su historial siga conservado en la base local.

## Supervisión de Ranked

- `GET /operations/ranked/monitor` y `GET /operations/ranked/lobbies/:id?before=<id>` requieren el rol real de CTP `admin` o `referee`. Una sección local de arbitraje no concede acceso. El detalle pagina hasta 50 mensajes y entrega `chat.can_send`; si la capacidad está ausente o las escrituras de Manager están desactivadas, vale `false`.
- `POST /operations/ranked/lobbies/:id/chat` acepta únicamente `{message,request_id}`: texto de 1 a 800 caracteres Unicode y UUID estable por intento lógico. Está disponible en todos los estados de partida si CTP concede `ranked.chat`. No admite parámetros de consulta, identidad ni rol del cliente.
- Manager deriva `actor_id` de la sesión y firma la acción `ranked_lobby_chat` con el lobby, texto y UUID. CTP revalida cuenta, rol y vínculo activo. El recibo debe confirmar la misma partida, UUID y texto antes de mostrarse como enviado; reintentar el mismo UUID/texto recupera el resultado sin duplicarlo. Solo se añade un mensaje: no se envían votos ni se cambian resultados, XP o colas.
- Los mensajes nuevos de staff incluyen `author_role: "admin" | "referee"`, registrado al enviarlos. Los mensajes anteriores, de jugadores o de sistema mantienen `null`. Nunca se deduce una insignia del rol actual del autor.

## Expedientes (`arbitraje`)

- `POST /operations/incidents`: `{match_id,title,reason,priority:"normal"|"urgent"}` crea expediente interno.
- `PATCH /operations/incidents/:id`: `{expected_version,status:"open"|"investigating"|"waiting",assignee_id?:number|null,priority?:"normal"|"urgent"}`.
- `POST /operations/incidents/:id/notes`: `{expected_version,text,visibility:"internal"|"participants"}`. Una respuesta genera `incident.reply`, no se anuncia como entregada sin ACK. Respeta la visibilidad existente del destino CTP: ticket autor/staff, chat ranked participantes. Texto interno hasta 8.000 caracteres; respuesta ticket hasta 2.000, ranked hasta 800. Los expedientes internos locales no tienen destino CTP y rechazan respuestas externas.
- `POST /operations/incidents/:id/resolve`: `{expected_version,resolution,decision:"close"|"award"|"cancel",winner_team_id?,winner_side?,maps_a?,maps_b?}`. `award` exige ganador UUID para retos, lado `a|b` para ranked, marcador de mapas sin empate para torneo. CTP revalida el dominio. Genera solicitud oficial y estado local `resolution_pending`. Los expedientes `source:"manager"` solo admiten `close`: cierre interno `closed_internal`, `official:false`, sin cambios competitivos ni comando.

## Equipo y retransmisión

- `POST /operations/assignments` (`operaciones`): `{match_id,user_id,role:"referee"|"caster"|"producer",starts_at,ends_at}`. Requiere disponibilidad marcada para todos los días del turno, sin solapes y permiso del usuario asignado.
- `PATCH /operations/assignments/:id`: `{expected_version,status:"confirmed"|"declined"|"cancelled"}`. Solo asignado confirma/rechaza; operaciones/admin cancela.
- La misma ruta admite `{expected_version,user_id,starts_at,ends_at,reason}` para sustitución o reprogramación por coordinación. Revalida disponibilidad y solapes, conserva partido y función, registra motivo y devuelve el turno a pendiente de confirmación.
- `POST /operations/matches/:id/notes` (`casters`): `{text}`; nota editorial local.
- `PUT /operations/matches/:id/production` (`realizacion`): `{expected_version,rundown_id:number|null,state:"preparation"|"ready"|"live"|"paused"|"finished",scene?:"preview"|"teams"|"map"|"pause"|"result"|"next",note?:string}`. Primera versión 0. Persistencia de coordinación; no controla OBS sin conector.
- `POST /operations/matches/:id/content` (`comunicaciones`): `{}`. Crea tarjeta en calendario y recursos una sola vez; exige resultado confirmado, devuelve `{id,created}`.

## Revisión y comandos oficiales

- `POST /operations/stats/:id/review` (`arbitraje`): `{expected_version,decision:"approve"|"reject",reason}`; motivo de 3 a 500 caracteres.
- `POST /operations/stats/:id/correct` (`arbitraje`): `{expected_version,reason,players:[{user_id,score,kills,deaths,assists,objective}]}`. Exige los ocho jugadores, cifras válidas y un cambio real. Genera `stats.correct`; el ACK identifica una revisión nueva pendiente, conserva la original y sincroniza de nuevo. Si esa lectura falla, devuelve `confirmed:true,sync_pending:true`: no repite la escritura ni anuncia sincronización completa.
- `POST /operations/clubs/:id/review` (`clubes`): `{expected_version,decision:"verify"|"reject",reason}`; motivo de 12 a 500 caracteres. Nunca modifica Team Pass ni pagos.
- `POST /operations/deliveries/:id/retry` (`comunicaciones`): `{expected_version}`.
- `POST /operations/sanctions` (`arbitraje`): `{incident_id,subject_id,subject_type:"player"|"club",reason,starts_at,ends_at,restriction:"warning"|"competition_suspend",scopes:[]}`. Crea propuesta `status:"draft",official:false`. La amonestación exige ámbitos vacíos; una suspensión exige selección explícita de uno o más: `tournament_registration`, `challenges`, `ranked`. No hay ámbitos predeterminados. Motivos de sanción/recurso/revisión/revocación: 12–2.000 caracteres.
- `POST /operations/sanctions/:id/submit` (`arbitraje`): `{expected_version}`. Prepara `sanction.create` usando el mismo UUID de la propuesta y versión externa inicial 0. Exige expediente original CTP y vigencia sin finalizar. El registro sigue sin ser oficial hasta ACK. CTP valida la identidad, el caso y los ámbitos antes de aplicar restricciones.
- `POST /operations/sanctions/:id/appeal` (`arbitraje`): `{expected_version,reason}`. Propuesta interna: recurso local. Sanción oficial: prepara `sanction.appeal` y conserva estado hasta ACK.
- `POST /operations/sanctions/:id/review` (`arbitraje`): `{expected_version,decision:"uphold"|"revoke",reason}`. Quien solicitó la sanción o registró su recurso no puede resolverlo. Las revisiones oficiales generan `sanction.review`; CTP revalida además la independencia de las identidades remotas.
- `POST /operations/sanctions/:id/revoke` (`arbitraje`): `{expected_version,reason}` prepara `sanction.revoke` para una sanción oficial.
- `POST /operations/commands/:id/cancel`: `{expected_updated_at}`. Solo autor con permiso vigente o administrador. Admite `pending` con cero intentos, o `rejected` con exactamente un intento y `result.rejected_confirmed:true`. Descarta la propuesta, registra quién/cuándo y libera el recurso local. Nunca revoca una acción remota. Un intento ambiguo se recupera con su mismo identificador, no se descarta.

## Sanciones directas (`arbitraje`, CTP 240)

La pestaña **Sanciones** lee y escribe directamente en CTP mediante `admin_service` `discipline`. CTP autoriza cada llamada con los permisos `sanction.*` del operador (administración o arbitraje), aplica la decisión al momento y avisa al jugador. No pasa por la cola de Decisiones ni necesita expediente.

- `GET /operations/discipline/overview`: `{generated_at,active,appeals,recent}`. `active` reúne suspensiones, bloqueos de Ranked y amonestaciones vigentes o programadas; `appeals`, recursos pendientes.
- `GET /operations/discipline/users?buscar&page`: todas las cuentas de CTP (25 por página) con `restricted_until`, `warnings` e `history`.
- `GET /operations/discipline/users/:id`: `{user,clubs,items}` con todo el historial disciplinario de la cuenta.
- `POST /operations/discipline/sanctions`: `{request_id,user_id,restriction:"warning"|"competition_suspend",scopes,starts_at,ends_at,reason}`. La amonestación lleva ámbitos vacíos y su `reason` es el mensaje que ve el jugador; la suspensión exige uno o más de `ranked`, `challenges`, `tournament_registration`. Duración máxima de 10 años. No se sanciona a staff.
- `POST /operations/discipline/sanctions/:id/revoke` y `/review`: `{request_id,expected_version,reason[,decision]}`; reutilizan las reglas de independencia de CTP.
- `POST /operations/discipline/bans/:id/lift`: `{request_id,reason}` levanta antes de tiempo un bloqueo de Ranked.

`request_id` hace idempotente cada escritura: repetirlo con los mismos datos devuelve el resultado ya aplicado (`replayed:true`). Los errores llegan como códigos `discipline_*` que Manager traduce; nunca se reenvía texto SQL.

## Usuarios CTP (administración)

- `POST /administration/users/:id/delete`: `{expected_version,confirm_username}`. Solo administración CTP y con escrituras activadas. CTP rechaza staff, la propia cuenta y al líder de un club con más miembros. Si la cuenta no tiene historial compartido se borra por completo (`mode:"deleted"`); si lo tiene (partidas, resultados, estadísticas, torneos, pagos), se cierra, se borran sus datos personales y queda anónima como «Cuenta eliminada» (`mode:"anonymized"`).
  Los errores del puente se clasifican con códigos fijos: permisos (403), operación ocupada o dependencia (409), tiempo agotado (504), esquema pendiente o servicio no disponible (503). Manager muestra texto propio y conserva el estado HTTP; nunca muestra SQL, identificadores o mensajes internos de CTP. No hay reintento automático de borrado. Un resultado incierto exige recargar la cuenta antes de decidir si se envía otra solicitud deliberada.

## Adaptador interno

`ingestSnapshot({matches,incidents,stats,clubs,deliveries,sanctions})` (alias `statistics`) valida y persiste proyecciones CTP de forma transaccional. Las colecciones omitidas no se borran. Un feed con `generated_at` y sin `possibly_truncated` retira de las vistas los registros externos ausentes en las colecciones presentes, preservando su historial. Los feeds parciales no permiten inferir bajas. Se rechazan reversiones a una `source_version` anterior. Campos `version` de API Manager son locales; `source_version` conserva la versión externa. `getIntegrationStatus()` / `setIntegrationStatus(status)` mantienen estado sin secretos.

Una sanción oficial mantiene `status` (`scheduled`, `active`, `expired`, `revoked`) separado de `appeal_status` (`none`, `pending`, `upheld`, `revoked`). Las identidades CTP recibidas se conservan en `source_issued_by`/`source_appealed_by`; no se confunden con los IDs numéricos locales. Un snapshot puede adoptar el UUID de una propuesta local únicamente si existe un comando `sanction.create` asociado y coinciden sujeto y expediente. El ACK anterior nunca sobrescribe una versión más nueva recibida del feed.

`listPendingCommands(limit=50)` devuelve comandos pendientes con `id`, `idempotency_key`, `type`/`action`, `actor_id`, `target_id`/`resource_id`, `resource_type`, `expected_version` externa y `payload`. `getCommand(id)` añade `source_available` y `source_version_current`. `markCommandSending(id)` marca e incrementa el intento antes del I/O; puede recuperar un `sending` con antigüedad superior a 30 segundos conservando su UUID. `acknowledgeCommand(id,result)` exige `{confirmed:true,external_id?:string}` y registra ACK idempotente; `failCommand(id,error)` conserva el mismo ID, error y solicitud para diagnóstico/reintento. No hay ruta web para fingir ACK ni ingerir snapshots.

El adaptador puede certificar exclusivamente un rechazo HTTP 400/422 como `failCommand(id,{message,definitive_rejection:true})`. El backend solo convierte ese resultado en `rejected` si estaba `sending` y era el primer intento. Un timeout anterior impide descartar aunque un reintento posterior reciba 422. Los rechazos definitivos siguen bloqueando otra solicitud del mismo recurso hasta descartarlos expresamente.

Acciones: `incident.resolve`, `incident.reply`, `stats.review`, `club.verify`, `discord.retry`, `sanction.create`, `sanction.appeal`, `sanction.review`, `sanction.revoke` según capacidades anunciadas por CTP. Los marcadores y revisiones son proyecciones oficiales; la cola de comandos no altera sus valores hasta el ACK. Los comandos no se envían al crearlos.

## Competición e histórico oficial

- `GET /operations/competition?resource=tournaments|tournament|statistics&target_id=...`: consulta firmada al backend, con permisos `operaciones` para torneos y `arbitraje` para estadísticas. Admite búsqueda, estado, fecha y paginación mediante cursor; estadísticas se consultan por partido y conservan las revisiones anteriores.
- `GET /operations/history`: histórico oficial paginado por tipo (`match`, `incident`, `stats`, `command`), búsqueda, fechas y cursor; restringido a operaciones/arbitraje. No depende del límite de la proyección de jornada.
- `POST /operations/competition/commands`: `{type,target_id,expected_version,payload}`; permiso operaciones. Acciones `tournament.create`, `tournament.update`, `tournament.status`, `tournament.registration`, `tournament.generate`, `tournament.publish`, `tournament.schedule`. Crear exige versión cero y genera el UUID local; el resto requiere la versión oficial recibida. Preparar no escribe en CTP.
- El sorteo reutiliza el motor de competición de CTP y sus puntos, no una segunda implementación en Manager. CTP verifica inscripciones, roster y versión; la publicación rechaza un sorteo obsoleto si cambiaron participantes, revisión o alineación y cierra inscripciones atómicamente.
- `POST /operations/integration/commands/:id/send` mantiene el envío explícito por administrador, conservando el autor original. Revalida el permiso local y el vínculo remoto; la firma del servidor no sustituye la autorización de la persona.

`getOperatorIdentity(userId)` crea/devuelve un UUID estable por usuario Manager activo, almacenado con FK `ON DELETE CASCADE`. El conector usa este UUID como `actor_id` remoto. Nunca se vincula CTP al ID numérico de SQLite, que podría reutilizarse después de borrar una cuenta. Borrar/recrear una cuenta exige vinculación remota nueva; las propuestas conservan el autor local mediante FK y no se envían si perdió acceso.

El adaptador debe autenticar cada acción y comprobar los permisos del actor contra CTP. Cada comando tiene clave de idempotencia estable: un fallo o timeout no debe repetir el efecto externo. La respuesta local pendiente no significa éxito en CTP. El historial registra actor, acción y recurso, sin secretos ni capturas.
