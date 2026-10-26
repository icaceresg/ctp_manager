# CTP Manager

Backoffice privado de **CTP** para el staff, la gestión de competición y el arbitraje. Su objetivo es reunir el trabajo interno del equipo sin obligar a realizarlo desde la web de jugadores. Conserva también el calendario editorial, las escaletas, los recursos, la disponibilidad y el tablero de dirección.

El [centro operativo](docs/OPERATIONS_IMPLEMENTATION.md) reúne la jornada, el equipo, los expedientes y la preparación de contenidos, con conexión privada a CTP. La [activación en VPS](docs/DEPLOYMENT.md) y las escrituras externas requieren configuración explícita. No publica automáticamente en redes.

Desde el 20 de octubre de 2026, el dominio público de Manager apunta a **producción**. El [runbook de producción y staff](docs/MANAGER_PRODUCTION_2026-10-20.md) recoge los servicios separados, los respaldos y las condiciones para conservar este despliegue. Las referencias a PRE del 15 de octubre son históricas.

## Reparto entre las tres herramientas

- **Web CTP general:** interfaz de jugadores y clubes para participar, consultar calendario y resultados, aportar evidencias, abrir disputas y recibir notificaciones. El backend CTP compartido mantiene los datos y las reglas oficiales que utilizan ambas interfaces.
- **CTP Manager:** interfaz exclusiva de staff para competición, arbitraje, validaciones, resoluciones, sanciones y asignación de personas, además del trabajo editorial y de preparación. Incluye gestión local de torneos, inscripciones, formatos y calendario mediante comandos al backend compartido. Su uso oficial requiere que el entorno remoto anuncie las capacidades y confirme cada decisión. SQLite conserva trabajo interno y proyecciones, no una segunda base competitiva oficial.
- **CTP Panel** es el dock HTML externo que controla la emisión en el PC de realización. Según la descripción facilitada por el equipo, gestiona tarjetas, marcador en emisión, mapas, descansos, casters y cámaras mediante OBS WebSocket y `BroadcastChannel`. Ese HTML no está disponible en este workspace y su funcionamiento no se ha verificado aquí.

En Manager, **Dossier** reúne el contexto aprobado para casters y **Preparación** vincula partido, escaleta y notas del equipo. Sus estados son coordinación manual: «En preparación», «Preparado», «En seguimiento», «Seguimiento en pausa» y «Cerrado» no confirman ni cambian el estado de OBS.

**Preparación** incluye además el editor de [CTP Pro View](docs/PRO_VIEW.md): selecciona el encuentro y el canal, configura el retraso de los datos y prepara su publicación para espectadores. Esta capacidad requiere que el puente CTP la anuncie y confirme cada cambio; las salas se identifican sin exponer sus claves. CTP Panel conserva el control de OBS.

