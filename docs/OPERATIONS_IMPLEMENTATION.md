# Centro operativo CTP · entrega local

Rama de desarrollo Manager: `codex/manager-development`. El trabajo operativo previo se conserva; esta revisión del 2 de octubre de 2026 delimita Manager frente al Panel de emisión externo. Los cambios de este bloque afectan solo a Manager y no implican despliegue, publicación o activación de otros servicios.

## Propiedad funcional y alcance real

Manager es el backoffice de staff, competición y arbitraje. La web general atiende a jugadores y clubes. Ambas interfaces deben utilizar el mismo backend CTP para datos y reglas oficiales; iniciar una decisión desde Manager no crea otra autoridad ni otra base competitiva.

| Función | Interfaz responsable | Estado y límite actuales |
| --- | --- | --- |
| Participación, equipos, calendario/resultados públicos, subida de evidencias, apertura de disputas y notificaciones | Web CTP general | Continúan en la web de participantes. Este trabajo de Manager no modifica esa web. |
| Gestión de torneos, inscripciones, formatos y calendario competitivo | Manager | Implementado localmente: formularios de alta/edición, estados, revisión de inscripciones y roster, puntos y seed oficiales, generación/publicación de fases y reprogramación. Consulta y envía comandos al backend CTP compartido; necesita las capacidades de la nueva versión del puente. El calendario editorial no sustituye al calendario competitivo. |
| Incidencias, revisiones de estadísticas, resoluciones, verificación y disciplina | Manager | Ya existen pantallas y comandos del puente para las acciones descritas abajo. Su uso oficial exige conexión, capacidades anunciadas, operador vinculado, permisos y confirmación del backend; no equivale a gestión remota ya desplegada. |
| Disponibilidad, asignación de árbitros/casters/realizadores, turnos y confirmación del staff | Manager | Planificador semanal, candidatos disponibles, cobertura y filtros; sustitución/reprogramación con motivo, validación de disponibilidad y solapamientos, auditoría y nueva confirmación del asignado. |
| Contenido, recursos, escaletas, notas y preparación | Manager | Implementado; complementa el trabajo de competición y arbitraje, no define por sí solo el alcance del producto. |
| Tarjetas en emisión, cámaras, marcador visual y control OBS | CTP Panel | Herramienta externa descrita por el equipo, no verificada aquí. Su conexión de lectura con Manager sigue pendiente. |
| Datos competitivos, permisos y reglas oficiales | Backend CTP compartido | Una sola fuente para web y Manager. Cada escritura se valida en servidor; SQLite solo mantiene coordinación, comandos y proyecciones. |

Los siete bloques solicitados tienen implementación local en Manager. Su disponibilidad oficial depende de desplegar la versión correspondiente del backend compartido, vincular operadores y verificar las capacidades reales del entorno. La migración del acceso de staff en CTP se valida con el backend: una pantalla de Manager no sustituye permisos ni reglas remotas.

## Áreas operativas

