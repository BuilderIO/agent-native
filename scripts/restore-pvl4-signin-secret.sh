#!/usr/bin/env bash
# Restore Google sign-in on every site whose pvl4 secret was revoked.
#
# A secret on client 344222511957-pvl4uh2ku88ig8vrdsqmt5kt7ut0ch4q was deleted,
# so every deployment carrying it now gets invalid_client from Google. Sites
# still passing are running an older bundle and will break as soon as they
# redeploy - beta redeploys on every merge to main, so this is spreading.
#
# Give it a CURRENTLY VALID pvl4 secret. It verifies against Google first,
# then repairs only the sites that are actually broken, deriving that list from
# live probes rather than a list typed into this file - a hand-maintained list
# is what left sites broken during the 2026-08-20 outage.
#
# Usage: ./scripts/restore-pvl4-signin-secret.sh          # repair + redeploy
#        ./scripts/restore-pvl4-signin-secret.sh --dry-run
set -euo pipefail

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true
CLIENT_ID="344222511957-pvl4uh2ku88ig8vrdsqmt5kt7ut0ch4q.apps.googleusercontent.com"

printf 'Paste a currently valid secret for pvl4…\n(secret): ' >&2
read -rs SECRET; printf '\n' >&2
[ -n "$SECRET" ] || { echo "Nothing entered; aborting." >&2; exit 1; }

echo "==> Verifying against Google before touching anything..." >&2
err=$(curl -s -X POST https://oauth2.googleapis.com/token \
  --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "client_secret=$SECRET" \
  --data-urlencode "code=probe" --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "redirect_uri=https://content.agent-native.com/_agent-native/google/callback" |
  python3 -c 'import json,sys;print(json.load(sys.stdin).get("error","?"))')
[ "$err" = "invalid_grant" ] || { echo "    Google says '$err' - not a valid pvl4 secret. Nothing written." >&2; exit 1; }
echo "    OK." >&2

echo "==> Asking every host which ones are actually broken..." >&2
SECRET="$SECRET" DRY_RUN="$DRY_RUN" python3 <<'PY'
import json, os, subprocess, urllib.request

secret, dry = os.environ["SECRET"], os.environ["DRY_RUN"] == "true"
PVL4 = "pvl4uh2ku88ig8vrdsqmt5kt7ut0ch4q"
hosts = json.load(open("scripts/netlify-site-hosts.json"))
targets = [h for k in ("production", "beta") for h in hosts.get(k, [])]

def api(method, data):
    return json.loads(subprocess.run(["netlify", "api", method, "--data", json.dumps(data)],
                                     capture_output=True, text=True).stdout)

sites = api("listSites", {})
by_host = {}
for s in sites:
    for d in [s.get("custom_domain")] + (s.get("domain_aliases") or []):
        if d: by_host[d] = s

broken = []
for host in targets:
    try:
        with urllib.request.urlopen(f"https://{host}/_agent-native/health/google", timeout=15) as r:
            body = json.load(r)
    except Exception as e:
        print(f"  SKIP    {host} (unreachable: {str(e)[:40]})"); continue
    if body.get("status") == "invalid" and PVL4 in str(body.get("clientId", "")):
        broken.append(host); print(f"  BROKEN  {host}")

if not broken:
    print("\nNothing broken on pvl4. Nothing to do."); raise SystemExit(0)

print(f"\n==> Repairing {len(broken)} host(s)")
repaired = set()
for host in broken:
    site = by_host.get(host)
    if not site:
        print(f"  ??      {host} - no Netlify site matches this host; repair by hand"); continue
    if dry:
        print(f"  DRY     {site['name']}"); repaired.add(site["name"]); continue
    subprocess.run(["netlify", "env:set", "GOOGLE_SIGN_IN_CLIENT_SECRET", secret,
                    "--site", site["id"], "--context", "production", "--secret"],
                   check=True, capture_output=True)
    print(f"  SET     {site['name']}"); repaired.add(site["name"])

print("\n==> Netlify bakes env at build time, so each site needs a redeploy.")
print("    Beta redeploys on the next merge to main. Production sites needing one:")
for name in sorted(n for n in repaired if not n.startswith("beta-")):
    print(f"      {name}")
PY
unset SECRET
