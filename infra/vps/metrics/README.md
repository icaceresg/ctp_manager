# Tráfico y servidor (Manager PRE y PROD)

El panel `/administration/metrics` requiere una sesión de administrador. El servidor
solo habilita el endpoint en `https://pre.manager.playctp.com` y
`https://manager.playctp.com`; un opt-in local explícito sirve para desarrollo.
La navegación también requiere administrador y un host exacto de Manager.

El observador independiente de PRE produce un snapshot cada 60 segundos. Manager
solo puede leer ese JSON: no tiene acceso a Docker, SSH ni a los logs originales.
La navegación y el endpoint siguen las restricciones de host, origen y sesión del
Manager. Las consultas se pausan al ocultar la pestaña y la caché del servidor dura
15 segundos. Una muestra de más de 180 segundos se presenta como antigua.

## Qué se mide

- Peticiones, respuestas 4xx/5xx, bytes y latencia p50/p95 aproximada por histograma.
  Los percentiles son límites de los buckets, no mediciones exactas individuales.
  Se leen los logs de acceso existentes de PRE y PROD en modo lectura.
- Los documentos HTML solicitados al servidor no equivalen a visitas únicas ni a
  todas las navegaciones internas de la aplicación. No se calcula identidad de
  visitantes, ni se almacenan IP, URLs, query strings, cabeceras o user agents.
- Cuentas registradas/confirmadas y cuentas distintas cuyo último acceso fue dentro
  de la ventana indicada. No es un contador de eventos de login ni de gente online.
- Jugadores en cola, participantes distintos en partidas activas, partidas activas
  y partidas cerradas en las últimas 24 horas según `closed_at`. Incluye estados
  activos del flujo Ranked; no ejecuta mantenimiento ni renueva presencia.
- Conexiones y bloqueos de PostgreSQL, RAM, CPU, disco, swap y presión del kernel.
  Las conexiones incluyen la breve consulta del observador. CPU del host se mide
  sobre todos los núcleos; CPU de cada servicio usa 100% por núcleo lógico.
  Deadlocks y reinicios son contadores acumulados desde el reset de cada fuente.

Una petición no representa una persona. La swap ocupada puede contener páginas
antiguas: las tasas de entrada/salida y la presión de memoria ayudan a distinguir
ocupación de presión actual. Este panel no demuestra capacidad para un número
concreto de jugadores; no se han ejecutado pruebas de carga contra producción.

## Cobertura y límites

El historial de recursos comienza cuando se instala el observador y se retiene
durante 24 horas (máximo 1.440 muestras). Los filtros 1/6/24 horas afectan a las
gráficas. Los totales/rutas usan la cobertura de tráfico indicada. Cada lectura
procesa como máximo 8 MiB por entorno; un primer tail, rotación o corte se marca
parcial. Los intervalos sin cobertura no se convierten en tasas de cero.
No se reescriben ni rotan los logs de Caddy.

El estado privado acotado a 16 MiB solo contiene offsets y agregados; el snapshot
público al administrador está acotado a 4 MiB. `null` significa ausencia de datos,
no cero. Los errores de fuente no se devuelven con rutas o mensajes internos.

## Operación

`collect.py` se ejecuta como una unidad separada y limitada, con grupos de lectura
y sin capacidades Linux adicionales. Solo escribe en
`/var/lib/ctp-manager-pre-metrics` (root:ctp-manager-pre, directorio 0750,
snapshot 0640 y estado privado 0600). Todas las consultas de PostgreSQL son SQL
fijo dentro de `BEGIN READ ONLY`, con timeouts; no hay DML, DDL ni RPC de negocio.

Manager PROD debe tener únicamente permiso de atravesar este directorio y leer
`snapshot.json`. No debe añadirse al grupo `ctp-manager-pre`: ese grupo puede
acceder a otros datos privados de PRE. El acceso al snapshot debe persistir tras
su reemplazo atómico, mediante una ACL de lectura heredada limitada por los modos
0640/0600. El estado privado y los temporales en escritura permanecen sin lectura
para PROD; el proceso de Manager no recibe acceso a Docker, SQL ni logs.

`install-pre.py` muestra un plan por defecto. Aplicarlo requiere un manifiesto de
hashes de los cuatro archivos revisados, root y rutas PRE nuevas. Solo instala y
arranca la nueva unidad/temporizador de PRE; comprueba que los servicios Manager,
sus releases/env y Caddy permanecen intactos. No instala paquetes, no abre puertos,
no modifica Caddy, no cambia la configuración de PROD ni habilita envíos externos.

La publicación del código Manager usa el empaquetador habitual y una release del
entorno verificada, con copia consistente de SQLite y conservación de sesiones y claves.
Los scripts del observador se publican aparte, vinculados a los hashes de la misma
fuente. No se restaura automáticamente una base de datos viva.

Verificación local: `npm test`, `npm run build`,
`python -B test/metrics-traffic.test.py` y
`python -B test/metrics-collector.test.py`. La primera ejecución Linux debe
comprobarse bajo la unidad real antes de activar el temporizador.
