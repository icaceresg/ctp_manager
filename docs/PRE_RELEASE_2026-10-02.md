# CTP Manager · paquete preparado para PRE · 2 de octubre de 2026

## Estado real

Los siete bloques están implementados localmente. No se ha hecho commit, push, despliegue de funciones ni migración remota en esta revisión. El Manager de pruebas de flujo usa una base PostgreSQL aislada con datos QA, no PRE.

- Manager: `D:\CTP\ctp_manager`, rama `codex/manager-development`. Se conserva el trabajo local anterior.
- Backend compartido: `D:\CTP\worktrees\ConnectToPlay-pre-integration`, rama `codex/integrate-pre-20261001`, actualizado por fast-forward a `origin/pre` `163469a`.
- Proyecto Supabase revisado en lectura: `wpprmdhlgrrhapcfaogh`.
- **Revisión posterior, 09:40 UTC:** el historial remoto enumera hasta 073, pero el esquema real ya contiene los cambios de ActivisionID y las funciones de 075, 077 y 078. No se deben tratar 074–078 como pendientes de ejecución solo por esa lista. El trabajo del compañero se preserva y se compara contra el esquema exportado.
- La función `manager-operations` todavía no estaba desplegada en ese proyecto. Reconsultar este estado antes de actuar, porque otro compañero puede cambiarlo.
- El DNS de `manager.playctp.com` no resolvió en la comprobación local. El dominio necesita configuración de DNS y HTTPS antes de habilitar modificaciones remotas desde su interfaz.

## Funcionalidad entregada

| Bloque | Comportamiento |
| --- | --- |
| Mi jornada | Tareas, partidos y navegación según funciones de staff; usuarios sin rol de staff no pueden entrar. |
| Arbitraje | Bandeja filtrable, asignación, notas, contexto de partido y decisiones junto al expediente. |
| Planificador | Disponibilidad, detección de solapes, sustitución y cambio de horario con motivo y nueva confirmación. |
| Decisiones | Preparar, revisar y enviar explícitamente; solo se anuncia aplicación tras confirmación de CTP. |
| Competición | Alta y edición de torneos, revisión de inscritos/roster, seed por puntos, motor oficial de grupos/eliminatorias, publicación y horarios. |
| Estadísticas | Validación por jugador, corrección de los ocho jugadores, nueva revisión, historial conservado y aprobación independiente. |
| Histórico | Consulta oficial con búsqueda, fechas, detalles y paginación, independiente del feed limitado de jornada. |

CTP Panel continúa siendo la herramienta de OBS. Manager prepara competición, staff y datos aprobados; no inicia otro controlador de emisión.

## Frontera de seguridad

El navegador accede a Manager por `https://manager.playctp.com`. El servidor, que escucha en loopback detrás del proxy HTTPS, es quien llama al puente CTP. Cada solicitud exige token privado y una firma HMAC independiente con timestamp, nonce de un solo uso y cuerpo exacto. No se considera el encabezado Origin como credencial.

Las operaciones verifican además el vínculo individual del operador con una cuenta CTP activa, sus ámbitos y el rol oficial requerido. Desactivar el operador, quitar su rol de staff o revocar su ámbito deniega nuevos cambios. Las consultas y las pantallas se filtran por permisos; producción no accede a expedientes arbitrales.

079 prepara el cierre de las vías antiguas de modificación competitiva cubiertas por estos flujos, pero **no lo activa al instalarse**. El servicio de despliegue realiza después un corte explícito y auditado con `manager_set_competition_cutover(true, motivo)`. Se capturan y verifican los permisos anteriores para poder restaurarlos con `false`; un cambio de permisos inesperado aborta la operación. Las acciones de jugadores (inscripción, participación y revisión del rival) siguen disponibles en la web. Las herramientas de administración de identidades y pagos ajenas a estos siete bloques no se han trasladado.

Las escrituras remotas del Manager requieren el dominio público exacto. La excepción `CTP_ALLOW_LOCAL_WRITES=true` está limitada a un puente de loopback para QA; no permite escribir desde localhost en Supabase PRE.

## Cambios de base de datos a coordinar

