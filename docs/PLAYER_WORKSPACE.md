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

`createPlayerWorkspaceReader({request,actorFor})` devuelve `readPlayerWorkspace(currentUser,query)`. Reutiliza el transporte y la identidad del operador existentes. `playerWorkspaceQuery`, `playerWorkspaceId` y `playerWorkspaceResponse` son las validaciones compartidas en el servidor; `parsePlayerWorkspace` valida la acción en el Edge. La vista no guarda una segunda copia de CTP en SQLite.

## Comprobación local

- 8 pruebas focales Manager: límites, identidad, privacidad, permiso, historiales no disponibles, DTO inválido y transporte exacto. Build Manager correcto.
- 8 pruebas CTP: parser, restricciones del lector, handler firmado, DTO, semántica de errores y bloqueo de firmas, navegador y replay con base de datos falsa.
- 11 pruebas del launcher DEV, incluida clave PC-check opcional de 43 caracteres, independiente y de tipo string; se conserva la configuración legacy sin esa clave.
- Regresión SQL positiva con fixtures dedicados y rollback: búsquedas paginadas, UUID, cuentas eliminadas, presencia vigente/caducada sin renovarla, resultados antiguos y páginas independientes de resultados/tickets/sanciones. Ningún fixture persiste.
- 243 aplicada sólo al DEV aislado mediante el bootstrap con verificación de identidad. 244 permanece pendiente.
- Búsqueda y ficha ejecutadas como `service_role` dentro de `BEGIN READ ONLY` para admin y árbitro DEV. Diez cuentas existentes conservadas, sin correos en los DTO y ACL declarativas correctas.

El recibo filtrado está en `D:/CTP/dev/ctp/verification/player-workspace-243.json`.

Los errores del lector tienen mapeo privado propio en el Edge: cuenta ausente404, consulta inválida400, falta de autorización403 y error desconocido503. Sólo los dos identificadores exactos de243 con SQLSTATE22023 reciben404/400. Los mensajes, detalles y pistas de SQL nunca se copian a la respuesta. El resto de acciones mantiene su semántica anterior.

Límite de la prueba: durante la preparación, ejecutar una llamada anónima denegada contra la función todavía sin confirmar produjo cierre del backend local y registros de señal11/recuperación. La causa no está establecida. No se repitió esa ejecución tras aplicar243; la denegación anon/auth se comprobó mediante ACL. No se debe concatenar la definición sin confirmar con las pruebas negativas en este DEV. La suite SQL completa conserva esos casos para un entorno de prueba adecuado; sólo su parte positiva se ejecutó en esta sesión.
