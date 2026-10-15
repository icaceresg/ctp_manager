# Estadísticas para casters · análisis de encaje

> Revisión histórica previa a la implementación. El estado posterior y el alcance entregado se describen en [OPERATIONS_IMPLEMENTATION.md](OPERATIONS_IMPLEMENTATION.md).

Estado: revisión de código del 29-09-2026 en la rama local `feat/caster-match-stats`. No se ha conectado este Manager a CTP ni se han añadido pantallas o tablas de estadísticas.

## Qué existe en CTP Manager

- Intranet React/Vite + Express + SQLite local. Escucha únicamente en `localhost`; no tiene acceso desde otros puestos ni desde móvil y sus cuentas son independientes de las de la web competitiva.
- `CASTER` tiene acceso por defecto a **Escaleta** y **Disponibilidad**. El administrador puede editar ese permiso. Hay guiones con bloques, fecha y hora, vista imprimible, y disponibilidad por días de evento.
- Las escaletas son documentos libres: ninguna guarda `match_id`, torneo, equipos, roster o enlace a una partida. El calendario de disponibilidad usa días precargados y editables, sin sincronización con el circuito real.
- No hay tablas, endpoints, rutas, componentes ni cliente HTTP para partidos, mapas o estadísticas; `server/routes/api.js` solo expone contenido, recursos, escaletas y disponibilidad.

## Qué existe en la web competitiva CTP

- La migración `048_match_statistics.sql` define una estadística por **mapa de partido de torneo** y revisión: `score`, `kills`, `deaths`, `assists`, `objective` por jugador, además de nombre de mapa, modo y estado `pending/approved/rejected/superseded`.
- El jugador carga una captura en la web, ejecuta OCR local, corrige las filas y asigna cada una al roster inscrito. La imagen y el OCR bruto no se guardan. Un rival o staff revisa el envío; el resumen público `get_match_statistics_summary(match_id)` incluye solo mapas **approved**. Los campos desconocidos siguen siendo `null`.
- El snapshot de realización ya reúne partida, ambos lados, roster y estadísticas aprobadas para una **sala de emisión concreta**. La lista general de partidas de realización exige una cuenta staff de CTP. Las capacidades de OBS duran hasta 24 horas, se pueden revocar y no son una API general para la intranet.
- Este flujo no cubre por sí mismo retos ni Ranked 8s: la tabla referencia `tournament_matches`. Tampoco hay datos automáticos de observer; el OCR es un paso iniciado y revisado por una persona.

## Encaje recomendado

CTP debe seguir siendo la fuente de verdad de partidos y estadísticas. El Manager tendría una sección **Partidos · Caster** de lectura con agenda, fichas de encuentro, mapas aprobados, roster, comparativa y un estado visible de «pendiente de validación» cuando aún no haya datos fiables. La escaleta podría enlazarse por UUID al partido; las notas editoriales del caster quedarían en el Manager, separadas de cifras oficiales.

No copiar la base Supabase ni introducir su `service_role` en el navegador o en una instalación de escritorio distribuida. Para una integración real, CTP debe exponer un contrato de lectura mínimo con partidos autorizados y estadísticas aprobadas, o un backend de integración que valide una credencial de servicio limitada. El servidor del Manager consultaría ese contrato y entregaría al navegador solo los campos permitidos, con caché breve, hora de actualización y aviso de datos obsoletos. El rol local `CASTER` no debe usarse como prueba de identidad o privilegio en Supabase.

### Primer bloque implementable

1. Definir en CTP un DTO estable de agenda y ficha: IDs de partido/torneo, fase/ronda, hora, equipos, roster inscrito, BO, resultado confirmado, mapas aprobados y revisión/fecha de cada dato. Decidir si una partida futura sin estadísticas se muestra y qué datos pueden ser públicos.
2. Añadir al Manager la sección `partidos` con permiso configurable para `CASTER`, rutas protegidas y un proxy de solo lectura en Express. No habilitar escritura competitiva desde esta intranet.
3. Enlazar `rundowns` con `tournament_match_id` opcional y validar que ese UUID exista en el feed. Mantener las escaletas actuales intactas; añadir el vínculo sin migrar texto libre automáticamente.
4. Diseñar dos vistas: **previa** (agenda, roster, forma basada solo en estadísticas aprobadas) y **en directo** (marcador y mapas con sello de frescura). Una captura todavía pendiente nunca debe presentarse como estadística oficial.
5. Probar permisos, partido inexistente/cancelado, cambios de hora, revisiones rechazadas, `null`, equipos sin roster, conexión caída y desfase de caché; comparar cada dato con la ficha original en CTP.

## Decisiones antes de construir

- Alcance: solo torneos al principio, o también retos y Ranked 8s. Para estos últimos haría falta primero crear en CTP una captura y revisión de estadísticas propia, con su modelo de partida.
- Despliegue: el Manager hoy solo sirve `localhost`. Para casters en distintos equipos hay que decidir si se publica en VPS con HTTPS y endurecimiento de sesión/origen, o si solo se usa en un PC de producción con acceso local controlado.
- Datos para la previa: ¿solo cifras del partido, o histórico por jugador/equipo, tendencias por modo/mapa y enfrentamientos? El RPC actual resume **un partido**; el histórico requiere una nueva consulta agregada y reglas claras sobre tamaño de muestra.
- Tiempo real: definir la latencia aceptable. La sincronización periódica sirve para estadísticas aprobadas; un marcador en vivo y cambios de realización necesitan otra fuente y una indicación clara de qué es oficial.

## Verificación de esta revisión

`npm test`: 33/33 pruebas. `npm run build`: correcto. La rama sigue sin cambios funcionales; este documento describe el estado inspeccionado, no una integración ya activa. No se han ejecutado consultas ni migraciones contra la base remota de CTP.
