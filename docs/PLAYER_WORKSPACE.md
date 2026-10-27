# Ficha operativa de jugadores

Candidato PRE de operaciones del27 de octubre de2026. Busca por nickname, gamertag, Activision ID o UUID exacto y reúne identidad, valoración de la season, racha, participación actual e historiales de partidas, tickets y sanciones.

La lectura es manual y muestra su fecha. Presencia significa cola CTP, no conexión a Call of Duty. Sin valoración se distingue de cero XP; XP histórico no disponible no se inventa. La espera usa `joined_at` y `observed_at`.

## Contrato y permisos

- Transporte firmado existente, acción `player_workspace` y RPC `manager_player_workspace(text,jsonb)`. En PRE se incorpora por252 y la reconciliación243/252/253, sin reemplazar la243season histórica.
- Binding habilitado `ranked.read`, cuenta confirmada y activa, rol admin/árbitro. Lector `STABLE` compatible con `BEGIN READ ONLY`, sin estado/acción/mantenimiento ni renovación de presencia.
- `incident.reply` habilita metadatos de tickets; `sanction.create`, historial disciplinario. Sin permiso se devuelve `available:false,total:null`, distinto de vacío autorizado.
- No entrega correos, tokens, enlaces OBS, descripciones, pruebas ni mensajes de tickets. Manager valida IDs y aplica una segunda proyección.
- Editar conserva la administración existente y requiere `admin.console`. La ficha no concede escritura y no incluye PC Check.

`GET /api/players?query=&offset=0&limit=20` busca. `GET /api/players/:userId?results_offset=0&tickets_offset=0&sanctions_offset=0&limit=20` lee. Máximo25 por página, offsets0–999999 y consulta hasta120 caracteres; rechaza claves desconocidas y parámetros no enteros.

`createPlayerWorkspaceReader({request,actorFor})` reutiliza transporte y operador. No guarda otra copia de CTP en SQLite. Edge distingue404/400/403/503 sin publicar mensajes SQL.

Los tests cubren límites, identidad, DTO, permisos, historiales no disponibles, respuestas inválidas, enlaces y transporte. Las verificaciones SQL/HTTP del stack candidato tienen recibos separados. Este paquete no incorpora los workflows móviles posteriores de eliminación o anonimización.
