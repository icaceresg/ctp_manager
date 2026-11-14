# Guard de torneos: candidato Manager para PRE

Base verificada: `origin/pre` `ee0adf2de996bf45bc14e12a05b57ae6f0bc6720`. Rama aislada `codex/cup1-guard-manager-pre-20261114`. No se integra la mesa Guard Ranked de DEV ni su transmisión de mando. No cambia autenticación, roles, claves, reglas del torneo, datos ni workflows.

## Qué cambia

- Sala de Guard dentro del resumen de cada partido de torneo, con preparación de los ocho titulares, siguiente paso por persona y hora local indicada explícitamente.
- Consulta únicamente el partido abierto cada diez segundos. Pausa y cancela al ocultar la pestaña; cancela también al cambiar de partido, usuario o salir. Tiempo límite de lectura: doce segundos. Una lectura atascada libera el ciclo y puede recuperarse.
- No mantiene ocho consultas por jugador ni consultas de todos los partidos. El historial sólo se pide al abrirlo o actualizarlo expresamente. Los refrescos compactos no descargan historial de eventos ni comandos completados.
- No renueva señales antiguas por recibir una respuesta nueva: se comprueban `observed_at`, recepción local y `last_seen_at`. Caducidad de quince segundos. Las consolas verificadas conservan su excepción existente. El inicio sigue sometido a la comprobación final de CTP.
- Resumen del informe PC formal de 430: contadores limitados y cobertura de procesos, conexiones y archivos; coincidencia declarada del paquete y aviso revisable. Requiere `monitoring_current=true`, lectura de sala vigente y última señal menor de quince segundos. Los datos pueden proceder de lecturas anteriores: no son atestación física ni certificación de un PC limpio. Un aviso anterior conserva su advertencia, con contadores desconocidos.
- Proyección estricta al navegador: sin PID, rutas, destinos de red, huellas o identificadores del dispositivo, hashes de catálogo, listas de reglas ni texto libre de eventos. Una estadística inválida queda desconocida sin alterar la preparación del partido.
- Reintento del mismo comando, motivo, control de versión y autorización del árbitro conservados. Tras una respuesta incierta se vuelve a consultar la solicitud existente. No se reenvían automáticamente mutaciones.
- 115 claves semánticas nuevas en español, inglés, italiano, francés, portugués y alemán; fechas y números según el idioma.

## Carga prevista y límites de la evidencia

Un panel visible consulta como máximo seis veces por minuto en reposo, frente a las doce anteriores. No hay consultas de historial en segundo plano. Un cambio confirmado puede provocar una lectura adicional deliberada. No se abre ningún flujo de mando en directo.

El refresco sin cambios de revisión deja de escribir dos registros SQLite. La prueba realiza cien lecturas y verifica cero filas escritas, manteniendo versiones y solicitudes pendientes. Las consultas de comandos se resuelven con una lectura, sin volver a consultar cada fila y su fuente.

La prueba de planificación usa 160 jugadores sintéticos repartidos en veinte alineaciones y verifica que un panel seleccionado mantiene siete consultas en sesenta segundos, incluida la inicial. Esto prueba el presupuesto del cliente; no es un ensayo de carga de 160 clientes nativos ni una medición de CPU/FPS o de la VPS. Los latidos nativos a cinco segundos suponen hasta 32 solicitudes/segundo para 160 PC: su validación corresponde al candidato backend/nativo.

## Dependencias y publicación

1. Publicar primero el candidato CTP formal de torneos con migración 430 y adaptador HMAC que admite `guard_state.include_events=false`; devuelve `events:[]` y los campos opcionales de informe PC. Por defecto el contrato histórico conserva eventos. No sustituirlo por el servicio Guard Ranked experimental.
2. Conservar las credenciales y vínculos CTP actuales de Manager. No crear cuentas locales ni suplantar identidades. Se mantienen `requireAuth`, permiso de arbitraje, derivación del actor y firma HMAC existentes.
3. La configuración PRE debe usar `PUBLIC_ORIGIN=https://pre.manager.playctp.com`, autenticación/web de CTP PRE y `CTP_OPERATIONS_URL=https://pre.playctp.com/functions/v1/manager-operations`. El nuevo control impide que Manager PRE firme consultas hacia PROD, loopback u otro destino/ruta. Root verificó esos valores públicos en la configuración real antes de introducir el control. Ningún secreto se ha copiado.
4. Integrar este commit sobre PRE actual mediante CI/CD, preservando cambios posteriores. Validar después conexiones, consola, pérdida de señal, recuperación, ocho titulares y autorización de inicio con cuentas de prueba autorizadas en PRE.
5. El paso a PROD permanece manual y pendiente de una orden independiente. Este trabajo no despliega ni cambia PRE/PROD.

No se habilitan cámara, supervisión de escritorio, control remoto, macros sin validar, sanciones automáticas ni avisos externos. La aceptación del jugador y la prueba física del instalador/juego corresponden al paquete nativo; un render sintético no las sustituye.

## Comprobación local

- Pruebas focales: `node --disable-warning=ExperimentalWarning --test test/guard-tournament.test.js test/guard-tournament-ui.test.js test/guard-contract.test.js`.
- Repositorio: `npm test` y `npm run build`.
- Incluye render del componente real en los seis idiomas con datos sintéticos, presupuesto del lector, pausa/cancelación, deadline, rechazo de respuestas tardías, caducidad de fuente, privacidad, CAS, permisos y protección de destino PRE.
- El render usa Vite en modo middleware, sin navegador, sesión, servidor HTTP ni datos del usuario. No se ha automatizado la ventana Guard activa del jugador.
- Logs y manifiesto de revisión: `D:\CTP\output\cup1-guard-manager-pre-20261114-*`.
