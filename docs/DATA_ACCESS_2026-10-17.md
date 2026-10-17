# Lecturas y paginación de Manager

Cambios locales de 17/10/2026. No publicados en PRE ni producción.

`GET /api/operations/bootstrap` recibe `view` y devuelve la proyección que necesita esa pantalla. Los listados no incluyen rosters, arrays de estadísticas ni notas de expedientes; el dossier y las cifras de un mapa se consultan al abrirlos. Las consultas seleccionan columnas y claves JSON expresas.

Los filtros de búsqueda, estado, responsable, urgencia, semana, función y cobertura se aplican en SQLite antes del límite. El tamaño predeterminado es 30 y el máximo es 100. Cada colección incluye `total`, `page`, `limit` y `has_more`. El planificador tiene páginas independientes para turnos y partidos, incluyendo los partidos sin asignaciones. Las referencias de partidos vinculados no se confunden con la página de cobertura.

La siguiente página necesita la `revision` de la primera respuesta. Si los datos cambian entre lecturas se devuelve 409 y se ofrece volver a la primera página. La búsqueda mantiene estado local mientras se escribe y espera antes de actualizar URL y backend; conserva el foco y los caracteres con React Router.

Se sustituyen las consultas por fila de comandos, roles, disponibilidad y sincronización por lecturas conjuntas o lotes de hasta 500 IDs. Se añaden índices locales para `match_id`, feed y comandos. Las cifras completas, versiones y permisos se mantienen en los detalles. El flujo propuesta → envío por administrador → confirmación de CTP no cambia.

## Evidencia local

Fixture aislada con 1.007 partidos, actas e incidencias:

| Medición del índice de dossiers | Antes | Después |
| --- | ---: | ---: |
| JSON de respuesta | 9.630.896 B | 13.586 B |
| Consultas SQLite | 2.033 | 9 |
| Registros accesibles | 1.007 | 1.007 mediante páginas |

La comparación anterior usa el bootstrap completo anterior y la nueva consulta por pantalla, con la misma fixture. No representa una medición de latencia de la VPS. Una sincronización sin cambios de 1.006 partidos ejecuta tres consultas de lectura por lotes.

Las pruebas cubren búsqueda Unicode antes de paginar, páginas completas sin duplicados, entradas inválidas, permisos, conflictos entre páginas, comandos pendientes antiguos entre 1.000 confirmaciones posteriores y cobertura de turnos fuera de la página visible. Se mantienen las regresiones de confirmaciones, revocación de permisos y transporte.

La revisión con Playwright sobre una instancia local aislada comprueba navegación a página 2, búsqueda rápida sin perder caracteres, roster de ocho jugadores, lectura de cifras al abrir un mapa, fallo 503 con acciones bloqueadas y recuperación mediante reintento, páginas independientes del planificador y cambio a una semana sin datos. No se utiliza ningún servicio remoto ni se envían decisiones oficiales. Los fallos de red esperados de esta fixture son el 503 inducido y Guard sin backend oficial con IDs sintéticos.
