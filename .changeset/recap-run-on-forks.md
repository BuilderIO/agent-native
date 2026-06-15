---
"@agent-native/core": patch
---

Run the PR visual recap on fork pull requests when the publish token is
available. The gate now keys off secret availability instead of blanket-skipping
all forks, so private orgs that send secrets to fork PRs get recaps on forks; the
prompt gets the fork prompt-injection note via the new `--fork-pr` wiring, and
forks without secret access get an actionable skip message.