| Área | Comportamiento implementado |
| --- | --- |
| Incidencias | Expedientes vinculados al partido, responsable, prioridad, seguimiento y bandeja con búsqueda, filtros de responsabilidad y urgencia. Notas internas, respuestas al hilo CTP y resolución oficial mediante operador autorizado; decisiones y su entrega junto al expediente. |
| Jornada | Inicio por rol con trabajo propio, incidencias, turnos pendientes y cobertura. Agenda de torneos, retos y ranked con procedencia y última sincronización. |
| Turnos | Semana de trabajo, candidatos por permiso/disponibilidad/solapamientos, sustitución y cambio horario motivados. Cada modificación requiere otra confirmación del asignado. Disponibilidad por fecha civil de Madrid. |
| Torneos | Alta/edición, estado, inscripciones y roster, puntos y seed de temporada de solo lectura, cruces generados por el motor oficial, publicación de fase y reprogramación. Las propuestas no se aplican sin ACK CTP; no se permite inventar seed manual desde Manager. |
| Dossier | Roster inscrito, mapas, estadísticas aprobadas, notas editoriales y comparación K/D con tamaño de muestra visible. Los valores desconocidos permanecen como «—». No configura los casters o cámaras que aparecen en pantalla. |
| Preparación | Partido y escaleta vinculados, notas, personal asignado y estado organizativo manual: «En preparación», «Preparado», «En seguimiento», «Seguimiento en pausa» o «Cerrado». No cambia escenas, consulta OBS ni emite estado de overlay. |
| Estadísticas | Bandeja pendiente y consulta de revisiones por partido, incluida apertura desde Histórico. Aprobación/rechazo y corrección motivada de ocho jugadores inscritos, con validación numérica e historial. CTP crea una revisión nueva pendiente y exige un revisor distinto. El original conserva sus cifras; no se sustituyen antes de recibir la nueva revisión oficial. No vuelve a guardar capturas ni cambia el OCR. |
| Clubes | Verificación manual CTP con motivo y estado Team Pass independiente. El pago no verifica y la verificación no concede el pase. |
| Discord | Seguimiento de tareas, errores y reintentos del worker existente. Reprogramar una entrega no equivale a declarar el mensaje entregado. Los retos se siguen aceptando desde CTP. |
| Disciplina | Borradores, alcance y vigencia explícitos, aplicación oficial, recursos y revisión independiente. Las restricciones temporales se comprueban en CTP al iniciar nuevas participaciones; no se expulsan partidos ya iniciados. El afectado puede consultar y recurrir en su perfil CTP. |
| Contenido | Un resultado confirmado prepara una sola tarjeta editorial con checklist de recursos. Se abre el editor existente; no hay publicación automática en redes. |
| Decisiones | Bandeja por permiso con propuesta, autor, versión, motivo, estado, errores y trazabilidad. Administración conserva el envío oficial; el autor autorizado puede descartar únicamente solicitudes seguras. Se muestra junto al expediente, torneo o revisión que la origina. |
| Histórico | Consulta remota con búsqueda, tipo, fechas y paginación por cursor. Muestra el detalle recibido sin depender de que exista una proyección en la jornada; enlaza a la web CTP y a las revisiones de estadísticas del partido. |

## Contratos de los bloques nuevos

- `GET /api/operations/competition?resource=tournaments` lista torneos y juegos; `resource=tournament&target_id=UUID` obtiene torneo, inscripciones y cruces. `resource=statistics&target_id=UUID` consulta revisiones del partido y roster autorizado. El navegador nunca consulta directamente Supabase.
- `GET /api/operations/history` admite `query`, `kind`, `date_from`, `date_to`, `cursor` y `limit`. El servidor revalida permisos y limita las páginas. Un error conserva la consulta visible con advertencia; 401/403 retira los datos.
- `POST /api/operations/competition/commands` prepara `tournament.create`, `tournament.update`, `tournament.status`, `tournament.registration`, `tournament.generate`, `tournament.publish` o `tournament.schedule`. Las versiones son las del backend compartido; crear usa cero y un UUID nuevo. Las acciones no anunciadas por CTP se rechazan.
- `POST /api/operations/stats/:id/correct` prepara `stats.correct`: ocho UUID distintos, motivo de 12–500 caracteres, enteros no negativos y límites acordados con CTP. Las estadísticas antiguas permanecen intactas; el ACK debe identificar `revision_id`. Si falla la sincronización posterior se informa de que CTP confirmó la decisión pero falta leer la nueva revisión.
- Las revisiones de estadísticas pueden incluir `expected_source_version`, conservada al abrir el formulario. Se compara con la versión oficial proyectada para evitar que una consulta idéntica del histórico invalide una edición; CTP repite la comprobación al enviar. Las peticiones antiguas con `expected_version` local siguen siendo compatibles.
- `PATCH /api/operations/assignments/:id` acepta `expected_version`, `user_id`, `starts_at`, `ends_at` y `reason` para modificar un turno. Conserva partido y puesto, vuelve a `pending`, excluye el propio turno del cálculo de solapamiento y registra antes/después. Un turno cancelado o rechazado no se reabre.

## Autoridad y privacidad

