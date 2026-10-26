#!/usr/bin/env bash
# This script runs only on the GitHub runner; private values never enter stdout.
set -euo pipefail

environment="${1:-}"
operation="${2:-}"
case "$environment:$operation" in
  pre:check|pre:deploy) expected_ref=refs/heads/pre ;;
  prod:check|prod:deploy) expected_ref=refs/heads/main ;;
  *) echo '::error::Invalid deployment environment or operation.'; exit 1 ;;
esac
[[ "${GITHUB_REF:-}" == "$expected_ref" ]] || { echo '::error::Deployment branch does not match its environment.'; exit 1; }
if [[ "$environment" == prod ]]; then
  [[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ]] || { echo '::error::Production requires a manual workflow.'; exit 1; }
  if [[ "$operation" == deploy ]]; then
    [[ "${DEPLOY_DRY_RUN:-}" == false && "${DEPLOY_CONFIRMATION:-}" == 'PUBLICAR PRODUCCION' ]] || {
      echo '::error::Production publication requires dry_run=false and PUBLICAR PRODUCCION.'; exit 1;
    }
  fi
fi
[[ -n "${SSH_PRIVATE_KEY:-}" && -n "${VPS_KNOWN_HOSTS:-}" ]] || { echo '::error::Missing SSH key or host pin.'; exit 1; }
[[ "${VPS_HOST:-}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo '::error::Missing or invalid VPS host variable.'; exit 1; }
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ && "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]] || exit 1

ssh_dir="$(mktemp -d "$RUNNER_TEMP/manager-$environment-ssh.XXXXXX")"
trap 'rm -rf -- "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$ssh_dir/id"
printf '%s\n' "$VPS_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/id" "$ssh_dir/known_hosts"

digest=''
if [[ "$operation" == deploy ]]; then
  digest="$(sha256sum output/ctp-manager.tar.gz | cut -d ' ' -f 1)"
  command="deploy $environment $GITHUB_SHA $GITHUB_RUN_ID $GITHUB_RUN_ATTEMPT $digest"
  upload=output/ctp-manager.tar.gz
else
  command="check $environment"
  upload=/dev/null
fi
status=0
ssh -T -p 22 -i "$ssh_dir/id" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o PasswordAuthentication=no \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts" \
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 \
  -o LogLevel=ERROR "ctp-manager-deploy-$environment@$VPS_HOST" "$command" \
  < "$upload" > "$ssh_dir/receipt.json" 2> "$ssh_dir/failure.txt" || status=$?

# Do not print raw SSH errors or unvalidated remote content. Accept only the
# documented aggregate receipt and bind a deployment to this exact CI run.
python3 - "$ssh_dir/receipt.json" "$environment" "$operation" "$status" "$digest" <<'PY'
import json, os, pathlib, re, sys
path, environment, operation, status, digest = sys.argv[1:]
receipt = {}
try:
    raw = pathlib.Path(path).read_bytes()
    assert len(raw) <= 32768
    receipt = json.loads(raw)
    assert isinstance(receipt, dict)
    assert status == '0'
    assert receipt.get('environment') == environment
    assert receipt.get('status') == ('ready' if operation == 'check' else 'deployed')
    output = {'status': receipt['status'], 'environment': environment}
    if operation == 'deploy':
        expected = '-'.join(os.environ[x] for x in ('GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'))
        assert receipt.get('release') == expected and receipt.get('commit') == os.environ['GITHUB_SHA']
        assert receipt.get('artifactSha256') == digest
        output.update(release=expected, commit=receipt['commit'], artifactSha256=digest)
    else:
        current = receipt.get('current')
        if isinstance(current, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,159}', current):
            output['current'] = current
    text = json.dumps(output, separators=(',',':'))
    print(text)
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
        if operation == 'check':
            summary.write(f'Manager {environment.upper()}: SSH, broker and current runtime verified. This check publishes nothing.\n\n')
        else:
            origin = 'https://pre.manager.playctp.com' if environment == 'pre' else 'https://manager.playctp.com'
            summary.write(f'Manager {environment.upper()} deployed: {origin}\n\n')
        summary.write('```json\n' + text + '\n```\n')
except Exception:
    failure = {'status':'failed','environment':environment,'reason':'receipt_not_accepted'}
    reason = receipt.get('reason') if isinstance(receipt, dict) else None
    if isinstance(reason, str) and re.fullmatch(r'[a-z0-9_]{1,80}', reason):
        failure['reason'] = reason
    if isinstance(receipt, dict) and isinstance(receipt.get('rolledBack'), bool):
        failure['rolledBack'] = receipt['rolledBack']
    text = json.dumps(failure,separators=(',',':'))
    print(text)
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
        summary.write('Manager VPS request failed. Filtered broker result:\n\n```json\n' + text + '\n```\n')
    print('::error::Manager VPS verification or publication failed; no successful deployment receipt was accepted.')
    raise SystemExit(1)
PY
