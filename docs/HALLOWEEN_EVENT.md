# Halloween Ranked control

The isolated Manager release candidate integrates `hw-event`, PRE ticket CAS
fixes and the reviewed ticket workspace UI. Its canonical backend contract is
ConnectToPlay `fa9bd89a68268c91a25fdbbf978d9ce2714a38bc`; this Manager does not
change that backend policy.

Administration → Integraciones contains the Halloween control. It reads CTP's
current authoritative flag, displays the revision and explains the winning XP
tiers: total×2 below five consecutive wins, ×4 from five, ×5 from ten,
including the current win. The event doubles the winning base and separately
uses streak factors ×1/×2/×2.5. Each factor applies once; the tiers stay fixed
rather than increasing after each win. A base of 50 XP therefore gives 100,
200 or 250 XP; a Top50 base of 15 gives 30, 60 or 75 XP.
Losses and MMR are unchanged. A match freezes its policy when formed. The
public DTO must report `xp_multiplier: 2` and `streak_bonus: 0.5`; the Manager
rejects the older base×1 contract and unknown values even while the flag is OFF.

The live administrative rotation has six fixed maps: Lotus, Mumbai, Munition,
Reactor U92, Rooftops and Silkworm, plus exactly one of Sentry/Lithium in the
server-owned 20-minute UTC slot. Both modes have seven maps. Only Coal leaves
new event selections; disabling returns the ordinary Coal plus six-fixed-map
pool for new lobbies. Formed lobbies keep their frozen policy and map pool.

The complete approved music MP3 is absent in the paired CTP candidate:
`EVENT_SEARCH_MUSIC` and `musicTrack` are null. The Manager labels search music
unavailable; it does not promise playback, generate a replacement or change
the effects/audio preferences.

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
the paired CTP API before the Manager candidate. Missing or obsolete API support appears as
unavailable and cannot enable the flag. Keep the event OFF pending PRE acceptance.
Do not merge or deploy either Halloween branch to PROD without the user's order.

The original CTP contract source names its event/reward/share migrations264–266.
The release coordinator verified PRE/PROD ledgers read-only: their current
maximum is290 and none of these Halloween migrations has been applied. The
paired release candidate therefore renumbers the same SQL to291/292/293.
No published migration or ledger entry is rewritten. Manager does not apply
migrations or depend on those numeric filenames; it validates the signed
finite DTO and switch-only action contract. Installation and acceptance remain
separate from this local source review.
