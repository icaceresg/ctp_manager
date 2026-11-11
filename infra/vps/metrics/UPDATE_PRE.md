# Actualización del observador ya instalado

El despliegue normal de Manager no instala `collect.py`. Su CI ejecuta las
pruebas Python desde `.github/actions/manager-checks/action.yml`, pero el
publicador de aplicación sólo publica la aplicación. `install-pre.py` es un
bootstrap para una instalación nueva: rechaza archivos y unidades existentes,
y arranca la unidad y el temporizador. No sirve para actualizar este VPS.

`update-pre.py` prepara la actualización de **un solo archivo**:
`/opt/ctp-manager/pre-metrics/collect.py`. No ejecuta el observador, ni cambia
temporizadores, unidades, bases, servicios, Manager, Caddy o archivos de PROD.
El proceso que ya esté leyendo el archivo termina con sus bytes anteriores;
la siguiente ejecución programada abre el archivo nuevo completo.

## Paquete y permisos de CI

El job de infraestructura necesita una capacidad separada, limitada a esta
operación. La clave del publicador de aplicación no da permisos para hacerlo.
Este cambio no registra ni amplía ninguna capacidad root. El adaptador deberá
comprobar el hash del manifiesto revisado y la procedencia del commit, crear un
stage privado root y permitir sólo `update-pre.py` y `collect.py` con sus hashes
autorizados. No debe aceptar rutas, comandos, hashes o destinos root arbitrarios
desde una rama de aplicación.

El job debe extraer **bytes Git**, no copiar el checkout de Windows, que puede
tener CRLF. Por ejemplo, desde Python:

```python
raw = subprocess.check_output(['git', 'show', commit + ':infra/vps/metrics/collect.py'])
(stage / 'collect.py').write_bytes(raw)
```

El manifiesto tiene exactamente estas claves:

```json
{
  "schemaVersion": 1,
  "scope": "pre_metrics_collector_only",
  "sourceCommit": "<commit completo revisado>",
  "expectedInstalledSha256": "<hash instalado observado>",
  "candidateSha256": "<hash de bytes Git del candidato>",
  "protectedSha256": {
    "/opt/ctp-manager/pre-metrics/traffic.py": "<hash observado>",
    "/etc/systemd/system/ctp-manager-pre-metrics.service": "<hash observado>",
    "/etc/systemd/system/ctp-manager-pre-metrics.timer": "<hash observado>"
  }
}
```

El adaptador root ejecuta primero el plan, sin escrituras:

```text
python3 update-pre.py --source /ruta/root/collect.py --manifest /ruta/root/manifest.json
```

Después, únicamente con el `planSha256` exacto aprobado:

```text
python3 update-pre.py --source /ruta/root/collect.py --manifest /ruta/root/manifest.json --apply --expected-plan-sha256 <planSha256>
```

Un cambio de fuente, archivo instalado o archivo protegido invalida el plan.
La aplicación usa un lock no bloqueante, conserva los bytes anteriores con
permiso 0600 y sustituye el archivo atómicamente. No hace reintentos automáticos.
Tras un fallo de transporte hay que leer el hash instalado antes de decidir.

## Comprobación posterior

La primera ejecución del lector cgroup puede no tener CPU anterior comparable;
ese valor permanece desconocido. La siguiente ejecución programada establece
una tasa si la identidad y el intervalo siguen siendo válidos. Hay que observar
dos snapshots frescos y un resultado de colección correcto. Un timer activo no
demuestra por sí solo que el observador funcione.

`scripts/measure-observer-reads.py` compara las dos fuentes exactas con un
inventario y contadores temporales sintéticos. Usa un HTTP loopback efímero
para representar una llamada CLI a Docker stats y no arranca Docker ni un
backend. Prueba la eliminación de esa llamada, **no** ahorro de CPU del VPS.

Comprobaciones:

```text
python -B test/metrics-collector.test.py
python -B test/metrics-update.test.py
python -B scripts/measure-observer-reads.py --baseline-collector <fuente anterior privada> --candidate-collector <collect.py en bytes Git> --output <evidencia local>
```
