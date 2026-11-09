# Retrospectivas del staff

Herramienta interna del Manager para revisar un evento y convertir las
observaciones en mejoras con responsables. No modifica torneos, resultados,
inscripciones, pagos ni datos de jugadores de CTP.

## Trabajo del equipo

- Todo el staff autorizado puede consultar, aportar, comentar y apoyar prioridades.
- Coordinación, dirección y administradores pueden crear la retrospectiva,
  cambiar su fase, asignar acciones y guardar las conclusiones.
- El panel separa lo que conviene mantener, lo que hay que corregir y las ideas.
  Las áreas, el impacto, la búsqueda y los apoyos permiten preparar la reunión.
- El plan de acción tiene responsable, prioridad, fecha objetivo y estado.
  Cada responsable puede actualizar el avance de sus acciones.
- La fase de revisión bloquea nuevas aportaciones y su edición. El cierre
  conserva la consulta y permite continuar el seguimiento de las acciones.
- Los enlaces `/retrospectivas/:retrospectiveId` abren directamente una revisión.

Para el Inaugural, el formulario de creación propone su nombre y el 8 de
noviembre de 2026. No se introducen fallos inventados ni se crea automáticamente
una retrospectiva al arrancar el servidor.

## Aportaciones anónimas

La persona elige publicar con su nombre o de forma anónima. En el segundo caso,
la aportación y sus comentarios no almacenan un autor, un identificador CTP ni
una sesión. Sus fechas se reducen al día y los DTO e informes no recuperan esa
identidad. El texto y los enlaces que escriba la persona pueden identificarla;
la interfaz lo explica antes de publicar. No se promete anonimato frente a
la infraestructura que autentica y transporta las peticiones.

Una clave aleatoria permite editar o retirar una aportación anónima desde la
pestaña donde se creó. El servidor sólo conserva su hash. El navegador guarda
la clave en `sessionStorage`, separada por cuenta, retrospectiva y aportación;
no se envía en URLs ni aparece en informes. La modalidad de autoría no puede
cambiarse después de publicar.

Los gestores pueden retirar contenido, pero no reescribir una crítica ajena.
La retirada es lógica: conserva el texto y no añade la identidad de un autor
anónimo. Sólo los gestores pueden consultar las retiradas. La exportación normal
las excluye y tampoco incluye claves, hashes, votantes ni controles de edición.

## Datos y permisos

La persistencia está en el SQLite existente del Manager. El esquema añade tablas
`retro_*` e índices de forma idempotente; no migra, vacía ni reseedea datos
existentes. No hay llamadas al bridge de escritura de CTP ni envío de avisos.

Los permisos se calculan a partir de la identidad ya admitida al Manager. Las
identidades CTP de jugador, las cuentas inactivas y los roles inventados no
pueden entrar. La lista de responsables respeta la autoridad central de CTP en
ese modo de autenticación, sin heredar permisos de roles locales antiguos.

Las operaciones validan tipos, campos, tamaños, enlaces y pertenencia al ciclo.
Los votos son idempotentes por persona. El contenido conservado de cada ciclo
tiene un presupuesto global y las consultas agrupan comentarios y votos para
evitar cargas de respuesta o consultas que crezcan sin control.

## Verificación

`npm test` ejecuta pruebas de acceso, almacenamiento SQLite, anonimato,
propiedad, fases, votos, acciones, exportación y rutas HTTP. Las pruebas usan
bases en memoria o temporales propias, nunca PRE/PROD ni el SQLite DEV compartido.

`npm run build` verifica la interfaz. La aceptación de navegador se hace en el
DEV compartido `ctp-dev-20261026`; los ejercicios con cuentas y textos QA deben
identificarse como sintéticos. Una prueba DEV no acredita publicación en PRE o
PROD. Cualquier publicación requiere la orden correspondiente del usuario.
