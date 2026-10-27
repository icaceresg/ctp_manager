# PC Check: expedientes privados y custodia local de Manager

## Procedencia e integración DEV

Código importado exclusivamente del árbol Git `528e2d3fc15819794b6ae0396a0d5036f4a3d41d` ("Validate MW4 evidence scope and enrich referee PC check review"), que incluye `57e35b07cdb544af088cd3617a0f0790aa577473` ("Add private PC check cases and deferred referee review"). No se han copiado archivos sin confirmar ni modificado el worktree original de PC Check. La integración local en `codex/manager-operations-order-20261026` añade únicamente el filtro de expedientes por UUID CTP desde la ficha del jugador y separa los estilos en `client/src/operations/pc-check.css`.

Las comprobaciones y capturas descritas al final pertenecen a la entrega original; no constituyen una nueva validación de Windows, del ejecutable o de un PC de jugador en esta integración. Se prueban contratos, custodia y presentación con datos sintéticos en DEV. No se ha desplegado en PRE/PROD, cambiado permisos de Supabase ni inspeccionado un equipo de jugador para esta integración. La asignación manual del UUID/alias de CTP por un miembro del staff no acredita un inicio de sesión del jugador. El consentimiento técnico registrado tampoco sustituye la revisión jurídica o la firma del producto.

La ruta de interfaz `/pc-checks?user_id=<UUID>` consulta `/api/pc-check/cases?user_id=<UUID>` y permite volver a la ficha de ese jugador. El filtro se aplica en SQL antes del límite de 100, junto a la vigencia y permisos del caso. No da acceso a los casos de otros árbitros. Un UUID inválido o un filtro duplicado devuelve 400; la interfaz no sustituye ese error por la lista general. `playerId` es el UUID CTP asignado al caso; `assignedOperatorId` y los ID de revisores corresponden a la base propia de usuarios Manager.

El montaje de servidor importa `pcCheckUploadRouter` y `pcCheckRouter` desde `server/routes/pc-check.js`: el primero debe ir bajo `/api` **antes** del parser JSON general, para autenticar la capacidad antes de leer una entrega grande. El segundo va bajo `/api` con las rutas normales. Las factorías aisladas son `createPcCheckStore(db, {origin, now, key, reviewers})` y `createPcCheckRouters({store, requireAuth, allow, mapError, now})`. La inicialización es diferida; importar el módulo no crea expedientes ni emite asignaciones.

## Flujo de trabajo

1. En **Operaciones → Arbitraje → PC Check**, un árbitro crea un caso con UUID CTP, alias, finalidad, plazo de acceso de 1–30 días y alcances máximos. El servidor fija el UUID del caso y el operador autenticado; no acepta que el navegador asigne otro operador.
2. El creador o administrador descarga una asignación JSON mediante POST autenticado. Contiene una capacidad aleatoria de 256 bits válida como máximo 24 horas y nunca más allá del vencimiento del caso. Reemitirla invalida la anterior. No debe pegarse en URLs, chats, logs ni notas del expediente.
3. La aplicación nativa comprueba la asignación mediante Bearer y recoge sólo los alcances consentidos. La transferencia actual exige la política `ctp-pc-check/2026-10-26.3`, los cinco reconocimientos y la vinculación exacta de caso/jugador/operador/finalidad. Se conservan las entregas anteriores `.2`, sin suponer un contexto de juego que no registraron; la identidad ampliada de archivos, el catálogo y los enlaces de eventos no se aceptan como recogida nueva bajo `.2`.
4. La aplicación envía un paquete de hasta 8 MiB originales, máximo 12 archivos, con parser JSON de 12 MiB. Se autentica la capacidad antes de leer el cuerpo. Límite por caso: 30 intentos/minuto y 2 transferencias simultáneas; caché acotada a 2048 casos. El token sólo permite leer la asignación y entregar evidencia a ese caso.
5. Manager verifica SHA-256 del manifiesto y bytes/tamaños/hash de todos los artefactos, nombres permitidos, consentimiento, alcances y contrato de collectors. La evidencia recibida queda inmutable. Un reintento de los mismos bytes devuelve el mismo recibo; otra evidencia devuelve 409.
6. El recibo vincula caso, jugador, hash del manifiesto, hora de recepción y UUID del recibo. La aplicación nativa puede liberar su copia sólo tras verificarlo; esta parte pertenece al cliente Windows. Una respuesta perdida no demuestra recepción ni autoriza borrar la copia pendiente.
7. El creador puede asignar explícitamente otro árbitro activo para revisar posteriormente. El mismo rol por sí solo no permite abrir casos ajenos. El acceso puede revocarse; las notas conservan autor y hora. No se aplican sanciones desde este panel.

## Custodia y acceso