074–078 pertenecen al trabajo del equipo y sus cambios están presentes en el esquema real aunque no estén registrados en el historial CLI. **No ejecutar un `db push` ni reaplicarlas.** La comparación de trece funciones confirma doce definiciones idénticas y los trece contratos de parámetros y retorno compatibles. La única diferencia encontrada es el texto de bienvenida de `handle_new_user`: PRE todavía menciona Battle.net, mientras el código 074 menciona ActivisionID. Las estructuras, la vista pública y los controles de identidad de club coinciden. Es un ajuste de texto a coordinar, no una razón para repetir las migraciones. Informe: `validation.local/preexisting-migrations-comparison.json` del backend.

La consulta remota adicional de las 10:09 UTC confirma las tres políticas de Storage modificadas por 076/078 y el trigger activo de alta de usuarios. No se han subido imágenes ni creado usuarios para esta comprobación. Antes de reconciliar el historial, confirmar con el compañero cómo aplicó los cambios; no marcar migraciones automáticamente.

074 retira las columnas y la tabla antiguas de Battle.net. En este proyecto esas estructuras ya no existen: no puede hacerse ahora un archivo anterior ni afirmar que los datos antiguos se han conservado. Su recuperación, si se necesita, depende de una copia previa del compañero. Esta revisión no ha eliminado ningún dato remoto.

Para otros entornos todavía anteriores a 074, el backend incluye `docs/sql/archive_before_074.sql` y `scripts/prepare-preserving-074.mjs`. Compone una copia operativa de 074 con el archivo dentro de la misma transacción; no cambia la migración del compañero. Conserva los campos retirados y las identidades en `ctp_migration_archive`, sin acceso para PUBLIC, anon, authenticated ni service_role. El test de actualización desde 073 confirma igualdad de datos y denegación de acceso a roles API. En el PRE actual abortaría correctamente porque esas estructuras ya no existen; **no ejecutarlo allí**.

079 incorpora el puente seguro, versiones, revisión de inscripciones, generación/publicación y corrección de estadísticas. 080 reconcilia los nombres antiguos `pick_ban` con los nombres `veto` del código PRE actual mediante renombrado en sitio; conserva filas, OID, permisos y relaciones. Si detecta simultáneamente ambas tablas, aborta en vez de elegir una o borrar datos.

El frontend de `origin/pre` `163469a` ya usa los nombres `veto_*`, incluidos suscripciones Realtime y RPC. La consulta remota confirmó que `tournament_match_pick_ban_steps` y `tournament_matches` pertenecen a `supabase_realtime`: el renombrado conserva la pertenencia por OID. Antes de publicar, comprobar que el bundle servido es esa versión; un cliente anterior que aún llame RPC `pick_ban_*` necesitaría actualizarse. No se ha certificado el código exacto de las cuatro Edge Functions ya desplegadas.

Las reparaciones de referencias en 048/052/063/069 permiten una instalación limpia coherente con 032. **No se deben reaplicar esas migraciones antiguas en PRE ni reparar su historial para fingirlo.** En una base existente la actualización se realiza con 080.

## Secuencia propuesta de publicación — requiere autorización

1. Volver a obtener `origin/pre`, revisar el diff y confirmar que nadie aplica migraciones en paralelo. Preparar commits diferenciados Manager/backend para revisión del equipo.
2. Verificar copia de Supabase restaurable y copia consistente de SQLite Manager. Registrar esquema, migraciones, conteos y checksum del paquete sin imprimir datos personales.
3. Reconciliar 074–078 con el esquema real y el compañero. Ensayar 079–080 sobre una restauración del esquema actual, comprobar conflictos de nombres y planificar su aplicación coordinada. No cambiar el historial de forma automática. Solo en entornos anteriores a 074 corresponde el archivo previo descrito arriba.
4. Instalar el puente conservando `competition_cutover_enabled=false`. La gestión existente de la web sigue disponible mientras se prepara Manager. Verificar 080 antes o aplicar la pareja en una única transacción operativa para evitar una actualización parcial. Las pruebas de compatibilidad deben conservar además los nombres de parámetros RPC usados por PostgREST; `admin_resolve_match` continúa recibiendo `p_reason`.
5. Configurar en CTP secretos nuevos dedicados: `MANAGER_INTEGRATION_TOKEN`, `MANAGER_SIGNING_SECRET` y `MANAGER_OPERATIONS_ENABLED`. Desplegar solamente `manager-operations`, con `verify_jwt=false` y autenticación privada propia.
6. Configurar las mismas credenciales exclusivamente en el servidor Manager, inicialmente con `CTP_ENABLE_WRITES=false`. Vincular UUID estables de operadores Manager a las cuentas CTP reales con los ámbitos mínimos; no reutilizar los usuarios de QA.
7. Abrir Manager local en lectura conectado al proyecto PRE y comprobar sincronización real. Para modificar desde la interfaz, instalarlo bajo `manager.playctp.com`, validar DNS, HTTPS, proxy y cookies, y activar escrituras deliberadamente. Solo con staff y operaciones comprobados se activa la gestión exclusiva mediante la RPC privada de corte; debe coordinarse con el equipo.
8. Ejecutar una prueba coordinada en un torneo PRE identificado como prueba: validar inscripción, preparar/enviar cambio, comprobar una versión obsoleta, una denegación de rol y el mismo comando repetido. No usar partidos reales para probar.

