# Recepción QA de CTP Manager · 15 de octubre de 2026

Manager está disponible en **https://manager.playctp.com**, conectado a **https://pre.playctp.com** para autenticación, enlaces y operaciones oficiales. La revisión desplegada es `b867c885c75abf76a0099584b3515aa5d3df4cba`, preparada en la rama `codex/manager-flow-qa-20261015`. Esta recepción corresponde a PRE; no autoriza publicar la web completa en producción.

## Configuración y autoridad

| Control | Estado comprobado |
| --- | --- |
| Acceso | `CTP_AUTH_MODE=ctp`; misma cuenta staff de CTP, sin registro local público |
| Escrituras a PRE | `CTP_ENABLE_WRITES=true`; el puente acepta operaciones firmadas |
| Sincronización | Lecturas cada 30 segundos |
| Cambio oficial | Propuesta, envío explícito de administración y ACK del backend; conserva al autor original |
| Gestión competitiva exclusiva | `enforced=false`; no se retiró la gestión existente de CTP |
| OBS | `OBS_ENABLE_CONTROL=false` |
| Migraciones | No se aplicaron en esta revisión |
| Producción | Sin cambios; se conserva la landing de espera |

Las plantillas de instalación mantienen las escrituras desactivadas. La activación validada de PRE no convierte esa opción en un valor seguro para cualquier instalación ni vacía automáticamente propuestas antiguas.

## Correcciones incluidas

- La búsqueda del responsable al crear un club admite la lista devuelta por CTP exclusivamente para esa acción y conserva un DTO limitado. Las demás acciones siguen exigiendo el formato de respuesta previsto.
- Las nuevas propuestas de clubes y Ranked se pueden enviar cuando todavía no existe una versión remota proyectada. Una versión conocida obsoleta sigue bloqueando el envío.
- Una denegación definitiva 401/403 de la primera entrega queda como rechazada y no aplicada, permitiendo descartarla expresamente y preparar otra propuesta. Si hubo un intento anterior ambiguo, se mantiene la reconciliación con el mismo identificador; no se libera como si nunca hubiera llegado.
- Las cargas de calendario, tablero, disponibilidad y escaletas muestran error y reintento, y descartan respuestas antiguas o recibidas tras abandonar la vista. Un 401/403 retira la información privada de la vista.
- El guardado automático conserva el último cambio, serializa las escrituras y retiene los datos si falla el servidor. Ver, imprimir o duplicar una escaleta espera al guardado; un fallo impide continuar y permite reintentar sin reescribir.
- Las fechas imposibles se rechazan en servidor sin modificar el contenido guardado.

## Evidencia de pruebas

| Capa | Resultado y alcance |
| --- | --- |
| Pruebas de fuente | **162/162** correctas; build de la interfaz correcto |
| Protocolo firmado aislado | 8 grupos de competición, 7 de Guard y 3 de disciplina; 3 suites SQL, más conflicto de versión Guard |
| PRE multicuenta | Administración, arbitraje, producción y jugadores sintéticos; autenticación, permisos y escrituras reales descritas abajo |
| Navegador sobre el despliegue | 23 rutas; recuperación de 4 errores GET 503 inducidos; 11 comprobaciones reales de guardado de escaletas |
| Presentación | Revisión a 1440 px y 390 px, sin desbordamiento horizontal en las vistas comprobadas ni excepciones JavaScript en la pasada final |

En PRE se comprobó crear y editar un torneo, revisar inscripciones, generar y publicar cruces, reprogramar partidos y rechazar versiones obsoletas. Las propuestas no cambiaron CTP antes del envío explícito. La corrección de estadísticas de ocho jugadores generó otra revisión; se denegó la autoaprobación y se confirmó con un revisor distinto, conservando el original.

También se probaron notas privadas y respuestas al participante, cierre de soporte, resolución arbitral y resultado oficial, búsqueda del responsable y creación/verificación manual de clubes, histórico, dossier y preparación de partido. Se crearon, editaron y cancelaron programaciones futuras de Ranked, conservando la season activa y sin ejecutar un reinicio de MMR. Guard rechazó iniciar un partido sin las conexiones requeridas. La revisión editorial cubrió contenido, recursos, escaletas, tablero, disponibilidad, turnos, solapamientos y confirmación por la persona asignada; una decisión disciplinaria de prueba se aplicó y revocó mediante el puente.

Las comprobaciones de acceso incluyeron rechazo de jugadores y de orígenes ajenos, cookies de sesión protegidas, separación de secciones por rol y revocación de sesiones al retirar el rol CTP o desactivar el acceso local. Un perfil de producción no pudo consultar arbitraje. OBS continuó bloqueado.

Algunas ejecuciones iniciales de los scripts privados se interrumpieron por supuestos incorrectos del propio harness; se conservaron sus resultados parciales y se continuaron los casos pendientes con resultados correctos. No se suman esos recibos parciales como si fueran una única ejecución completa sin fallos.

## Conservación de datos y limpieza

Los flujos remotos utilizaron cuentas y registros marcados de QA, sin resolver expedientes ni propuestas reales del equipo. Al terminar se eliminaron **11 cuentas Auth**, **3 espejos de usuario de Manager**, **24 comandos** y **26 registros operativos temporales** de Manager, junto con los datos competitivos de prueba. Se preservaron los **5 usuarios de Manager** y el **comando previo** ajenos a la prueba. La comprobación de claves foráneas de SQLite fue correcta.

La programación futura de Ranked se canceló y la season activa conservó su identidad y configuración inicial. Las versiones de auditoría que avanzaron legítimamente no se rebobinaron. No se activó el corte competitivo ni se enviaron pruebas a canales públicos de Discord.

La comprobación final posterior a la limpieza confirmó integridad SQLite y claves foráneas correctas, los cinco usuarios y el comando previo preservados, 19 contenedores sanos sin terminaciones por falta de memoria y ambos bots preparados. Se ejecutaron los respaldos de PRE y Manager con salida correcta y se comprobaron sus temporizadores activos. Esto acredita la creación de las copias; no equivale a un ensayo de restauración en esta revisión.

Producción conservó el hash de su landing y no recibió usuarios, equipos, torneos, partidos ni objetos de prueba. Ranked permanece oculto mediante su feature flag y la season activa no cambió.

## Reproducción y límites

Las pruebas de fuente se ejecutan con `npm test` y `npm run build`. Los runners versionados `scripts/test-signed-ctp-flow.mjs`, `scripts/test-guard-manager-flow.mjs` y `scripts/test-guard-conflict-flow.mjs` requieren su entorno aislado explícito. No apuntarlos a PRE usando datos del equipo ni reutilizar una base real como fixture.

La evidencia técnica local se conserva en `output/manager-audit-20261015/` y los recibos remotos y de navegador en `validation.local/manager-flow-20261015/`, ambos excluidos de Git. Esas carpetas no se publican con el paquete ni contienen credenciales destinadas a documentación.

Esta revisión no acredita un Guard físico, precisión OCR sobre el juego nuevo, emisión real con OBS/CTP Panel ni entregas externas de Stripe, correo o Twitch. La batería cubre los flujos y fallos descritos; no certifica todas las combinaciones posibles de formatos, dispositivos o servicios externos. Las pruebas aisladas con clientes Guard sintéticos no equivalen a una sesión de juego real.
