# Ficha operativa de jugadores

Desarrollo local del 26 de octubre de 2026. No se ha publicado en PRE ni PROD.

La sección **Jugadores** busca por nickname, gamertag, Activision ID o UUID exacto. Cada ficha reúne la identidad básica, valoración de la season activa, racha confirmada, participación actual, partidas terminadas, tickets propios y sanciones. Los enlaces a cuentas y partidas utilizan UUID canónicos; nunca deducen una cuenta por su nombre.

La lectura es manual y muestra su fecha. El estado de presencia corresponde a la cola de CTP; no demuestra que el jugador esté conectado a Call of Duty. Una cuenta sin valoración se distingue de una valoración de cero XP. Los resultados antiguos sin XP se conservan como información no disponible.

La espera visible se calcula entre `joined_at` y `observed_at`; se etiqueta **Espera en esta lectura** y sólo aparece para presencia de cola vigente. No usa un contador local para aparentar una consulta nueva.

## Permisos y datos

- Acceso mediante el transporte privado firmado existente, acción `player_workspace` y RPC `manager_player_workspace(text,jsonb)` de la migración243.
- El RPC vuelve a comprobar un binding habilitado con `ranked.read`, rol CTP admin/árbitro, cuenta confirmada, no eliminada ni bloqueada. Es una función `STABLE`, con búsqueda fijada, compatible con `BEGIN READ ONLY` y sin llamadas a estado, acción, mantenimiento o presencia.
- `incident.reply` habilita metadatos de tickets. `sanction.create` habilita el historial disciplinario. Ausencia de permiso produce `available:false,total:null`, distinta de un historial vacío autorizado.
- Ninguna respuesta incluye correos, contraseñas, tokens, enlaces OBS, descripciones, pruebas ni mensajes de tickets. El servidor Manager aplica una segunda proyección por lista de campos permitidos y valida los IDs.
- La edición sigue usando la ruta existente de administración, sólo para admin con `admin.console`. El acceso a esta ficha no concede escritura.
- **Revisiones PC** enlaza al módulo existente con `user_id`; no ejecuta revisiones ni interpreta sus resultados.

## Contrato para integración

`GET /api/players?query=&offset=0&limit=20` busca; `GET /api/players/:userId?results_offset=0&tickets_offset=0&sanctions_offset=0&limit=20` lee la ficha. Tamaño máximo25, offsets0–999999 y consulta máxima120 caracteres. El servidor rechaza claves desconocidas y parámetros no enteros.

`createPlayerWorkspaceReader({request,actorFor,database})` devuelve `readPlayerWorkspace(currentUser,query)`. La conexión SQLite de privacidad es obligatoria. Reutiliza el transporte y la identidad del operador existentes. `playerWorkspaceQuery`, `playerWorkspaceId` y `playerWorkspaceResponse` son las validaciones compartidas en el servidor; `parsePlayerWorkspace` valida la acción en el Edge. La vista no guarda una segunda copia de CTP en SQLite.

Después de recibir y validar la respuesta de CTP, consulta las marcas locales de borrado por los UUID oficiales. Si una ficha o cualquier fila de búsqueda pertenece a una cuenta marcada, rechaza la respuesta completa con404 genérico. No recorta páginas, modifica resultados ni vuelve a publicar un perfil recibido antes de la marca. La ficha también rechaza una cuenta ya marcada antes de consultar el puente. La evidencia de esta protección está en [la validación de respuestas tardías](manager-profile-erasure-qa-20261027.md).

## Comprobación local

- 8 pruebas focales Manager: límites, identidad, privacidad, permiso, historiales no disponibles, DTO inválido y transporte exacto. Build Manager correcto.
- 8 pruebas CTP: parser, restricciones del lector, handler firmado, DTO, semántica de errores y bloqueo de firmas, navegador y replay con base de datos falsa.
- 11 pruebas del launcher DEV, incluida clave PC-check opcional de 43 caracteres, independiente y de tipo string; se conserva la configuración legacy sin esa clave.
- Regresión SQL completa con fixtures dedicados y rollback: búsquedas paginadas, UUID, cuentas eliminadas, presencia vigente/caducada sin renovarla, resultados antiguos y páginas independientes de resultados/tickets/sanciones. También pasaron13 negativas reales:9 denegaciones42501 y4 validaciones22023. Ningún fixture persiste.
- 243 aplicada sólo al DEV aislado mediante el bootstrap con verificación de identidad. Las integraciones posteriores tienen sus propias comprobaciones.
- Búsqueda y ficha ejecutadas como `service_role` dentro de `BEGIN READ ONLY` para admin y árbitro DEV. Diez cuentas existentes conservadas, sin correos en los DTO y ACL declarativas correctas.

El recibo filtrado está en `D:/CTP/dev/ctp/verification/player-workspace-243.json`.

Los errores del lector tienen mapeo privado propio en el Edge: cuenta ausente404, consulta inválida400, falta de autorización403 y error desconocido503. Sólo los dos identificadores exactos de243 con SQLSTATE22023 reciben404/400. Los mensajes, detalles y pistas de SQL nunca se copian a la respuesta. El resto de acciones mantiene su semántica anterior.

Incidencia local resuelta: el cierre también se reprodujo tras confirmar243; la hipótesis de que dependía de una función sin confirmar quedó descartada. La imagen DEV `public.ecr.aws/supabase/postgres:17.6.1.106` coincidía con el fallo documentado de [supautils214](https://github.com/supabase/supautils/issues/214): el tratamiento de una denegación de EXECUTE a roles de `hint_roles` podía cerrar el backend antes de ejecutar el cuerpo de la función. El upstream lo corrigió en supautils3.2.3 y en imágenes Postgres17.6.1.155 o posteriores.

El coordinador aplicó únicamente en DEV `supautils.hint_roles=''` con recarga de configuración, sin reinicio ni cambios de owners, ACL, proconfig o funciones. Después, las llamadas SQL postcommit como anon y authenticated devolvieron42501 sin cerrar la conexión. La autorización pública HTTP permaneció restringida. Recibos filtrados: `verification/supautils-local-mitigation.json` y `verification/player-workspace-negative-postcommit.json` bajo `D:/CTP/dev/ctp`. Esto valida esta incidencia local; no representa una ejecución de jugador ni una modificación de PRE/PROD.

La suite SQL completa pasó después de conceder EXECUTE únicamente a su helper de sesión `pg_temp.workspace_reject`, manteniéndolo SECURITY INVOKER. El default ACL restringido impedía ejecutar ese helper de pruebas; el permiso de USAGE del esquema temporal ya existía. No se modificó ninguna ACL de aplicación. Recibo final: `verification/player-workspace-243-full-sql.json` bajo `D:/CTP/dev/ctp`.

`infra/dev/database_safety.py` conserva esa mitigación al preparar/arrancar este DEV: verifica proyecto, contenedor, imagen y estado esperado, y sólo puede cambiar este parámetro. Las ACL privadas de243 se conservan.
