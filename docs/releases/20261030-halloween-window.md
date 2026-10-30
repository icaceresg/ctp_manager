# Halloween Ranked: paired fixed-window candidate

Pairs with CTP's additive295 fixed-window migration. The interval is
`[2026-10-30T14:00:00Z, 2026-11-03T14:00:00Z)`, Friday30 October15:00 to
Tuesday3 November15:00 in Europe/Madrid.

The private input remains the existing audited boolean configure command with
CAS and idempotency. No date or scoring input is added. The new response separates
`configured_enabled` (armed/disabled) from `enabled` (active at server time), with
four phases and fixed dates. Older manual responses remain supported. Manager
confirms against the configured flag and displays dates in Madrid. Boundary
refresh requests a server decision; the browser never activates the event itself.

Existing in-flight matches retain their frozen event policy and pool. This change
does not touch permissions, ticket flows, workflows, dependencies or any database.
The separate statistics-reader permission is outside this candidate.

Publish CTP first, validate backend/HTTP/migration health, then Manager. PRE is
paused and merges to `pre` automatically deploy; do not merge until authorized.
PROD remains a human manual CI/CD deployment after PRE acceptance and fresh VPS
capacity checks, with the switch OFF until the exact candidates are verified.
Full search music remains unavailable; the Armory is included on the CTP side.
