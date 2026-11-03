# Historial al sancionar — DEV

Rama: `codex/manager-sanction-history-dev-20261103`, basada en PRE `236f052`.
Sin publicación en PRE ni PROD. No cambia los comandos de sanción, sus duraciones
ni su confirmación, y no aplica una medida automáticamente por reincidencia.

## Comportamiento

- El formulario de bloqueo de la partida Ranked consulta el historial del jugador
  seleccionado, incluido el acceso desde una denuncia. El centro disciplinario
  lo muestra también al sancionar, amonestar, revisar, revocar o levantar una
  medida personal.
- Resumen de medidas activas, previas y amonestaciones. Las revocadas no se suman
  como medidas previas; un bloqueo levantado se identifica sin presentarlo como
  activo. Las medidas de los clubes actuales se muestran aparte.
- Motivo, fecha, duración y estado. Tres registros iniciales; el resto se monta
  al abrirlo en páginas locales de 20, sin otra consulta. El límite de 500 del
  backend se anuncia como cobertura parcial cuando se alcanza.
- Carga, error y sesión/permisos se distinguen de una respuesta sin registros.
  Cambiar jugador, identidad staff o cerrar cancela la lectura y descarta una
  respuesta obsoleta. No hay sondeo periódico del historial.

## Identidad y permisos

El centro disciplinario conserva `GET /operations/discipline/users/:id`.
Ranked no añade UUID de cuentas al sondeo general. La nueva lectura local de
Manager es `GET /operations/ranked/lobbies/:id/players/:slot/discipline` con el
nombre que se muestra en esa plaza (1–8).

El servidor exige sesión, arbitraje y rol nativo de Ranked. Lee en paralelo el
detalle actual y el histórico filtrado por el UUID exacto del lobby. Comprueba
el lobby, cada UUID del roster, su unicidad y la correspondencia única de
nombre/equipo antes de consultar el historial por la cuenta identificada por
CTP. No busca cuentas globalmente por nombre. Una incoherencia falla de forma
cerrada. Los tres mensajes del puente son lecturas; los permisos disciplinarios
siguen comprobándose en CTP y las respuestas API llevan `no-store`.

No requiere migración CTP para funcionar. La optimización de búsqueda de un
UUID en el histórico se prepara separadamente en la candidata CTP.

## Validación

- 34 pruebas focales: contrato, modelo, carreras/cierre/reintento, JSX real y
  Router HTTP con Auth/puente sintéticos; todas correctas.
- Suite completa: 574 pruebas, 569 correctas, 0 fallidas y 5 de transporte de
  despliegue omitidas por sus condiciones habituales. `npm run build` correcto.
- Playwright/Chrome: vista 390×844 y escritorio, cambio de jugador, lectura
  fallida y reintento, formulario de sanción y 500 registros. Sólo 3 tarjetas
  iniciales o 23 con una página adicional; cambiar de página no genera GET.
  El diálogo móvil cabe horizontalmente (374px en viewport de 390px).

La comprobación visual usa los componentes reales con respuestas sintéticas en
memoria; no acredita sanciones reales ni una sesión de staff sobre PRE.
La vista UI de prueba está en
`http://127.0.0.1:61745/__sanction_history_qa` mientras su proceso local siga
abierto. No se conecta a la base DEV compartida ni permite escribir sanciones.
Los artefactos se guardan en
`D:/CTP/output/playwright/manager-sanction-history-20261103`.
