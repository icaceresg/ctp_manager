# Agente OBS anterior · referencia histórica

Desde la delimitación del 2 de octubre de 2026, **CTP Panel es la herramienta de emisión** y Manager es el backoffice de staff, competición y arbitraje, además de preparación y coordinación. Las acciones oficiales de Manager se validan en el backend CTP compartido con la web de jugadores. El backend del agente OBS, el agente y sus pruebas se conservan para no borrar trabajo ni historial, pero no forman parte del flujo actual. **Mantener `OBS_ENABLE_CONTROL=false` y no iniciar el agente.** No utilizarlo a la vez que el Panel.

Según la descripción facilitada por el equipo, el Panel es un dock HTML de OBS que emite estado `ctp-overlay` por OBS WebSocket y `BroadcastChannel`, y controla tarjetas, marcador, mapas, descansos, casters y cámaras. El HTML no está disponible en este workspace y no se ha verificado aquí. Manager no implementa esos controles, no abre un segundo Panel y no accede a sus cabeceras o credenciales locales.

## Código que se conserva

- `server/obs.js`: cola persistente de órdenes y estado del agente, autenticación y comprobación de permisos.
- `server/routes/obs.js`: rutas anteriores de consulta, creación, reclamación y confirmación de órdenes.
- `scripts/obs-agent.mjs`: cliente de OBS WebSocket v5 que puede cambiar una de seis escenas configuradas y consultar después el programa.
- `test/obs.test.js`: pruebas locales del protocolo anterior; no prueban el Panel externo ni una emisión real.

La implementación anterior contempla previa (`preview`), equipos (`teams`), mapa (`map`), pausa (`pause`), resultado (`result`) y siguiente (`next`). No utiliza el protocolo de estado `ctp-overlay` descrito para el Panel. No se deben interpretar esos identificadores como un contrato de integración con él.

La pantalla **Preparación** conserva el vínculo del partido con su escaleta, notas y estado organizativo. Ya no muestra selección de escenas, consulta periódica de OBS ni envío de órdenes. Mantiene la ruta y el permiso `realizacion`. Los campos históricos de escena y las tablas anteriores se conservan; guardar la preparación no implica cambiar la emisión.

## Condiciones de conservación

El servidor mantiene el control apagado por defecto. No configurar tokens ni arrancar el proceso como parte del despliegue de Manager. La existencia de código, tablas o pruebas no acredita que este agente haya controlado un OBS real. Las pruebas registradas del agente usaron un servidor local de protocolo.

El mecanismo conservado requería un token dedicado distinto del puente CTP; la contraseña y la dirección OBS pertenecían al PC de realización. No copiar esas credenciales a la interfaz, los enlaces o Git. No reactivar esta vía sin una decisión explícita que sustituya el control existente y una validación fuera de emisión.

## Recuperación del mecanismo anterior

Esta sección describe el código conservado, no instrucciones para ponerlo en marcha. La cola SQLite conserva las órdenes tras reiniciar Manager. Cada orden tiene reserva de 30 segundos; solo se ejecuta una a la vez. Un cambio nuevo sustituye órdenes pendientes. Las reservas caducadas se recuperan con el mismo identificador, hasta tres intentos, y rechazan confirmaciones de una reserva anterior. El servidor vuelve a comprobar el acceso del operador al reclamar la orden.

El agente valida el nombre de escena, autentica con el challenge OBS, solicita el cambio y consulta de nuevo el programa antes de confirmar. Si la escena ya está aplicada, confirma sin repetir la transición. Los errores no envían contraseñas ni rutas. Este flujo es independiente del estado oficial de los partidos y del Panel externo.

## Alimentación futura del Panel

El equipo describe lectura periódica de JSON y mapeo personalizado en su Panel. Antes de construir una adaptación en Manager hay que revisar ese HTML y acordar los campos, acceso, cadencia y tratamiento de datos ausentes o desactualizados. La propuesta es una lectura limitada de datos aprobados desde servidor, sin credenciales Supabase, sin secretos del puente y sin expedientes privados.

No existe todavía un endpoint Manager para el Panel ni un mapeo de sus campos. El Panel conserva la edición manual y el control en tiempo real; los resultados competitivos oficiales continúan en CTP. La integración no debe crear una segunda instancia del Panel por emisión.

Referencia técnica del agente conservado: [OBS WebSocket v5](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).
