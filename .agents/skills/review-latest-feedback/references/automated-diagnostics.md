# Automated diagnostic ownership

Automated CI, Beta E2E, and monitoring alerts count as feedback regardless of
author. This ownership preflight is the only pre-claim investigation: after the
Slack reaction gate, use the alert and linked issue, PR, run, or task metadata
to establish the exact repo, ref/SHA, workflow or service/environment, failure
fingerprint, and any active owner of that same failure. Do not inspect logs,
tests, artifacts, or otherwise debug before claiming.

Continue if this task owns the active PR/task. If another owner is fixing the
same failure, record **Owned elsewhere** with the owner, link, and next action;
do not create or modify parallel work. A linked PR counts only when its current
changes or recent activity address the same failure. A stale/unrelated PR,
shared label, or later green rerun alone is not ownership evidence.

With no active owner and the item in scope, claim immediately. For Slack, add
`👀` after the reaction gate and read it back. For non-Slack sources, add a
status row to the current Codex task with the source permalink, fingerprint,
owning task/worktree, and next action; that durable task record is the claim and
must be accessible to later ownership checks. Do not assign, label, comment,
react, or otherwise mutate the source without explicit authorization for that
exact write. If no discoverable task record can be made, leave the item pending.

After claiming, inspect linked runs, builds/commits, job logs, tests, artifacts,
and issue state. Treat labels/counts as leads. Fix verified repo-owned causes;
for other causes, record evidence and the next owner/action. Don't ask bots; ask
a person only when a fact blocks a fix. Improve reports with concise evidence
and links; avoid duplicate details and secrets.
