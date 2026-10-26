# Candidato DEV de operaciones

Rama compartida de trabajo: `dev/ctp-manager-operations-20261026`, en Manager y ConnectToPlay. Desarrollo y comprobaciones locales; sin publicación en PRE ni PROD.

## Abrir y arrancar

- Manager: http://localhost:58090
- CTP: http://localhost:58080
- Arranque: `D:\CTP\dev\ctp-dev.ps1 start`.
- Estado: `D:\CTP\dev\ctp-dev.ps1 status`.

Las cuentas y claves son exclusivamente del proyecto local `ctp-dev-20261026`. Las credenciales de prueba están en el archivo privado `D:\CTP\dev\ctp\accounts.private.json`; no se incluyen en Git ni en las capturas. El arranque conserva la base propia y verifica su identidad, migraciones y permisos. No restaura datos de PRE/PROD.

## Flujos principales

**Inicio** reúne pendientes y un resumen Ranked con fecha de lectura. **Ranked** separa directo, revisión y estadísticas, conserva filtros al abrir una ficha y muestra personas buscando con su espera original. La lista se ordena por mayor espera y destaca las esperas de tres minutos o más. La consulta no renueva presencia ni forma partidas.

**Jugadores** reúne identidad, Activision ID, actividad actual, valoración e historiales paginados de partidas, incidencias y sanciones. Los árbitros acceden a la ficha; la edición administrativa mantiene su permiso propio. El acceso a revisiones PC conserva el filtro del jugador. Véase [PLAYER_WORKSPACE.md](PLAYER_WORKSPACE.md).

**Incidencias** conserva la asignación oficial al responder, distingue notas internas y acciones CTP, valida los ACK y conserva la referencia de un reintento incierto. Desde una disputa Ranked se abre la ficha completa de su partida. Las pruebas adjuntas se abren como enlaces seguros, sin incrustar contenido remoto.

El buscador general consulta sólo fuentes autorizadas, cancela búsquedas anteriores y distingue error, ausencia de resultados y falta de permisos. Los enlaces a jugadores y partidas usan IDs canónicos. Las demás herramientas permanecen disponibles en el menú desplegable.

## Matchmaking y alcance de las pruebas

El motor se conserva en el repositorio CTP, en `infra/vps/ranked-adaptive`. Su evidencia agregada procede de una consulta `READ ONLY` de Ranked; sus pruebas representativas son sintéticas, no una reproducción de colas históricas.

Con ocho jugadores factibles forma sin esperar a mejorar MMR. Desde dieciséis candidatos compara alternativas conservando grupos completos y la unidad viable más antigua. Una espera de 180 segundos fuerza el roster FIFO completo. El reloj usa la entrada original y no se reinicia por un cambio de modo. No impone exclusiones por XP o división.

No hay promesa de tiempo máximo cuando faltan personas o los grupos no permiten dos equipos de cuatro. Tampoco se interpreta actividad reciente como personas conectadas al juego. La migración245 instala el runtime desactivado por defecto. Se ha habilitado únicamente en la base DEV propia para esta prueba; PRE/PROD no se han modificado. En CTP, `python -B infra/dev/matchmaking.py status|enable|disable` comprueba el marcador local y la huella aplicada antes de operar.

El selector de245 no aplica restricciones de XP/división. La admisión local heredada de183 permanece aparte y no se presenta como réplica de la modificación externa228 de producción. Los detalles y comandos reproducibles están en `infra/vps/ranked-adaptive/RUNTIME.md` del repositorio CTP.

## Evidencia local

La comprobación HTTP real de `D:\CTP\dev\ctp\verification\manager-operations-http.json` verifica búsquedas/fichas con admin y árbitro locales, privacidad, errores 400/404, límites de permisos, listas PC y cierre de sesiones. No crea casos, escanea equipos, envía mensajes ni cambia resultados.

Las pruebas de tickets usan SQLite temporal y un interlocutor CTP sintético. Las pruebas SSR comprueban el JSX real, incluyendo la composición de la ruta PC. Las capturas de navegador corresponden a las cuentas propias de DEV. Ninguna de estas pruebas acredita una partida real en Call of Duty ni un PC check físico.

Antes de promover: revisar la rama PRE actual de ambos repositorios, integrar cambios ajenos, ejecutar los checks requeridos y validar el candidato terminado en PRE. La publicación de PROD requiere una orden expresa nueva.