Si falla la comprobación después del corte, restaurar primero las concesiones anteriores mediante `manager_set_competition_cutover(false, motivo)` y comprobarlas; después desactivar las escrituras y la función. No revertir migraciones borrando nuevas tablas ni restaurar una copia sobre datos posteriores sin coordinación. Conservar comandos y revisiones para resolver cualquier confirmación pendiente; reintentar con el mismo identificador evita duplicar efectos.

## Evidencia local

- Suite completa Manager: 111 pruebas aprobadas y compilación de producción correcta.
- Compatibilidad con PRE: restauración local de su esquema público exacto, sin repetir 000–078, seguida de 079–080 y pruebas SQL de staff/jugadores. Informe: `validation.local/pre-schema-upgrade-result.json`. El archivo de esquema tiene SHA256 `e27aa8f0a89fe49aff92dfbfff45d53edcbb0306351ededbd9c5b1771195db68`; no contiene filas de los usuarios.
- Puente CTP: pruebas de protocolo/firma y suite SQL sobre migraciones 000–080, con autenticación, revocación, protección de versiones, idempotencia y acciones de jugadores.
- Protocolo y motor: 15/15 pruebas. Permisos adversariales: 7/7 sobre 079 SHA256 `10255ccfd33f6d771f1456cdf94ce8b6f7b50ce86170809b4920199889a8142e`; restauración exacta tras dos ciclos, permisos heredados, grant options y abortos con rollback ante concesiones personalizadas o por columna. Informe backend `validation.local/manager-cutover-acl-result.json`.
- `scripts/test-signed-ctp-flow.mjs`: flujo HTTP real Manager → firma → protocolo de la Edge Function → PostgreSQL aislado. Resultado: `output/signed-flow-result.json`.
- Flujo comprobado: rechazo de no-staff, restricción de producción, lectura y paginación, creación y edición con envío explícito, rechazo de versión antigua, aprobación de inscritos, generación, publicación, reprogramación y corrección de ocho estadísticas con aprobación por otra identidad.
- Ese flujo HTTP completo se ha repetido con el corte exclusivo activado **solo en la base aislada**, verificando su estado a través de la API Manager. La previa local de revisión en `http://localhost:3229` muestra un aviso permanente de QA y no usa credenciales ni filas de PRE.
- Navegador: coordinación, árbitro y producción; disponibilidad, solapes, sustitución, navegación, filtros, móvil y envío de una reprogramación desde su formulario. Evidencias en `output/playwright/`.
- Prueba 080 sobre nombres antiguos: 173 filas en 65 tablas y 11 funciones heredadas preservadas; OID, ACL, RLS, políticas y triggers conservados; segunda ejecución idempotente y conflicto abortado sin pérdida. Informe backend: `validation.local/veto-identifiers-upgrade.json`.
- Revisión remota de solo lectura: 19 usuarios, 8 equipos, 27 torneos, 11 partidos y 16 filas de roster. Sin referencias huérfanas en los cuatro cruces comprobados. Hay cero estadísticas y cero vínculos de operadores Manager. Esta evidencia no equivale a certificar todos los flujos de la web.
- Typecheck Deno y empaquetado de la función con su motor compartido aprobados. El código original, con seis hashes coincidentes, también arranca en Supabase Edge Runtime real aislado: responde 401 sin autorización, 403 a petición de navegador con Origin, 503 si está desactivado y 405 a un método incorrecto. Evidencia `validation.local/edge-manager/runtime-result.json`. El ESZIP anterior de validación offline no es un artefacto de despliegue; esta prueba no certifica ejecución de Edge en PRE.

Estas pruebas no certifican todavía DNS/TLS de la VPS, una conexión remota PRE ni credenciales desplegadas. Esas comprobaciones corresponden a los pasos autorizados de publicación.
