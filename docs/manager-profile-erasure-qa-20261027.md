# Manager: respuestas tardías de perfil y ficha

Complemento local del 27 de octubre de 2026 sobre `77769b260f21bfa0db43bea6ef70d175d81fd7e1`, en la rama `codex/ctp-mobile-google-20261027`. No incluye despliegue, consulta PRE/PROD, migración CTP ni datos de jugadores reales.

## Cambio y alcance

La lectura y edición administrativa de perfil comprueban el marcador permanente por el UUID validado antes de enviar la petición y después de recibir y validar la respuesta. La ficha de jugadores repite esa comprobación tras la consulta; una búsqueda comprueba todos los UUID de su página validada. Si cualquiera está marcado, se devuelve sólo404 genérico. No se filtran filas ni se cambia el total de una página, y no se reescriben resultados, XP o pruebas custodiadas.

`createPlayerWorkspaceReader` exige una conexión de privacidad explícita; no existe opción para omitirla. El control usa los IDs oficiales del contrato de cada endpoint y una lectura nueva del marcador tras el `await`. No busca nombres en texto, no modifica fragmentos del payload y no conserva una segunda copia de la ficha.

| Adaptador | Datos y protección de este bloque |
| --- | --- |
| `getCtpUserProfile`, `updateCtpUserProfile` | Perfil actual; comprobación previa y posterior por `payload.user_id`. Incluye la respuesta de una edición ya enviada. |
| `getPlayerWorkspace` detail/search | Ficha e identidades actuales; comprobación posterior de los IDs validados y rechazo íntegro. El historial deportivo de cuentas no marcadas conserva su contrato. |
| Competición, administración y expedientes del bloque `77769b2` | Conservan sus cercos de ingestión y respuesta existentes; esta corrección no cambia su clasificación ni su custodia. |
| `getStaffDirectory`, `setStaffAccess` | El directorio incluye identidad y correo actuales; el ACK de acceso tiene IDs y permisos. No se modifican ni se certifica aquí su respuesta tardía. |
| `getDisciplineUsers`, overview/history/write | Mezclan identidad actual y evidencia disciplinaria. La evidencia custodiada tiene su política de conservación y puede bloquear el borrado; esta corrección no la elimina ni decide esa política. Estos adaptadores no forman parte de la nueva prueba HTTP. |
| `getClubCandidates` y servicios móviles de UGC/privacidad | Mantienen sus contratos actuales. Los candidatos son perfiles actuales; los reportes y solicitudes incluyen evidencia y estado de tramitación. No se afirma una protección HTTP global sobre ellos. |
| Directorio interno de ruleta | Mantiene el filtrado de persistencia y sorteo del bloque anterior; no se cambia en este complemento. |

## Prueba y resultados

Se ejecutaron rutas HTTP reales de Manager sobre loopback, con autenticación y transporte firmado reales de Manager, SQLite temporal y respuestas remotas sintéticas retenidas. En cuatro casos —perfil GET, perfil PATCH, ficha detail y búsqueda con dos filas— la respuesta remota contenía datos personales. Mientras estaba retenida, una inspección local real confirmó el marcador; al liberarla, el navegador recibió sólo404 genérico, sin UUID, nombre, correo, gamertag ni biografía. Las consultas dirigidas a una cuenta ya marcada tampoco enviaron otra petición al puente.

Una cuenta no marcada conserva lectura de perfil, búsqueda completa, resultado confirmado, delta25 y XP75. Las consultas de ficha no guardan ni reescriben histórico en SQLite.

- **15 pruebas focales PASS**, incluidas las cinco nuevas de HTTP y las rutas/contratos existentes de perfil y ficha.
- **Batería completa: 519 pruebas, 513 PASS, 0 FAIL y 6 omitidas**: cinco casos POSIX del despliegue en Windows y una interoperabilidad .NET sin configurar. Las omisiones no cuentan como PASS.
- **Build web PASS**. El recibo con hashes de fuentes, logs y artefactos está en [manager-profile-erasure-receipt-20261027.json](manager-profile-erasure-receipt-20261027.json); los logs originales permanecen en `validation.local/`.

Esto prueba el cierre del adaptador HTTP local ante esas respuestas tardías. La inspección representa un sujeto sintético: no demuestra un borrado real en CTP, un ACK externo, envío de correo, aceptación legal o aprobación de Google. Una edición que ya llegó a CTP no se cancela retroactivamente; su resultado personal deja de publicarse y requiere consultar el estado actual. No se modifican permisos, retenciones, pruebas disciplinarias ni sesiones de otros entornos.
