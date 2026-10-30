# Tickets: bandeja y conversación

La bandeja presenta asuntos legibles y una referencia corta, con filtros visibles de responsable, estado y urgencia. El detalle pone la solicitud inicial y la conversación en primer plano; gestión, jugador y enlaces tienen su propio espacio. Las notas internas y las propuestas de resolución quedan separadas de las respuestas al jugador.

## Contratos conservados

- Asignación oficial de CTP reconocida aunque el árbitro no tenga usuario local del Manager.
- `awaiting_staff` se muestra como respuesta pendiente, sin afirmar que el mensaje no se haya leído.
- Cambiar la selección de estado no envía nada: requiere pulsar «Aplicar estado». Responder no cambia el estado.
- El estado directo del ticket y la propuesta de resolución pendiente de envío siguen siendo operaciones distintas.
- Se conservan capacidades del servidor, identidad oficial, nonces de reintento y aislamiento entre casos. Un fallo de lectura no pide repetir un mensaje ya confirmado.
- Los enlaces de prueba admiten el contrato HTTP(S) existente y se abren explícitamente, sin incrustar ni descargar contenido. No se infiere un partido a partir del texto de un enlace.
- El partido vinculado oficialmente conserva su navegación. No se cambian APIs, permisos, migraciones ni reglas competitivas.

## Primera validación local con transporte sintético

`npm test`: 477 pruebas, 472 correctas, 5 omitidas, 0 fallos. `npm run build`: correcto.

QA en Chromium a 1440×1000 y 390×844 con componentes reales del Manager, servidor local y SQLite propios. La bandeja y sus filtros usan ese backend local. Las lecturas y acciones del hilo se interceptan con transporte sintético y errores controlados; no representan aceptación de un jugador real ni conectividad con CTP.

Se verificaron filtros y búsqueda, asignación oficial, referencia completa, ausencia de desbordamiento horizontal, selección de estado sin POST, cierre fallido sin cambio optimista ni pérdida de borrador, reintento con el mismo nonce, recuperación de respuesta perdida sin duplicar mensaje, errores de lectura con reintento GET y protección frente a GET/POST tardíos al cambiar de ticket. No hubo excepciones JavaScript sin capturar ni peticiones externas durante estos recorridos.

No se accedió a bases de PRE/PROD ni se enviaron avisos a jugadores. Esta revisión no incluye despliegue, publicación remota ni prueba de los endpoints reales de CTP. La validación de un candidato integrado en PRE requiere el flujo autorizado del proyecto.

## Flujo posterior con servicios DEV reales, 29 de octubre

La revisión posterior utiliza Supabase/PostgreSQL 17, Auth, CTP y Manager locales propios del proyecto `ctp-dev-tickets-20261029`, sin bases, sesiones ni secretos de backend de PRE/PROD. Las cuentas y la consulta son datos de prueba; las peticiones de navegador, RPC, permisos, persistencia y entrega a proveedores son reales. No se modificó ningún resultado competitivo.

Se completó el acceso del jugador, creación de consulta con prueba mediante un enlace HTTPS genérico, asignación a un árbitro, aplicación explícita del estado, respuesta del staff, respuesta del jugador, propuesta de resolución del árbitro y envío por un administrador. CTP confirmó la resolución; el jugador vio el estado resuelto, su conversación y los avisos de la campana, y volvió al mismo caso desde uno de ellos.

Esta prueba detectó y corrigió un conflicto real: las lecturas idénticas incrementaban la revisión local y se descartaba `manager_version` de CTP. Ahora una lectura idéntica conserva la revisión CAS, la propuesta mantiene la revisión oficial y una respuesta oficial más reciente prevalece sobre una propuesta pendiente. Se conservan los conflictos ante cambios reales y las restricciones de envío por rol. Las lecturas repetidas mantuvieron CAS 98 y versión oficial 4; la resolución confirmada pasó la versión oficial a 5.

Dos comprobaciones de seguridad, antes y después del cierre, pasaron 14 controles cada una: anónimo y jugador sin acceso al Manager, otro jugador sin lectura/escritura del caso mediante RPC ni tablas heredadas, árbitro sin permiso para enviar la propuesta y ausencia de cambios por las pruebas denegadas. El administrador remitió la propuesta conservando como autor al árbitro.

Los dos eventos de este caso (`ticket.opened` y `ticket.awaiting_staff`) terminaron entregados a Discord y Telegram: cuatro entregas confirmadas y cero ambiguas. Discord necesitó un intento por entrega. Telegram necesitó dos: el primer intento fue rechazado explícitamente y, tras revisar la adaptación del enlace local del botón, se recuperaron únicamente esas dos entregas fallidas, con los mismos IDs e intentos conservados. No se repitieron los mensajes de Discord. El pump se detuvo después de los cuatro ACK; la infraestructura DEV se conserva para la aceptación coordinada.

Los receptores compartidos fueron los autorizados por el usuario: canal privado de avisos del staff de Discord y grupo privado de Telegram de PRE. Esto acredita entrega desde DEV a esos receptores; no acredita un despliegue ni ejecución del worker en PRE/PROD. El formato corporativo del bot es un cambio posterior de CTP y tiene su propia validación.

Comprobaciones del candidato Manager: 502 pruebas, 497 correctas, 5 omitidas y 0 fallos; build, auditoría de dependencias y las tres comprobaciones de métricas/collector/release correctas. CTP usado en el recorrido: `d6c016587be0af8a0cec9491e7d154219d75ecb3`, 1.257 pruebas correctas, localización y build correctos. Candidato funcional Manager: `e14021cce39d682373ddbd84ef76d94e82091565`.

Evidencia local separada en `D:\CTP\output\tickets-real-dev-20261029`: recibos `verification-open-20261029T133846130072Z.json`, `verification-closed-20261029T134333857807Z.json`, logs de navegador y recibo posterior de los cuatro ACK de proveedores. El snapshot del cierre precede a la activación del pump y conserva su outbox pendiente original; no se ha reescrito como si la entrega ya hubiese ocurrido entonces.

No se ha integrado esta rama en PRE ni se ha desplegado desde ella. La aceptación del candidato en PRE queda separada de la promoción anterior PRE→main del Manager.