- Configurar **`PC_CHECK_EVIDENCE_KEY`** con 32 bytes aleatorios en base64url canónico, exclusivamente en el entorno del servidor. La variable está documentada sin valor en `.env.example`; no se ha modificado un `.env` real. Es una clave independiente de sesiones, puente y capacidades.
- Si falta una clave válida, PC Check responde 503. No se crea un almacén alternativo en texto claro ni se degrada la autenticación. El resto de Manager conserva su comportamiento.
- Los artefactos originales, incluido `report.html` como base64 inerte, se cifran juntos con AES-256-GCM. Nonce aleatorio de 12 bytes, tag de autenticación y AAD de caso + hash del manifiesto. Se preservan los bytes originales y los Int64 de .NET: nunca se reconstruyen artefactos a partir de JSON parseado.
- La clave no se guarda en SQLite. Guardar una copia segura de la clave aparte: perderla impide descifrar evidencia; cambiarla sin procedimiento de migración deja ilegibles los casos anteriores. Este cambio no implementa rotación automática de claves.
- Metadatos del caso, resumen limitado, membresía de revisores y auditoría se guardan en tablas SQLite separadas de las proyecciones CTP. Se inicializan de forma diferida e idempotente en la primera operación PC Check configurada. El resumen se deriva en servidor de estados y contadores conocidos; los hallazgos son señales de revisión, no culpabilidad.
- Lista, detalle, notas y lectura de evidencia comprueban sesión, permiso actual de arbitraje y propiedad/revisor explícito/administrador. El token de la aplicación no permite leer la evidencia. La baja del creador deja el caso sólo accesible a administradores/revisores ya autorizados; reutilizar su ID numérico no recupera la propiedad.
- La consulta de evidencia requiere acción explícita y queda auditada. El panel sólo presenta JSON de collectors como texto escapado, máximo 256 KiB por vista con aviso de truncado. No ejecuta HTML, no sigue enlaces y no carga automáticamente todos los bytes al abrir una lista. La descarga íntegra es JSON `attachment` con artefactos base64; nunca HTML inline.
- La auditoría contiene acción, caso, actor y fecha: no almacena capacidades, cuerpos, credenciales, direcciones de red ni identificadores físicos del hardware. Las notas son datos introducidos explícitamente por el árbitro.
- El alias asignado se conserva literalmente en caso, asignación y `request.playerAlias`. El reconocimiento `acknowledgedBy` se compara como en Core: sin espacios Unicode en los extremos y con igualdad ordinal; se rechazan valores vacíos, de más de 80 caracteres o con controles. Esto admite la firma recortada por Windows sin reescribir el consentimiento ni aceptar otro alias o cambios de espacios internos. No se permiten altas nuevas con alias formado sólo por espacios.

## Perfil específico de Modern Warfare 4

El consentimiento `.3` registra `gameTitle` exactamente `Call of Duty: Modern Warfare 4`, `gameDistribution` como `steam`, `battle-net`, `xbox-pc` o `unspecified`, y una anotación opcional `gameBuildLabel` de hasta 80 caracteres. Son declaraciones del operador: Manager no comprueba la instalación, el distribuidor, la versión ni la atestación privada de Activision. Los informes `.2` sin estos datos muestran contexto desconocido, sin asignarles MW4 por defecto. Esta entrega no acredita una prueba consentida con MW4 ni compatibilidad validada con RICOCHET.

La nueva identidad de archivo se limita a ejecutables y módulos ya referenciados por el inventario autorizado. Manager admite únicamente los campos tipados de estado, razón, SHA-256 completo, tamaño, metadatos PE autodeclarados y estado de firma local sin consultas de red. La cobertura identifica los presupuestos de 128 archivos, 128 MiB de flujo SHA-256, 6 segundos por archivo y 12 segundos por collector. Las lecturas internas de verificación de firma y recurso de versión no están incluidas en la contabilidad de bytes; un límite o fuente inaccesible conserva su condición parcial/no disponible. La firma o empresa PE no certifica inocuidad ni acredita qué código estuvo cargado en memoria.

`server/pc-check-vulnerable-drivers.catalog.json` contiene sólo los seis identificadores de muestras revisadas de LOLDrivers, fijados a la revisión `96a491d410f849fd392762c83cea8ccbe81a5bff` y licencia `Apache-2.0`, con [atribución y texto de licencia](PC_CHECK_THIRD_PARTY_NOTICES.md). No contiene binarios ni conecta con un servicio de reputación. Manager recalcula las coincidencias de SHA-256 a partir de identidades declaradas `complete` y `full-file` y rechaza una categoría, familia, hash, índice o URL de procedencia alterados. Los seis son **controladores vulnerables**, no muestras clasificadas como maliciosas. La comparación de hashes aportados por el cliente no verifica el binario del PC: puede haber herramientas legítimas de hardware. No se bloquea, borra o sanciona nada automáticamente.

