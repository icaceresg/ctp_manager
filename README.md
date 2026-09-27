# CTP Manager

Intranet privada del equipo de **Connect To Play** para organizar el contenido de **Instagram, X, TikTok y YouTube**, las escaletas, los recursos, la disponibilidad del equipo y las tareas de dirección. No publica nada en las redes: es el espacio de trabajo para planificar qué se sube, cuándo, quién lo prepara y qué hace falta.

## Qué puedes hacer

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
- Cada persona entra con su **usuario y contraseña**. No hay registro abierto: las cuentas las crea un administrador.
- El **Administrador** ve todas las secciones y gestiona usuarios y roles.
- Los **roles** (de partida *RRSS*, *CASTER* y *ÁRBITROS*) desbloquean secciones. El administrador decide cuáles en *Usuarios y roles → Roles y permisos*, y puede crear roles nuevos. Una persona puede tener varios roles.
- Roles de partida:

  | Rol | Secciones |
  | --- | --- |
  | RRSS | Calendario, Recursos |
  | CASTER | Escaleta, Disponibilidad |
  | ÁRBITROS | Escaleta |
  | DIRECTIVOS | Tablero |

- Quien solo tiene *Recursos* puede marcar recursos como listos, pero no crear ni editar tarjetas.
- Si desactivas a alguien o le cambias la contraseña, sus sesiones abiertas se cierran al momento.
- Cada usuario puede cambiar su contraseña en *Mi cuenta*.

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

Todo se guarda en la carpeta `data/` del proyecto (una base de datos SQLite), solo en este ordenador. Para hacer una copia de seguridad, copia esa carpeta. Las contraseñas se guardan cifradas (scrypt) y no se pueden recuperar, solo cambiar.

La app no hace ninguna petición a servicios externos (las tipografías van incluidas) y pide a los buscadores que no la indexen.

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
