# Guard, Manager y OCR · Validación local del 5 de octubre de 2026

Implementación local revisable. No se ha hecho push, deploy ni aplicado migraciones en Supabase PRE. La base de las pruebas es PostgreSQL en Docker con red deshabilitada; los jugadores, clubes y operadores son sintéticos. El Manager lleva el aviso «QA LOCAL · SIN PRE».

## Qué está conectado

El EXE de Windows ya usa el protocolo `ctp-guard`: vinculación por código temporal, secreto de sesión, señales periódicas y cierre. El nuevo Manager consulta esa misma base por su puente privado `manager-operations`, con HMAC, nonce y permisos independientes por operador CTP. No recibe tokens de sesión de Guard ni claves de Supabase en el navegador.

La ficha de un partido incluye un lobby con ocho titulares, estado del mando y captura, última señal, verificación/revocación de consola y actividad. El árbitro puede configurar los requisitos del torneo y autorizar el inicio. Las decisiones quedan en la cola durable del Manager y en la auditoría CTP. Una petición repetida no inicia dos veces el encuentro. La autorización registra el inicio: no abre ni controla el lobby dentro del juego.

El inicio requiere cuatro jugadores por lado, señales de menos de quince segundos y los requisitos exigidos. Se comprueba otra vez en el servidor justo al confirmar. Cambiar la configuración o los titulares invalida una versión preparada. Las exenciones no se cambian después de empezar. Cada consola requiere motivo del árbitro; un perfil que diga «consola» no concede automáticamente la exención.

También se ha integrado en la web la sala de espera del jugador, la generación de códigos y la selección de cuatro titulares si hay suplentes. La importación desde el puente local del EXE inicia el OCR en el navegador. No se sube la imagen al servidor; se guardan los datos revisados. El puente local consume la imagen una vez y elimina su copia en Guard.

## Resultados comprobados

| Prueba | Resultado |
|---|---|
| Manager | 113 tests; build correcto |
| Web y protocolos | 280 tests; build correcto |
| SQL 000–082 | 29 suites y 10 suites de concurrencia; hash de 082 coincide con lo probado |
| HTTP firmado → PostgreSQL | Acceso por rol/vínculo, configurar, ocho códigos, secretos privados, expiración, pérdida de mando/captura, reconexión, consolas y un único inicio |
| Comprobación antes del primer heartbeat | Vincular un código sin primera señal no habilita al jugador, incluso sin exigir periféricos |
| OCR de píxeles en navegador real | Tres imágenes controladas: clara/oscura 720p y clara 1080p; ocho nombres y cuarenta cifras correctos por imagen; aproximadamente 0,5–1 s |
| Cuarta imagen, nombres de las cuentas QA | Ocho nombres; una cifra incorrecta: 11 leído como 1. La confianza global era 94%; el aviso por palabra sí señala el 1 |
| OCR → revisión → datos oficiales | Corrección de referencia simulada solo para QA; ocho filas guardadas, aprobación por el puente firmado y aparición en el dossier del Manager |

La mejora OCR invierte y amplía fondos oscuros sin sustituir letras por números. La confianza global nunca habilita un guardado automático. Los avisos por palabra ayudan a revisar cifras dudosas; no garantizan detectar todos los errores. El usuario sigue seleccionando jugadores y revisando cada valor antes de enviar. La aprobación oficial mantiene su flujo separado.

Se encontró la beta en `D:\XboxGames\Call of Duty- Modern Warfare 4- Beta`. Los PNG accesibles son logos y pantallas de presentación; no se encontró una captura o un layout de estadísticas directamente utilizable. Los recursos del juego están empaquetados. No se han modificado, descifrado o cargado archivos del juego, ni inspeccionado su memoria.

## Pendiente para probar con jugadores reales

- Capturas finales de los tres modos, distintas resoluciones, idiomas, nombres y tamaños de interfaz. No se certifica aún la precisión del OCR de MW4.
- Prueba física del EXE con juego en primer plano, F9, mando y entrega de una captura a una sesión web real. Las pruebas HTTP no sustituyen esa prueba del dispositivo.
- Cámara, análisis de macros/inyecciones y evidencia de anticheat. Los heartbeats son declaraciones del cliente; no certifican un PC libre de trampas.
- Firma del ejecutable/instalador y revisión de privacidad/retención antes de un piloto público.

## Activación en PRE: requiere autorización y coordinación

Los cambios viven en `ctp_manager` (rama `codex/manager-development`), la integración web/backend en `ConnectToPlay-pre-integration` y el EXE en `ConnectToPlay-guard`. No aplicar todas las migraciones pendientes a ciegas ni sobrescribir correcciones del compañero.

1. Confirmar historial y esquema real de PRE, particularmente 079–080 y si 081 ya existe. Respaldar la base y comprobar compatibilidad de las funciones de roster.
2. Aplicar únicamente las migraciones nuevas necesarias: 081 crea las tablas/RPC Guard; 082 conecta los operadores, versiones, auditoría e inicio con Manager. Son aditivas; no borran datos ni habilitan Guard en los torneos existentes.
3. Publicar las versiones revisadas de `manager-operations` y `ctp-guard` con la configuración JWT de `supabase/config.toml`. Conservar las claves privadas del servidor. El Manager mantiene su transporte firmado existente.
4. Conceder expresamente `guard.read`, `guard.configure`, `guard.exempt`, `guard.start` a los operadores CTP autorizados. La migración no concede estos permisos a cuentas reales.
5. Desplegar web/Manager, probar un torneo piloto y habilitar Guard únicamente ahí. Un árbitro confirma consolas; los jugadores PC generan el código en CTP y lo introducen en el EXE.

Para una vuelta atrás operacional, mantener los datos Guard y deshabilitar su exigencia antes de iniciar el torneo. No borrar sesiones, recibos o auditoría. No se permite desactivar los requisitos de un torneo que ya tiene partidos iniciados: ese caso requiere coordinación del staff.

## Evidencias y reproducción local

`output/guard-manager-flow.json`, `output/ocr-validation.json`, `output/ocr-manager-flow.json`; capturas en `output/playwright/`. La regresión SQL está en `ConnectToPlay-pre-integration/validation.local/database-check.json`.

Los runners aceptan exclusivamente bases QA y contenedores aislados. `test-guard-manager-flow.mjs` debe correr sobre una fixture nueva; deja un inicio autorizado. `test-ocr-manager-flow.mjs` usa el resultado real del OCR y simula la revisión contra la imagen de referencia; no es un proceso de corrección automática de datos reales. `qa-guard-lobby.mjs` deja otro partido sin iniciar para probar los botones en el navegador.

Se excluyen del build de TypeScript las copias temporales `*_BACKUP_*`, `*_BASE_*`, `*_LOCAL_*` y `*_REMOTE_*` de Git mergetool. Se conservan los archivos; no se han borrado ni modificado las copias del compañero.
