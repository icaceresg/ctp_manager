# Imágenes web y escudos — candidata DEV

Las fotos se eligen en su formato de origen y se preparan localmente como WebP.
Los escudos de equipos son la excepción: se exige un PNG con transparencia real.
No se cambia ni elimina ninguna imagen ya guardada.

## Fotos de mapas y banners

- El selector admite PNG, JPEG, WebP, GIF, BMP y AVIF. La fuente debe poder
  decodificarse en el navegador; no se promete compatibilidad directa con HEIC.
- Límite de origen: 12 MB, 24 megapíxeles y 12.000 píxeles por lado. Se comprueban
  las cabeceras y los límites antes de decodificar, también en AVIF/BMP, y después
  se comprueban las dimensiones reales del bitmap.
- GIF se aplana a su primera imagen. Se rechazan APNG, WebP/AVIF animados y SVG.
- Mapas: hasta 1600×1200, sin ampliar. Banners: recorte central de proporción
  1600×600, sin ampliar una fuente pequeña. Canvas aplica la orientación EXIF.
- WebP de hasta 2 MB, con MIME y bytes verificados. Si el navegador no codifica
  WebP, se utiliza un encoder WASM local en un worker servido por CTP. La imagen
  no se manda a ningún servicio externo y no se disfraza un PNG como WebP.
- Un WebP ya ajustado evita la recodificación y elimina EXIF/XMP. El canvas y
  la nueva codificación no conservan los metadatos de la cámara.

## Escudos de equipos

- La entrada debe ser realmente PNG, no un JPEG/WebP renombrado. Hasta 512×512,
  conservando proporción y sin ampliar; salida PNG, nunca WebP.
- Los píxeles decodificados deben contener parte visible y al menos un píxel
  completamente transparente en el borde exterior. Un PNG opaco, vacío o con
  transparencia sólo en un agujero interior se rechaza antes de subir.
- La vista previa usa cuadrícula de transparencia. No se elimina el fondo
  automáticamente: un borde transparente no demuestra que todo fondo residual
  haya desaparecido; el staff debe revisar visualmente el resultado.
- Manager vuelve a comprobar el PNG normalizado en el servidor, antes del puente
  privilegiado. El módulo compartido valida CRC, estructura, final, inflación
  acotada y los cinco filtros PNG; comprueba los píxeles, no sólo el canal alfa.
- CTP mantiene la validación autoritativa para impedir saltarse el formulario.

## Compatibilidad y límites de publicación

El editor de correo conserva sus formatos existentes, incluida la elección de
PNG/JPEG para compatibilidad con clientes de correo; no se fuerza WebP allí.
Los banners JPEG históricos siguen siendo válidos al editar otra propiedad.
Las nuevas subidas de banner se generan como WebP; los logos nuevos siguen PNG.

Manager debe publicarse junto al contrato CTP de imágenes/logos **361** o después
de éste. Esta rama es DEV: no autoriza publicar PRE/PROD, limpiar imágenes reales
ni hacer subidas con cuentas alojadas. La base DEV compartida estaba inactiva;
las comprobaciones de esta candidata usan fixtures locales y no acreditan un
flujo autenticado de jugador.

## Evidencia local de esta candidata

- Suite Manager: 617 pruebas, 612 correctas, 5 omitidas, 0 fallos; build correcto.
- Tres comprobaciones Python de tráfico, observador y publicador correctas.
- UI real en Chrome, API local interceptada: PNG opaco y JPEG disfrazado rechazados
  sin subida; PNG transparente conservado con vista previa cuadriculada; JPEG
  convertido realmente a WebP. Prueba a 390 px sin desbordamiento.
- Encoder WASM real comprobado con el encoder nativo forzado a devolver PNG;
  salida WebP real, transparencia conservada y cero peticiones externas.
- No se crearon cuentas ni subidas alojadas. Safari físico y cámara móvil no
  comprobados. Los navegadores y el servidor efímero propios se cerraron.

Recibos: `D:/CTP/output/manager-photos-logos-dev-20261104/` y
`D:/CTP/output/webp-wasm-dev-20261104/browser-result.json`.
