# Halloween map rotation in Manager DEV

The existing administrative Halloween switch enables the new six-map pool for new lobbies. Sentry and Lithium alternate in server-owned 20-minute slots alongside Mumbai, Munition, Reactor U92, Rooftops and Silkworm. Coal and Lotus leave the event pool; existing lobbies retain their snapshots. Switching off restores the ordinary pool for new lobbies.

The response adapter validates and whitelists `map_rotation`, including its exact map identities, distinct active/next map, 1,200-second window, observed server time and the agreement with the event flag. A historical frozen lobby snapshot cannot masquerade as current administrative status. Older responses remain readable, but the UI blocks activation when the new rotation capability is absent; deactivation remains available.

The panel anchors its countdown to server time. At a boundary or after a failed/stale observation, it hides the current-map claim until a valid status read arrives. A cached response cannot extend an expired slot. Visible tabs refresh the read-only status every 30 seconds and at a new slot boundary; automatic reads never submit a configuration command. The existing admin role, write switch, reason, expected revision, request identity and uncertain retry protocol are preserved.

## Local review fixture

With the Vite development server running, open `/dev/halloween-rotation.html`. It mounts the real panel against explicitly synthetic, in-memory API responses. It has no staff authentication or CTP connection. The controls advance only the mock clock, move the next mock boundary to three seconds away, or simulate a read failure. The panel's normal form changes only the in-memory fixture flag and revision. `?role=referee` demonstrates that the administrative panel makes no request for a non-admin role.

This fixture is UI acceptance evidence only, not a signed Manager-to-CTP integration or a player end-to-end test. Runtime verification against the isolated DEV backend remains a separate integration check. No hosted environment, account or production flag is changed by this work.

Checks: `npm test` and `npm run build`; focused contract and clock coverage is in `test/ranked-event.test.js`.
