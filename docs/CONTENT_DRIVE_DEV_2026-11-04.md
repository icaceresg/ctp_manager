# Material de Drive por publicación — DEV

Base: Manager PRE `a7cdcc202dd3e627ed5e908747cf926c6e1e04cc`.
Esta ampliación no está publicada en PRE ni en PROD.

## Uso

El editor del calendario conserva un enlace opcional de Google Drive por
publicación. El enlace aparece también en Recursos, aunque no haya tareas en
el checklist. Las tarjetas semanales y las ideas indican si tienen material
en Drive.

«Abrir en Drive» abre el archivo, carpeta, documento, hoja o presentación.
Para enlaces de archivo de Drive se ofrece «Descargar en Drive»: es un intento
de descarga en el navegador, sujeto a que Google permita el acceso y, en su
caso, pida iniciar sesión o confirmar. No se ha probado una descarga real de
un archivo autorizado. Las carpetas y documentos de Google se abren allí para
elegir la descarga; no se inventa un formato de exportación.

## Datos y límites

- `contents.drive_url` es una columna SQLite aditiva con valor vacío por defecto.
  No modifica tarjetas anteriores ni requiere cambios en CTP.
- Se guardan únicamente enlaces HTTPS canónicos a los hosts exactos de Drive
  y Documentos. Se conserva `resourcekey`, se quita navegación/tracking y se
  rechazan credenciales, controles, puertos y destinos ambiguos.
- Un PUT de un cliente anterior que omite `drive_url` conserva su valor.
  Un valor vacío explícito lo borra. Cambiar fecha/estado no lo altera y una
  copia de la publicación hereda su enlace.
- Se mantienen los permisos actuales de Calendario y Recursos. Manager no
  cambia permisos de Google, no solicita tokens, no precarga archivos ni
  descarga o almacena material en la VPS. No hay proxy ni peticiones de servidor
  a la URL guardada.

Google documenta las descargas de navegador mediante `webContentLink` obtenido
por su API y las exportaciones de documentos por separado. El intento de
descarga usado aquí no consulta esa API ni garantiza que una URL compartida
se pueda descargar. Referencias oficiales revisadas:
[descargas](https://developers.google.com/workspace/drive/api/guides/manage-downloads),
[claves de recurso](https://developers.google.com/workspace/drive/api/guides/resource-keys),
[descarga desde Drive](https://support.google.com/drive/answer/2423534?hl=es).

## Comprobaciones locales

- API HTTP real con SQLite temporal propia: 31 pruebas correctas, incluida
  persistencia/canonicalización, migración de una tarjeta antigua, omisión y
  borrado del enlace, copia, cambios rápidos y permisos editoriales.
- Helper y JSX de enlaces reales: 11 pruebas correctas con URLs sintéticas;
  no se consulta Google.
- JSX real del editor y Recursos: 3 pruebas correctas, incluidos material sin
  checklist y enlace inválido. No acreditan una interacción en navegador.
- Build correcto. La primera suite completa tuvo un fallo en el archivo
  existente `user-profile-route.test.js` sin diagnóstico interno; ese archivo
  pasó después de forma aislada (2/2). Suite completa serial: 589 pruebas,
  584 correctas, 0 fallidas y 5 omitidas por sus condiciones habituales.
  No se atribuye el fallo inicial a una causa no demostrada.

Logs locales privados en `D:/CTP/output/manager-content-drive-dev-20261104`.
No se ha arrancado ni modificado el backend o almacenamiento DEV compartido.