- El backend CTP compartido conserva resultados, puntos, MMR, rosters, verificación y medidas oficiales, tanto si la acción se inicia en la web como en Manager. SQLite almacena coordinación, notas, comandos y proyecciones de lectura.
- Un usuario local no obtiene autoridad CTP por tener un rol de Manager. Cada operador tiene un UUID estable y debe vincularse explícitamente a una cuenta CTP con los ámbitos mínimos. Borrar y recrear un usuario no reutiliza su identidad remota.
- Casters no reciben expedientes privados ni estadísticas pendientes. Las notas de disponibilidad de otras personas solo son visibles para coordinación. Las conversaciones se consultan por caso, bajo autorización y con paginación.
- Cambios con versión obsoleta se rechazan; los formularios conservan la versión con la que se abrieron. Un fallo de red mantiene la última consulta y la marca como desactualizada. Un 401/403 elimina los datos de la vista.
- La cola conserva IDs idempotentes. Solo un ACK CTP coincidente confirma el cambio. Una petición ambigua no se descarta como si nunca hubiera llegado.
- Se pueden descartar decisiones todavía no enviadas; un rechazo definitivo de la primera petición puede corregirse sin duplicar efectos. Los timeouts requieren reintento/reconciliación con el mismo identificador.

## Límite con CTP Panel

El backend compartido mantiene el dato competitivo oficial; Manager reúne el trabajo de staff, competición y arbitraje; el Panel externo controla la emisión. Se conservan las rutas y permisos `casters` y `realizacion`, así como las tablas y datos existentes, aunque los títulos visibles sean **Dossier** y **Preparación**. Los códigos históricos `live` y `paused` se presentan ahora como «En seguimiento» y «Seguimiento en pausa»; no prueban el estado real de OBS. Desde el dossier se puede preparar el encuentro conservando su selección; guardar el vínculo con la escaleta no sobrescribe la escena histórica.

Según lo descrito por el equipo, `CTP_Panel_Casters.html` se utiliza como dock en OBS, publica estado `ctp-overlay` mediante OBS WebSocket y `BroadcastChannel` cada segundo y ofrece tarjetas Partido, InGame, Descanso y Casters, además de configuración de cámaras y OBS. La tarjeta InGame contempla BO1–7, marcador y mapa; su overlay sigue pendiente según esa descripción. El Panel admite lectura periódica de JSON cada 5–60 segundos y un mapeo personalizado, preservando la edición manual cuando no cambia el campo recibido. Estos datos describen la herramienta externa: su HTML no está en este workspace y no se ha validado aquí.

Manager no reproduce esos controles ni abre una segunda instancia: debe haber un solo Panel por emisión. Estado de emisión, cabeceras y credenciales del Panel permanecen en el PC de realización. El marcador manual mostrado en la emisión y el resultado competitivo oficial tienen ciclos distintos; editar uno no debe confirmar ni modificar el otro.

La adaptación futura propuesta es una lectura limitada desde servidor con los datos aprobados necesarios para el Panel. Antes de implementarla hay que revisar el HTML y acordar el JSON, mapeo de campos, identidad del partido, acceso y comportamiento ante datos ausentes o desactualizados. No hay todavía endpoint, URL de Panel, exportación automática ni contrato de campos implementado. No entregar al dock credenciales Supabase, `service_role` o el secreto del puente de operaciones, ni reutilizar el bootstrap privado con expedientes.

El backend y agente OBS anteriores permanecen como compatibilidad histórica, apagados y fuera del flujo actual. No activarlos junto al Panel ni interpretar su conservación como integración con él.

## Cómo abrirlo

```powershell
cd D:\CTP\ctp_manager
npm.cmd ci
npm.cmd run build
npm.cmd run serve
```

Abrir `http://localhost:3210`. En una instalación nueva aparece el alta del administrador. Los roles y cuentas existentes se conservan: conceder las secciones nuevas desde **Usuarios y roles**. Por ejemplo, Dossier requiere `casters`; Preparación, `realizacion` y acceso a las escaletas que se vayan a editar; personal que marque disponibilidad necesita `disponibilidad`.

En **Competición y staff → Conexión** se ve el estado de la integración y los UUID de operadores que el administrador CTP debe vincular. No se introducen secretos en el navegador.

## Activación pendiente

La inspección de PRE encontró el historial de migraciones **000–073**, pero la comprobación del esquema real confirmó los cambios de **074–078 ya presentes**. No se deben repetir esas migraciones ni lanzar `db push` basándose solo en el historial. La función `manager-operations`, los cambios nuevos 079–080 y los vínculos de operadores siguen pendientes de despliegue coordinado; no hay una conexión PRE acreditada. La instalación propuesta mantiene inicialmente la gestión de la web existente. El estado y las pruebas sobre una restauración exacta del esquema se detallan en [el paquete de PRE](PRE_RELEASE_2026-10-02.md).

