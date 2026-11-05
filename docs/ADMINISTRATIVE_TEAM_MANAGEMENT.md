# Retirada de la multigestión

Decisión del 5 de noviembre de 2026: una cuenta gestiona su único club mediante
la pertenencia habitual al equipo. Para gestionar otro club se utiliza otra
cuenta. La función de responsables administrativos independientes queda retirada.

El Manager conserva la creación normal con un líder registrado y los controles
del servidor para impedir que esa cuenta pertenezca a otro equipo. Ya no ofrece
conversión, asignación de responsables, directorio de varios clubes ni creación
sin líder competitivo. Las rutas específicas de responsables no existen.

Las propuestas administrativas antiguas siguen en el historial local; no pueden
reenviarse a CTP y, cuando su estado permite descartarlas, conservan esa acción.
La retirada no borra jugadores, pases, inscripciones, auditoría ni recibos.
Los permisos de staff para arbitraje y administración general son independientes
de la pertenencia a un equipo y se conservan.

El contenido siguiente documenta el diseño histórico retirado, no una capacidad
disponible para una nueva publicación.

# Responsables administrativos de varios equipos

El responsable administrativo puede gestionar Principal, Academy y Femenino sin ocupar plaza competitiva. Cada equipo conserva sus integrantes, capitán, historial, puntos, pases e inscripciones. Esta asignación no concede acceso global al Manager ni al staff de CTP.

## Operación de staff

En **Administración → Clubes**, administración CTP puede abrir **Responsables** de un club, buscar una cuenta confirmada y activa, asignarla o retirarle acceso indicando un motivo. El panel **Responsables de varios equipos** reúne sus equipos y muestra por separado pases, torneos y tamaño de alineación. Los enlaces a pases filtran por equipo.

El alta manual distingue un **responsable administrativo (no juega)** de un **capitán jugador**. La primera opción envía `leader_id: null` y `administrator_id`; la segunda mantiene el contrato antiguo de `leader_id`. Sólo se admite una función por alta. Un mismo responsable puede crear varios equipos; el control de duplicados del capitán jugador se conserva.

Un equipo sin capitán no puede perder su último responsable administrativo. Antes de retirar ese acceso hay que asignar un sustituto; CTP rechaza el cambio y conserva la versión si el club quedaría sin responsable.

Un líder antiguo que sólo vaya a administrar necesita una **conversión explícita**. El diálogo pide motivo y confirmación de que dejará de ser jugador. Si hay otros integrantes, exige elegir entre ellos al capitán sustituto. CTP comprueba que no exista participación competitiva activa incompatible. Si es el único integrante, el equipo puede quedar sin jugadores y conserva al responsable administrativo. No hay migraciones automáticas de jugadores.

## Contrato privado

Las rutas de Manager exigen autenticación y administración CTP. El servidor vuelve a comprobar el rol y, para escrituras, `CTP_ENABLE_WRITES`. Las peticiones se firman mediante el transporte HMAC existente hacia `admin_service`, servicio `team_administrators`.

| Ruta | Acción |
| --- | --- |
| `GET /api/administration/clubs/:id/managers` | `get` |
| `POST /api/administration/clubs/:id/managers` | `set` |
| `POST /api/administration/clubs/:id/managers/convert` | `convert` |
| `GET /api/administration/team-administrators/candidates?query=…` | `candidates` |
| `GET /api/administration/team-administrators/:id` | `overview` |

La versión inicial es **0**. `set` y `convert` incluyen versión esperada, UUID de solicitud y motivo de 12–500 caracteres. CTP aplica el cambio con control de concurrencia, recibo idempotente y auditoría. Si el resultado es incierto, la interfaz bloquea nuevas acciones y permite reintentar la misma solicitud con su UUID original. Un conflicto exige una lectura nueva. Tras un éxito, la vista vuelve a consultar CTP.

Los DTO sólo proyectan campos acotados de equipos, nombres de usuario, funciones y estados. No transportan correos, tokens, recibos de pago ni permisos de staff. La vista es privada, no se añade a exportaciones CSV ni consultas públicas.

## Validación

- Pruebas de contrato y rutas HTTP con transporte sintético: tres asignaciones independientes, versión 0, reintento con recibo, revocación, conflicto, conversión y permisos de administrador/árbitro/anónimo.
- Pruebas de cola local: tres clubes distintos para la misma persona, reintento deduplicado y restricción anterior del capitán conservada.
- Navegador con componentes reales y respuestas sintéticas: alta no jugadora, tres equipos, fallo incierto/reintento con el mismo UUID, sustituto de capitán, conflicto/relectura/revocación y perfil árbitro sin controles. Vista móvil de 390 px sin desbordamiento horizontal.
- Textos y accesibilidad nueva en español, inglés, francés, alemán, italiano y portugués.

Los fixtures de navegador y transporte no prueban un flujo real de jugador ni una publicación. La aceptación con la base DEV compartida y la comprobación de PRE se documentan en los recibos de integración de la candidata. Esta funcionalidad necesita el backend SQL362 y su servicio CTP antes de publicar Manager.
