# Manager: cercado de privacidad y recuperación de moderación

Validación del 27 de octubre de 2026, sólo DEV local aislado. Base `28af3ff`, rama `codex/ctp-mobile-google-20261027`. Ningún despliegue, consulta PRE, cambio SQL de CTP ni cuenta real forma parte de esta evidencia.

## Cambios

- La inspección adquiere el bloqueo de escritura SQLite antes de comprobar esquema, límites, custodia PC Check o datos. El marcador permanente y la retirada de datos se confirman juntos.
- La ingestión examina el objeto original antes de normalizar y vuelve a cercar la proyección final dentro de la transacción. Detecta UUID también en texto y claves. Para cuentas marcadas sólo admite histórico clasificado y saneado; rechaza evidencia nueva o campos sin clasificar sin almacenar una copia. Los adaptadores de competición, administración y expedientes cubiertos por este bloque también cercan su resultado HTTP/memoria. La evidencia ya custodiada se conserva y bloquea un recibo `clear`.
- El espejo Auth y las credenciales de la sesión comparten transacción y marcador. PC Check comprueba el marcador bajo bloqueo al crear, emitir asignación o guardar evidencia; una asignación marcada tampoco autentica otra recogida.
- Lecturas y acciones de moderación/privacidad pertenecen al actor y recurso actuales. Un fallo, 401/403/404, reporte ausente, cambio de actor o desmontaje retira los datos y desautoriza callbacks anteriores. La lista también gobierna el montaje de su detalle y editor: si recarga o falla, se desmonta todo el subárbol. Se invalida la publicación de las respuestas HTTP anteriores; no se promete cancelar físicamente una petición ya enviada. Un resultado incierto obliga a leer antes de volver a actuar.
- El reintento conserva nonce, motivo y versiones originales mientras la lectura confirma la misma intención. La retirada sólo aparece con los tres booleanos válidos de `eligibility` y `can_remove=true`; nunca se deduce comparando campos omitidos. Un avatar cambiado muestra la explicación y conserva la corrección del perfil. Un sujeto desaparecido conserva su denuncia sin editor ni retirada.

## Pruebas

La batería completa de Manager pasa: **514 pruebas; 508 PASS, 0 FAIL, 6 omitidas explícitamente** (cinco pruebas POSIX del script de despliegue en Windows y una interoperabilidad .NET sin configurar). Se ejecutó también el build web. El resultado y los hashes de las fuentes se guardan en [el recibo](manager-google-safety-receipt-20261027.json), con copia y logs en `validation.local/`.

Pruebas nuevas relevantes:

- SQLite real local: poll retenido entregado entre `clear` local y ACK externo pendiente, y después del ACK; no reaparecen nombres ni evidencia, se conservan UUID y resultados competitivos.
- Dos conexiones SQLite reales: el escritor de PC Check recibe `SQLITE_BUSY` durante el recuento bajo inspección; después del commit el marcador deniega su creación. Un expediente confirmado antes de inspeccionar exige conservación y conserva sus bytes.
- UUID sólo en motivo/título/claves, campos personales desconocidos antes de normalizar, rollback íntegro del lote, resultado HTTP saneado y evidencia previa intacta.
- Respuesta Auth retenida durante una inspección local: no crea perfil ni credenciales tras el marcador.
- Estado UI: 401/403/404/500 y reporte nulo; lectura o mutación antigua; desmontaje; nonce y CAS invariantes; sujeto desaparecido junto a otras denuncias.
- Composición real renderizada: lista que pierde 401/403/404 o recarga, con detalle/avatar conservando intencionadamente snapshots válidos en la fixture. El padre no monta ni muestra esos detalles. La misma comprobación cubre privacidad.

Playwright comprobó el componente real compilado en Chromium local con respuestas sintéticas, sin backend ni DB: dos intentos produjeron cuerpos idénticos; un fallo dejó únicamente la consulta de estado; al cambiar el avatar desapareció la retirada y quedó disponible la corrección del perfil; un 403 retiró nombre, biografía, motivo y acciones. Las capturas están en `output/playwright/manager-safety-uncertain.png`, `manager-safety-changed-avatar.png` y `manager-safety-permission-revoked.png`. El único error de consola del harness válido fue el favicon local ausente. El harness y la sesión de navegador se cerraron al finalizar.

También se abrió la página completa de moderación con detalle y avatar ya cargados. Se retuvo físicamente la respuesta de retirada, se refrescó la lista con 403 y se liberó después la respuesta tardía: no reaparecieron el detalle, avatar, perfil ni evidencia; no hubo un tercer GET de lista por callbacks tardíos (dos GET totales: carga y refresco). Captura: `output/playwright/manager-safety-composition-list403.png`.

## Límites

El ACK remoto y las respuestas del navegador son fixtures; no prueban eliminación real en CTP, envío de correo, consentimiento legal ni aceptación por Google. La batería conserva sus seis omisiones existentes; no se han contado como PASS. Un snapshot con evidencia tardía de un sujeto marcado se rechaza como lote completo y mantiene la última proyección válida: no se avanza ocultando ese fallo. PRE/PROD y las migraciones compartidas permanecen fuera de este bloque.

El complemento posterior sobre `77769b2` cierra específicamente las respuestas tardías de perfil y ficha de jugadores, incluida la edición de perfil. Su prueba HTTP, batería completa e inventario de adaptadores están en [esta validación](manager-profile-erasure-qa-20261027.md). No se afirma que todos los endpoints de Manager tengan una barrera HTTP global.