La conexión QA local se documenta en [LOCAL_CTP_CONNECTION.md](LOCAL_CTP_CONNECTION.md). Para una instalación remota hay que verificar las migraciones y la Edge Function del entorno CTP elegido, configurar sus secretos, vincular operadores y comprobar el dominio HTTPS de la VPS. La numeración 069/070 corresponde a la referencia histórica del puente y disciplina; comprobar el historial del entorno antes de aplicar cambios. Las escrituras externas permanecen desactivadas por defecto.

No instalar ni activar el agente OBS anterior como parte de este flujo: la emisión pertenece al Panel externo. No se ha implementado un observer que lea automáticamente la partida en curso ni una conexión Manager–Panel. Las pruebas antiguas del agente no validan el Panel, sus fuentes o la emisión real.

El feed operativo tiene límites e historia cerrada de 30 días; las consultas posiblemente truncadas se señalan. Las comparativas se refieren a los mapas aprobados disponibles, no a una carrera completa. El OCR competitivo existente sigue cubriendo mapas de torneos; no se inventan estadísticas por mapa de retos o ranked.

## Documentación y comprobación

Verificación local de los siete bloques, 2 de octubre de 2026: suite completa Manager **111/111** correcta y build correcto, incluidas **36** pruebas de operaciones/dominio. El flujo HTTP firmado contra PostgreSQL local también pasó creación/edición con versión obsoleta, generación/publicación y reprogramación, corrección de ocho jugadores con aprobación independiente e histórico paginado (runner `scripts/test-signed-ctp-flow.mjs`). Son pruebas sobre bases temporales, no acreditan despliegue ni conexión PRE. Cubren permisos/capacidades, versiones obsoletas, propuestas sin aplicación anticipada, ocho jugadores y límites numéricos, conservación del original tras el ACK, consulta histórica repetida y reprogramación/sustitución con solapamientos.

Evidencia anterior del mismo día: **89/89 pruebas Manager** y build correctos. En navegador, con base temporal de QA, se comprobó persistir preparación, escaleta y notas; navegación conservando partido y vista de 390 px sin desbordamiento. Esta comprobación anterior no valida las pantallas nuevas de torneos o el backend remoto.

- [Contrato API local](OPERATIONS_API.md).
- [Instalación, VPS y seguridad del puente](DEPLOYMENT.md).
- [Referencia del agente OBS anterior, desactivado](OBS_AGENT.md).
- En el repositorio CTP: `docs/MANAGER_OPERATIONS_BRIDGE.md` y `docs/MANAGER_DISCIPLINE.md`.

`npm test` usa bases temporales y servidores HTTP/WebSocket locales. `npm run build` compila la interfaz. Los runners SQL de CTP usan una base de prueba explícita en el contenedor local aislado; no leen credenciales remotas.

Evidencia histórica del 29 de septiembre de 2026, anterior a la separación del Panel: **88/88 pruebas Manager** y **242/242 pruebas CTP** correctas (estas últimas incluyen 9 del protocolo HTTP del puente y 6 del panel de recursos). El runner SQL aplicó el esquema hasta 070 en su base desechable y pasó disciplina, puente 069 y siete suites de regresión del dominio. Builds de Manager/CTP y TypeScript de CTP correctos. Estos resultados no certifican los cambios posteriores ni el Panel externo.

La revisión de navegador con datos sintéticos cubrió login, expediente/notas, dossier de estadísticas aprobadas, resultado a tarjeta editorial, preparación de escena, propuesta disciplinaria limitada a retos y cola sin escrituras activadas. Vista móvil de 390 px sin desbordamiento horizontal. La revisión del perfil CTP comprobó privacidad al cerrar sesión, error de lectura y protección contra doble envío de recurso.

`node scripts/qa-operations-preview.mjs` arranca una instalación **de QA separada** en el puerto 3227, con datos sintéticos claramente rotulados y una base temporal nueva. No es el servidor normal, no se conecta a CTP y no modifica datos del equipo. Las capturas de navegador se guardan en `output/playwright/`, excluido de Git.