En Eventos, la política `.3` permite hasta 80 proyecciones filtradas de registros Sysmon existentes: carga de imagen (7), hilo remoto al objetivo (8), acceso al objetivo (10) y alteración de imagen (25). Los PID deben estar consentidos y sus horas deben corresponder a los ticks originales de `targets.json`, preservados sin pérdida de precisión. El servidor comprueba el inicio exacto y que el evento caiga desde ese inicio hasta el fin de recogida +1 segundo. La correlación no atesta identidad histórica: un PID y ventana temporal son evidencia limitada. `eventDataCollected=true` indica que sí se guardó esa proyección; `rawEventDataStored=false` indica que no se conservó EventData completo. Se excluyen XML, mensajes completos, usuario, argumentos y CallTrace. No se instala ni activa Sysmon.

El resumen muestra el contexto declarado, cobertura de archivos, coincidencias de componentes vulnerables y recuentos por relación de eventos. Las listas y detalles conservan las mismas ACL; consultar los JSON originales sigue requiriendo una acción explícita auditada. Los envoltorios y filas anidadas tienen listas de campos permitidos y límites, y módulos/regiones/enlaces no pueden referenciar PID ajenos a la selección del consentimiento.

## Conservación: límite de acceso, no purga automática

El plazo empieza al crear el caso. Una vez vencido, desaparece de las listas y las lecturas/notas/asignaciones/transferencias devuelven 410. **Esto no borra físicamente filas, WAL, copias de seguridad ni descargas de revisores.** La purga manual autorizada y el tratamiento de las copias de seguridad necesitan un procedimiento operativo antes del uso corporativo. No se ha añadido un worker, timer, unidad o borrado automático.

## API

Sesión Manager con arbitraje; cada ruta verifica además la ACL del caso:

| Método | Ruta | Función |
| --- | --- | --- |
| POST | `/api/pc-check/cases` | Crear caso propio con asignación de identidad por staff |
| GET | `/api/pc-check/cases?user_id=<UUID>` | Listar hasta 100 casos vigentes accesibles; filtro opcional de jugador CTP |
| GET | `/api/pc-check/cases/:id` | Resumen limitado, cobertura y notas |
| POST | `/api/pc-check/cases/:id/assignment` | Emitir/reemitir archivo privado; sólo creador/administrador |
| GET | `/api/pc-check/reviewers` | Candidatos activos de arbitraje/administración: ID y nombre |
| POST | `/api/pc-check/cases/:id/reviewers` | `{reviewerId, enabled?}`; asignar/revocar, sólo creador/administrador |
| GET | `/api/pc-check/cases/:id/evidence` | Descarga JSON original cifrado en reposo; lectura auditada |
| POST | `/api/pc-check/cases/:id/review` | `{text}`; nota con autor y fecha del servidor |

Capacidad Bearer del caso, sin sustituirla por cookies:

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/pc-check/assignments/:id` | Comprobar asignación; devuelve metadatos sin token |
| PUT | `/api/pc-check/assignments/:id/evidence` | Entregar paquete y obtener recibo idempotente |

## Validación y límites de entrega

`test/pc-check.test.js` usa SQLite en memoria, actores sintéticos y transporte HTTP sólo loopback. Cubre ACL, revisión delegada/revocada, TTL, reemisión, cifrado/manipulación, inmutabilidad/reintentos, identidad y quinto reconocimiento, alcances, identificadores/direcciones fuera de consentimiento, objetivos, límites y estados parciales/cancelados. El test opcional `PC_CHECK_INTEROP_DLL` llama al generador .NET con transporte falso para verificar el serializador y constructor reales, sin ejecutar collectors, y compara todos los bytes originales tras cifrar/descifrar.

La clave de custodia, publicación del backend, firma del ejecutable/instalador, aceptación jurídica, pruebas consentidas Windows/anticheat, custodia humana y purga efectiva son puertas separadas. Estas pruebas locales no acreditan detección exhaustiva de trampas ni aceptación de producción.

Revisión visual adicional con Playwright sobre el componente real y API simulada exclusivamente en memoria del navegador: lista, apertura de expediente parcial, consulta de JSON y nota con autor. Captura en `output/playwright/pc-check-manager-desktop.png`, marcada como QA sintético. Se corrigió el contraste de las tarjetas para el tema oscuro de Manager y se añadieron explicaciones legibles junto a los códigos de cobertura. No se utilizaron cuentas ni sesiones reales. El servidor y la entrada temporal de QA se retiraron al terminar.

QA adicional de 0.2.0: contexto MW4, cobertura de identidad, catálogo y recuentos Sysmon visibles en el componente real con API sintética. Se verificó el escape de una cadena HTML maliciosa en la vista JSON: texto visible y cero elementos inyectados. Revisión a 1280 px y 390 px; se corrigió el desbordamiento del botón de expediente con texto largo. Capturas `output/playwright/pc-check-manager-v02-desktop.png` y `pc-check-manager-v02-mobile.png`; sólo GET locales, sin sesiones/cuentas reales ni cambios externos. Se retiraron la entrada temporal, navegador y servidor de QA.
