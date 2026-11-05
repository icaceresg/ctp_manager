# Isolated new-VPS preparation

`deploy-migration.yml` is a manual workflow for a separate destination. It does
not modify the PRE or PROD serving workflows. It runs from `main` and accepts
only the exact current `pre` commit for PRE, or the exact current `main` commit
for PROD. Its package manifest records that checked-out branch and commit.

Use the existing `Preview` and `Production` GitHub environments, with dedicated
settings in each environment:

* secret `MANAGER_MIGRATION_SSH_KEY`;
* variable `MANAGER_MIGRATION_HOST`;
* variable `MANAGER_MIGRATION_KNOWN_HOSTS`.

There is no fallback to the serving VPS settings. `dry_run=true` builds, tests,
packages and checks restricted SSH, without publishing a release. Publication
requires `dry_run=false` and the exact confirmation `PREPARAR NUEVA VPS`.

## Runtime quarantine

For a release containing `server/migration-shadow.js`, root may set
`CTP_MANAGER_MIGRATION_SHADOW=1` in the new host's service configuration. This
disables operations and ruleta polling and session cleanup. All APIs return 503
without authentication, except the anonymous `/api/auth/status` health response.
The static build remains available. Missing/empty/`0` leaves normal behavior;
other values fail startup. This is not a user-facing maintenance switch.

The flag is additional protection, not the isolation boundary. Keep new-host
egress quarantined, public access closed, and all CTP destinations bound to the
new isolated backend. PRE commit `4544532c7df1eddf88e72b8639efce0c08663520`
does not contain this flag and must rely on the infrastructure quarantine.

Import separate online SQLite backups for PRE and PROD. Startup migrations may
write to those copied local databases even in shadow mode. Retain an untouched
backup and its digest before startup; do not copy a live SQLite file without its
WAL or replace source data. No production source database is used by DEV tests.

## Bootstrap before CI check

The existing `infra/vps/cicd/manager_release.py install` validates an already
running current release, its loopback endpoint and its HTTPS origin. Prepare the
service account, copied data, Node runtime, a genuine initial release and current
symlink first. Resolve the public Manager hostnames to the new host's loopback
for the helper's HTTPS checks, preserving TLS/SNI. A response from the serving
old host must not count as new-host health.

Then install the existing broker separately for `pre` and `prod`, supplying the
new deploy identity's public key and the new SSH host explicitly. The broker
creates forced-command deploy users and root socket activation. Its fixed
canonical manifest refs remain `refs/heads/pre` and `refs/heads/main`.

Do not remove quarantine, switch DNS, enable user traffic, or replace the final
data snapshot as part of this workflow. Those are separate cutover operations.

## Validation limits

Local tests use temporary synthetic SQLite data and a recording fake bridge.
They verify that shadow HTTP cannot authenticate, issue cookies or call the
bridge. Build, unit checks and a dry run do not demonstrate real user flows or
acceptance on the new VPS. Record remote source commit, manifest hashes, data
backup time, service state and quarantine checks after the actual CI run.