Debe mantenerse un único Panel por emisión. Manager no abre otra instancia del Panel ni emite estado de overlay ni configura OBS. El [agente OBS anterior](docs/OBS_AGENT.md) se conserva como código histórico desactivado, fuera del flujo de uso actual. La futura alimentación de datos al Panel requiere acordar y probar su contrato JSON; aún no hay un endpoint ni una conexión Panel implementados en Manager. La [matriz funcional](docs/OPERATIONS_IMPLEMENTATION.md#propiedad-funcional-y-alcance-real) distingue las funciones actuales del traslado pendiente de herramientas de staff.

## Qué puedes hacer

### Competición y staff

- **Mi jornada:** tareas según rol, turnos propios por confirmar, expedientes y cobertura del equipo.
- **Planificador:** semana, búsqueda y filtros, candidatos disponibles y turnos. Coordinación puede sustituir o reprogramar con motivo; el servidor comprueba permisos, disponibilidad y solapamientos y pide nueva confirmación al asignado.
- **Incidencias:** bandeja por responsable, prioridad y estado, búsqueda, notas privadas, conversación CTP y resoluciones.
- **Torneos:** crear y editar, gestionar estados, revisar inscripción y roster, consultar puntos y seed oficiales, generar cruces con el motor CTP, publicar fases y reprogramar partidos. Los cambios quedan como propuestas hasta la confirmación remota.
- **Estadísticas:** aprobar/rechazar y preparar correcciones justificadas de ocho jugadores, con historial por partido. La corrección crea otra revisión pendiente y exige un revisor distinto; conserva las cifras originales.
- **Sanciones:** quién está sancionado ahora, cuánto le queda y por qué; buscador de todas las cuentas de CTP con su historial disciplinario; suspensiones temporales (Ranked, retos, inscripción en torneos), amonestaciones con mensaje para el jugador, revocaciones, recursos y levantamiento de bloqueos de Ranked. Se aplican al momento en CTP y el jugador recibe el aviso.
- **Decisiones:** revisar propuestas junto a su expediente o desde la bandeja común. Solo administración envía a CTP; no se confunde una solicitud con un cambio aplicado.
- **Histórico:** búsqueda remota por tipo y fechas, páginas y detalle, incluso fuera de los partidos de la jornada.

La [recepción QA de PRE del 15 de octubre](docs/MANAGER_PRE_QA_2026-10-15.md) es histórica. El dominio público usa ahora las cuentas y los datos oficiales de producción; el estado de PRE permanece separado. Cada cambio competitivo requiere una propuesta, envío explícito de administración y confirmación del backend; abrir o guardar un formulario no aplica la decisión. OBS permanece desactivado.

### Calendario de contenido
- Vista **mensual** y **semanal**. Haz clic en un día para crear una publicación o arrastra una tarjeta para cambiarla de día.
- **Tarjetas de publicación** con:
  - título, estado (🔴 *No listo → 🟡 En revisión → 🟢 Listo → 🔵 Publicado*) y responsable (Diseño, Edición, RRSS…);
  - las redes en las que va (IG, X, TikTok, YouTube), cada una con uno o varios formatos (p. ej. Instagram: Carrusel + Story);
  - fecha y hora opcionales;
  - qué se va a publicar, el copy (con contador de caracteres para X e Instagram) y notas;
  - la lista de **recursos necesarios**, que puedes marcar como listos.
- Panel de **ideas sin fecha**: guarda ideas y arrástralas al calendario cuando decidas cuándo publicarlas, o arrastra una tarjeta al panel para quitarle la fecha.
- Filtros por red social, estado y responsable.

### Escaleta
- Guion por partes de un directo o vídeo: título, duración, contenido y notas de cada parte.
- Calcula sola el **minuto de inicio** de cada parte y la **duración total**.
- Guardado automático. Puedes reordenar las partes arrastrándolas o con las flechas.
- Vista **Ver** en formato tabla, lista para **imprimir** o guardar como PDF.
- Varias escaletas, con fecha opcional (aparecen en el calendario).

### Recursos
- Todos los recursos de todas las publicaciones, agrupados por publicación y con su progreso.
- Filtros por periodo (próximos 7 o 30 días, siempre con lo atrasado, o todo), por responsable y por pendientes/todos.

### Disponibilidad
- Se pide solo para los **días de evento** de la temporada 2026/27: Inaugural (8 nov), Majors (20 dic, 28 feb, 25 abr, 20 jun), Freakcom con Cup (21–24 may) y LAN Champ (1–5 jul). Los días previos o posteriores a cada evento aparecen entre paréntesis.
- Cada persona con la sección (de partida, el rol **CASTER**) responde **Disponible** o **No disponible** en cada día y puede añadir una nota (p. ej. "solo por la tarde").
- Vista **Equipo**: una tabla con las personas y los días agrupados por evento, con cuántas están disponibles cada día. Los días con escaleta (directos) se marcan con una línea dorada.
- Cada persona solo cambia su propia disponibilidad. El administrador ve y edita la de todos, y gestiona los días en el botón **Días de evento**.

### Tablero (Directivos)
- Tablero tipo Trello con **listas** (de partida: Por hacer, En curso, En revisión, Hecho) y **tarjetas** que se arrastran entre listas y dentro de la misma lista. Las listas también se reordenan arrastrando su cabecera, y se crean, renombran (clic en el nombre) y borran.
- Cada tarjeta tiene descripción, **etiquetas** de colores (Urgente, Importante, Evento, Patrocinio, Contenido, Equipo; el nombre de cada color se cambia en *Etiquetas*), **personas** asignadas, **fecha límite** (que se puede marcar como completada), **checklist** y **comentarios**.
- En la tarjeta cerrada se ve de un vistazo: etiquetas, fecha (en rojo si ha vencido, en ámbar si vence en 2 días, en verde si está completada), progreso de la checklist, comentarios y personas.
- Filtros por persona ("Mis tarjetas") y por etiqueta.
- Lo usan el rol **DIRECTIVOS** y los administradores. Cada uno borra sus comentarios; el administrador, cualquiera.

### Usuarios y roles
- En el despliegue público (`CTP_AUTH_MODE=ctp`) el staff entra con **el mismo correo y contraseña de CTP**. No necesita otra cuenta: CTP verifica su rol y Manager conserva un espejo sin contraseña. La identidad y contraseña se gestionan en CTP; aquí solo se organizan las secciones internas y el acceso a Manager.
- El modo local independiente (`CTP_AUTH_MODE=local`) se conserva exclusivamente para desarrollo y pruebas. En ese modo las cuentas las crea un administrador.
- El **Administrador** ve todas las secciones y gestiona usuarios y roles.
- Los **roles** de staff desbloquean secciones y deben tener una categoría explícita de coordinación, arbitraje, producción, caster, comunicación, clubes o dirección. Los roles sin categoría de staff y las cuentas de jugadores no conceden acceso a Manager. El administrador decide secciones y categorías en *Usuarios y roles → Roles y permisos*.
- Roles de partida:

  | Rol | Secciones |
  | --- | --- |
  | RRSS | Calendario, Recursos, Comunicación, Disponibilidad |
  | CASTER | Escaleta, Disponibilidad, Dossier |
  | ÁRBITROS | Arbitraje, Disponibilidad |
  | PRODUCCIÓN | Preparación, Escaleta, Disponibilidad |
  | COORDINACIÓN | Operaciones, Disponibilidad, Tablero |
  | CLUBES | Revisión de clubes |
  | DIRECTIVOS | Tablero, Operaciones |

- Quien solo tiene *Recursos* puede marcar recursos como listos, pero no crear ni editar tarjetas.
- Si desactivas a alguien o le cambias la contraseña, sus sesiones abiertas se cierran al momento.
- En *Administración CTP → Usuarios CTP* un administrador puede **eliminar una cuenta de jugador** escribiendo su nombre para confirmar. Sin historial compartido, la cuenta desaparece del todo; con partidas, resultados o pagos, se borran el acceso y los datos personales y queda anónima como «Cuenta eliminada» para no alterar a otros jugadores. Staff y líderes de club con más miembros no se eliminan desde aquí.
- En modo público, *Mi cuenta* enlaza a la cuenta CTP para gestionar la contraseña. El formulario local solo aparece en desarrollo.

### Ruleta del directo (ruleta.playctp.com)

- Sorteo pensado para el stream: en un búnker 3D al estilo de los mapas de zombies, con la marca PlayCTP en las paredes, una máquina de chicles suelta chicles con nombres, entran en la caja misteriosa y de ella salen nombres cada vez más despacio hasta que se queda uno (~45 s). Música y efectos sintetizados en el navegador, sin derechos de autor.
- Participan **las personas registradas en PlayCTP**, leídas por el puente firmado (`admin_query` → `users`): solo identificador, nombre y rol. Cargar o actualizar la lista requiere administración CTP; se guarda en el Manager para que el resto del staff pueda sortear con la última copia. Sin puente (desarrollo local) entran los usuarios del Manager.
- Solo entra el staff de Manager, con la misma cuenta. `ruleta.playctp.com` tiene su propia cookie `__Host-` y solo expone su página, el login y `/api/ruleta/*`: el resto de la API no existe en ese host.
- El ganador lo elige el servidor (`crypto.randomInt`) y cada sorteo queda en *Últimos sorteos*. Teclas: **Espacio** gira, **H** modo stream, **F** pantalla completa, **M** silencio.
- Audios propios opcionales: deja los archivos (`.mp3`, `.ogg`, `.wav` o `.m4a`) en `client/public/ruleta-media/zombies/` con un `manifest.json` como `{"zombies": ["grito-1.mp3", "grito-2.mp3"], "roundStart": "ronda.mp3"}`. Los zombis suenan al azar antes y después del sorteo, y `roundStart` al empezarlo. Sin manifiesto se usan los zombis sintetizados. Usa solo audios con permiso para publicarlos.
- En local: <http://localhost:3210/ruleta>. Despliegue: [infra/vps/README.md](infra/vps/README.md#ruleta-ruletaplayctpcom).

## Instalación

1. Instala [Node.js](https://nodejs.org) 22 o superior (probado con Node 24).
2. Haz doble clic en **`Iniciar CTP Manager.bat`**. La primera vez instala las dependencias, luego compila la interfaz y abre el navegador en <http://localhost:3210>.
3. En una instalación nueva, la primera pantalla crea la cuenta del administrador.

También puedes arrancarla desde una terminal:

```bash
npm install
npm start
```

De momento la app solo acepta conexiones desde este ordenador (`localhost`). Para abrirla a la red de la oficina o a internet habrá que añadir HTTPS y cambiar la configuración de red.

### ¿Olvidaste la contraseña del administrador?

Desde una terminal en la carpeta del proyecto:

```bash
npm run nueva-contrasena -- admin
```

Te pedirá la contraseña nueva dos veces, sin mostrarla en pantalla. Sirve para cualquier usuario: cambia `admin` por su nombre de usuario.

## Importar el calendario desde Excel

Las piezas de la hoja de calendario de un Excel con el formato del *CTP · Calendario de contenido* (columnas Nº, Fecha, Hora, Pieza, Redes, Contenido / brief, CTA, Formatos a exportar, Plantilla master, Ayuda Envato, Responsable, Estado…) se importan así:

```bash
npm run importar -- "C:\ruta\CTP_Calendario_Contenido_2026_27.xlsx" --prueba
```

`--prueba` solo muestra lo que haría. Sin `--prueba` importa de verdad (antes guarda una copia de la base de datos en `data/copias`). Cada pieza pasa a ser una tarjeta:

- **Brief y CTA** → "¿Qué se va a publicar?".
- **Evento, Season, T y Entrega a revisión** → notas.
- **Plantilla master, Envato y cada formato a exportar** → recursos necesarios (marcados como listos si la pieza tenía "Realizado ☑").

Volver a importar el mismo archivo no duplica nada: solo añade las piezas nuevas. Con `--actualizar` también sobrescribe las ya importadas con lo que diga el Excel, pero sin desmarcar los recursos que ya marcaste como listos en la app.

## Tus datos

La organización interna se guarda en la carpeta `data/` del servidor Manager (SQLite). Cuando se configura el puente CTP, también se conserva una proyección de sus datos; CTP mantiene la fuente oficial. Para respaldar SQLite utiliza su API de backup o detén el servicio antes de copiar la carpeta, como explica [DEPLOYMENT.md](docs/DEPLOYMENT.md). Las contraseñas se almacenan mediante hash scrypt y no se pueden recuperar, solo cambiar.

Las tipografías van incluidas y se pide a los buscadores que no indexen la intranet. Sin configurar el puente no se realizan consultas a CTP. Cuando está configurado, el servidor Manager sincroniza datos y, solo con escrituras habilitadas y envío explícito autorizado, solicita acciones oficiales. Las credenciales del puente permanecen en el servidor.

## Configuración opcional

Copia `.env.example` como `.env` para cambiar el puerto (`PORT`, 3210 por defecto) o la carpeta de datos (`DATA_DIR`).

## Desarrollo

```bash
npm run dev    # servidor con recarga automática + interfaz en http://localhost:5173
npm test       # pruebas automáticas
```

Estructura:

```
server/          API (Express + SQLite integrado en Node)
  auth.js        inicio de sesión, sesiones y permisos por sección
  users.js       gestión de usuarios y roles
  contents.js    tarjetas de contenido y sus recursos
  rundowns.js    escaletas y sus partes
scripts/
  import-excel.js     importador del calendario en Excel
  reset-password.js   recuperación de contraseñas
client/          interfaz (React + Vite), con los colores y tipografías de connecttoplay.es
shared/          secciones y roles, catálogo de redes, formatos y estados
test/            pruebas de extremo a extremo
```

Para añadir redes, formatos o estados, edita `shared/catalog.js`. Para añadir secciones nuevas, `shared/access.js`.
