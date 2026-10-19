# CTP Pro View en Manager

Manager prepara y publica la configuración de la página pública `/live` desde
**Preparación de directos** (`/operaciones/realizacion`). CTP Panel mantiene el
control de OBS. No se cambia ninguna escena, cámara o configuración de OBS desde
esta sección.

## Operación

1. Actualizar la conexión CTP para recibir la capacidad `pro_view.configure`.
2. En **Partido y sincronización**, elegir un encuentro publicado, una sala de
   datos opcional y el nombre del canal de Twitch.
3. Indicar el retraso total de los datos y qué parte corresponde a producción
   (OBS). El resto es el margen previsto para la reproducción de Twitch.
4. Preparar y enviar la propuesta. La preparación se guarda en el registro local;
   solo una confirmación de CTP aplica el cambio oficial.
5. Preparar **Publicar** y enviar. CTP captura y libera las versiones de datos
   desde el servidor. No se necesita publicar cada marcador manualmente.
6. Pausar o finalizar mediante el mismo procedimiento cuando corresponda.

La latencia real del reproductor puede variar entre espectadores. Hay que
comprobar el directo antes de fijar el margen. El editor muestra la revisión de
configuración y los tiempos de la última entrega pública; no promete sincronía
perfecta de vídeo. El retraso total admite 0–900 segundos, siempre igual o mayor
que el de producción.

Las estadísticas aprobadas de mapa son datos oficiales revisados, no telemetría
instantánea de bajas. La sala es opcional: sin ella se usan datos oficiales. Sus
claves y las credenciales de Twitch nunca se envían al navegador del editor.
La **Sala de emisión de CTP** aporta el marcador y el mapa provisionales que
estén guardados en ese registro; el acta conserva el resultado competitivo
oficial. Seleccionar una sala no acredita que el HTML externo de CTP Panel esté
conectado: la integración de ese archivo y su alimentación requieren su propia
comprobación. Manager no crea un segundo marcador ni otro controlador OBS.

## Permisos y entrega

Las rutas requieren sesión staff y sección `realizacion`, o administración. El
puente CTP verifica además la identidad vinculada y el ámbito `broadcast.manage`.
La configuración del servidor debe habilitar escrituras explícitamente. El
origen del navegador por sí solo no concede autoridad.

No existe una pantalla para conceder ámbitos del puente. La activación inicial
se realiza como una operación administrativa privada y dirigida en PRE, después
de aplicar la migración compatible de CTP. Antes de conceder `broadcast.manage`:

1. Identificar al staff concreto en CTP (`admin` o `referee`) y su vínculo
   canónico existente `ctp:<UUID>`, creado por su propio inicio de sesión.
2. Comprobar que el vínculo está habilitado y conserva ámbitos efectivos. Un
   vínculo deshabilitado o con ámbitos vacíos exige revisar su revocación; no se
   reactiva como consecuencia de desplegar Pro View.
3. En una transacción privada, bloquear ese vínculo, añadir únicamente
   `broadcast.manage` si falta y conservar todos los demás ámbitos. Registrar el
   administrador que concede el acceso y el cambio en la auditoría CTP. No usar
   una actualización global ni reemplazar la lista completa por los permisos
   predeterminados de un administrador.
4. Verificar que la comprobación de identidad CTP conserva esa concesión
   explícita. La migración de CTP debe permitirla sin concedérsela
   automáticamente a otros vínculos. En Manager, asignar además la sección
   `realizacion` al staff que prepare las emisiones.

No se conceden estos permisos desde una llamada del navegador ni introduciendo
un ID de jugador en el editor. La activación privada y la publicación de una
emisión son operaciones distintas.

Un operador de producción solo puede enviar sus propias propuestas; un
administrador puede reenviar la de otro operador siempre que su autor conserve
su permiso. Los cambios de permisos invalidan las sesiones. El autor original
se conserva en la firma del envío, también cuando lo reenvía administración.

Las propuestas usan revisión de configuración independiente de las capturas
automáticas. Un cambio concurrente devuelve conflicto sin sobrescribir al otro
operador. Un envío sin confirmación conserva el identificador y debe
reintentarse; no se puede descartar una entrega ambigua.

## Contrato del puente

Lectura privada firmada:

```json
{ "action": "pro_view_state", "actor_id": "identidad-vinculada-del-operador" }
```

Respuesta: el sobre normal `{ "ok": true, "data": ... }`, con `revision`,
`channel`, `delaySeconds`, `productionDelaySeconds`, `matchId`, `roomId`,
`enabled`, `status`, `lastErrorCode`, `matches`, `rooms` y `publicPreview`.
La proyección local elimina cualquier otro campo. Las listas admiten como
máximo 100 elementos cada una.

Escritura privada firmada a través del registro de comandos:

```json
{
  "action": "pro_view_configure",
  "actor_id": "identidad-vinculada-del-operador",
  "commandId": "uuid-idempotente",
  "expectedRevision": 1,
  "settings": {
    "channel": "playctp",
    "delaySeconds": 30,
    "productionDelaySeconds": 0,
    "matchId": null,
    "roomId": null,
    "enabled": false,
    "status": "standby"
  }
}
```

Confirmación requerida: `{ "applied": true, "commandId": "mismo-uuid",
"revision": 2 }`. Un UUID ya aplicado devuelve la misma confirmación, sin aplicar
el cambio otra vez.

Rutas locales:

- `GET /api/operations/pro-view`
- `POST /api/operations/pro-view/commands`
- `POST /api/operations/pro-view/commands/:id/send`
- `POST /api/operations/commands/:id/cancel` para propuestas descartables

El tipo local es `pro_view.configure`; el recurso local tiene el UUID estable
`00000000-0000-4000-8000-000000000001`. Ese recurso es una proyección y un registro
de entregas, no otra base competitiva oficial.

## Validación local

`test/pro-view-contract.test.js` y `test/pro-view-flow.test.js` cubren límites,
proyección sin secretos, sala ajena o caducada, revisión concurrente, permisos
multicuenta, firma privada, preparación sin publicación, pérdida de confirmación,
reintento idempotente y retirada de permisos. El puente de esas pruebas es local
y simulado: no acreditan un despliegue ni la latencia de una emisión real.

La prueba adicional `scripts/test-pro-view-stack.mjs` recorre Manager por HTTP,
el protocolo firmado real, el nonce real de PostgreSQL, las RPC de publicación y
la proyección pública anónima. Se limita al contenedor Docker local
`ctp-review-db-20261002` y a la base de fixtures
`ctp_pro_view_manager_e2e_20261019`; no admite otro destino. Preparar esa base
como copia aislada de `ctp_pro_view_preview_20261019`, que contiene el fixture
de 17 clubes de CTP. Nunca reutilizar una base de PRE o producción.

```powershell
node scripts/test-pro-view-stack.mjs "D:\CTP\worktrees\ConnectToPlay-pre-integration"
```

La prueba actualiza solo las definiciones de funciones de la migración 174 en
esa copia, crea dos cuentas locales temporales y concede el ámbito a un actor
de pruebas exclusivamente dentro de la base aislada. Comprueba espera del
retraso, roster, estadísticas, grupos, bracket, pausa completa, cambios privados
durante la pausa, reanudación atómica, finalización y reintento tras perder un
ACK. Guarda el recibo y el SHA de la migración en
`output/pro-view-20261019/manager-real-stack-receipt.json`. Manager temporal se
detiene al terminar; la base de fixtures permanece para inspección.
