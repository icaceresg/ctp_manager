# Manager: candidato de operaciones, Ranked y avisos

Base PRE/main `5fbab53`; rama `codex/manager-ops-ranked-alerts-pre-20261027`. Operaciones seleccionadas de `1a2df22` y avisos de `6270b01`, conservando las integraciones de Iván.

Incluye Inicio, vistas Ranked, buscador, ficha/historiales, tickets, chat y ACK/reintentos. Dependencias CTP: lector252 con reconciliación243/252/253,245 para matchmaking desactivado por defecto,247 para avisos privados.

Excluye PC Check completo y los bloques móviles UGC/avatar/eliminación/privacidad posteriores. Tooling DEV en commit separado con perfil local finito. No cambia secretos o permisos PRE desde pruebas locales.

## Checks previstos

- `npm ci` con dependencias y caché propias.
- `npm audit --audit-level=high`.
- `npm test`, incluyendo jugadores, tickets/chat, avisos y ausencia de rutas/menú PC.
- `python -B test/metrics-traffic.test.py`, `metrics-collector.test.py`, `manager-release.test.py`, como CI.
- `npm run build` e inventario empaquetable sin código/assets PC.

## Resultado local

- Dependencias instaladas en este worktree, con caché aislada; ningún `node_modules` compartido.
- Auditoría: cero vulnerabilidades.
- Node:453 casos,448 PASS,0 FAIL y5 omitidos explícitos de scripts POSIX en Windows. La prueba HTTP autenticada comprueba404 en diez rutas PC ausentes. El launcher rechaza enlaces físicos a otras SQLite y archivos auxiliares usando fixtures temporales sin abrir bases.
- Python:19 pruebas de tráfico y13 del colector correctas;38 casos del release, con19 omitidos explícitos por plataforma Windows y el resto correctos. Las omisiones se deben repetir en el CI Linux.
- Build web correcto. Inventario empaquetable:175 archivos/4519386 bytes, sin código, endpoints o assets PC ni módulos móviles excluidos; comprobación de credenciales privadas del empaquetador correcta.
- `git diff --check` correcto y base `origin/main` conservada como ancestro.

Logs y recibo filtrado bajo `validation.local/qa/`, fuera de Git. SQLite temporal y CTP sintético no acreditan el stack real; no se ha arrancado este candidato ni usado su base persistente en estos checks. El arranque y los flujos locales siguientes tienen recibos separados y datos propios. PRE se integra tras QA y revisión/CI. PROD queda fuera.
