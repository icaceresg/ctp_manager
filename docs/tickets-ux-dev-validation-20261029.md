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

## Validación local

`npm test`: 477 pruebas, 472 correctas, 5 omitidas, 0 fallos. `npm run build`: correcto.

QA en Chromium a 1440×1000 y 390×844 con componentes reales del Manager, servidor local y SQLite propios. La bandeja y sus filtros usan ese backend local. Las lecturas y acciones del hilo se interceptan con transporte sintético y errores controlados; no representan aceptación de un jugador real ni conectividad con CTP.

Se verificaron filtros y búsqueda, asignación oficial, referencia completa, ausencia de desbordamiento horizontal, selección de estado sin POST, cierre fallido sin cambio optimista ni pérdida de borrador, reintento con el mismo nonce, recuperación de respuesta perdida sin duplicar mensaje, errores de lectura con reintento GET y protección frente a GET/POST tardíos al cambiar de ticket. No hubo excepciones JavaScript sin capturar ni peticiones externas durante estos recorridos.

No se accedió a bases de PRE/PROD ni se enviaron avisos a jugadores. Esta revisión no incluye despliegue, publicación remota ni prueba de los endpoints reales de CTP. La validación de un candidato integrado en PRE requiere el flujo autorizado del proyecto.
