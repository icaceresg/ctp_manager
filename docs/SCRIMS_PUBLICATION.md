# Publicación independiente de Scrims

DEV candidate only. No PRE or PROD activation is included in this change.

In **Publicación web → Secciones**, an administrator can publish or hide
**Scrims** without changing the circuit calendar or the transfer market.
Scrims is a practice schedule, without competitive challenge points. The
existing Retos routes, scoring, permissions and controls are not changed.

The draft submits only the flag the administrator changed:

```json
{
  "action": "configure",
  "expected_version": 3,
  "request_id": "40900000-0000-4000-8000-000000000001",
  "reason": "Abrir la agenda de entrenamientos",
  "changes": { "sections": { "scrims": true } }
}
```

The example identifier is synthetic. Real requests keep the existing generated
request identifier when retrying an uncertain response. CTP retains authority
over revision checks and idempotency. The admin-only Manager endpoint, global
write switch and signed CTP bridge remain mandatory.

The CTP backend migration adds `site_publication.scrims_visible`, closed by
default, and publishes `sections.scrims` in its existing status DTO. A legacy
backend that omits that field leaves the Scrims switch disabled as
**No disponible**; existing Calendar and Market controls keep working.
Malformed Scrims flags or unknown publication section keys are rejected.

The server verifies access and changed fields independently of the UI. This
control does not bypass the CTP server-side Scrims gate and never enables
`challenges`, Retos, ranking or payment flags.

## Validation

- `test/scrims-publication.test.js` covers isolated flag changes, reversions,
  legacy capability handling, finite boolean payloads, unauthorized actors,
  the global write switch, uncertain response retries and revision conflicts.
- New descriptions exist in the six Manager catalogues.
- Focused tests use in-memory SQLite. Existing migration and importer tests
  retain their own temporary file-backed fixtures, with the full suite run
  sequentially to avoid SQLite initialization collisions. Hosted bridge settings
  are empty; PRE/PROD and the shared Manager DEV data directory are not used.
- Run the existing Manager test suite and build before integrating the candidate.

Authenticated DEV UI acceptance is separate from these unit tests.
