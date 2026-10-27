# Halloween Ranked control

Paired candidate branches: `hw-event` in Manager and ConnectToPlay.

Administration → Integraciones contains the Halloween control. It reads CTP's
current authoritative flag, displays the revision and explains the winning XP
tiers: total×2 below five wins, ×4 from five, ×5 from ten. Losses and MMR are
unchanged. A match freezes its policy when formed.

The existing session/admin middleware protects both `/administration/ranked-event`
routes. The BFF additionally requires a CTP administrator and the existing writes
switch, resolves the current operator binding and uses the signed CTP transport.
No credentials or arbitrary scoring settings enter a browser payload.

Each change includes a reason, the current revision and a random request ID.
Unknown delivery outcomes retain that same payload for retry. A confirmed change
is followed by a fresh status read, because a historical retry receipt may
precede a later administrator's change. A stale/conflicted state needs refresh
before preparing another change.

Run `npm test` and `npm run build`. Local component fixtures are explicitly
synthetic; they do not prove a real staff session or CTP database flow. Deploy
the paired CTP API before the Manager candidate. Missing API support appears as
unavailable and cannot enable the flag. Keep the event OFF pending PRE acceptance.
Do not merge or deploy either Halloween branch to PROD without the user's order.
