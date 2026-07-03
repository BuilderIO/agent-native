---
"@agent-native/core": patch
---

Add a token-gated `POST /list-files` endpoint to the `design connect` localhost bridge (recursive walk honoring a simple `.gitignore` subset, always-ignored build/dependency directories, binary/size filtering, and a 20,000-entry cap), broaden the bridge's writable text-file extension allowlist beyond `.html`/`.htm`/`.css` to common web/code/text formats, and add a secret-path blocklist (`.env*`, `*.pem`, `*.key`, `id_rsa*`, anything under `.git/`) enforced across `/read-file`, `/write-file`, `/apply-edit`, and `/list-files`. The manifest now advertises additive `listFiles`/`readTextFiles`/`writeTextFiles` capabilities for the Design app's code workbench.

Harden the bridge further: `assertPathInside` now also rejects a symlink at
the target path itself (not just a symlink in an ancestor directory), closing
a confinement bypass where a pre-existing symlink leaf inside the root could
point outside it and be silently followed by `/read-file`, `/write-file`, or
`/apply-edit`. The secret-path blocklist is now case-insensitive end to end
(bridge and the Design app's `write-local-file` action), so uppercase or
mixed-case variants like `.ENV`, `ID_RSA`, or `KEY.PEM` are blocked the same
as their lowercase form — required on case-insensitive filesystems such as
macOS's default APFS. `/read-file` now returns a `versionHash` derived from
the file's mtime/size, and `/write-file` and `/apply-edit` accept an optional
`expectedVersionHash`: when provided and the file's current hash does not
match, the bridge responds `409` with `{ error: "version conflict",
currentVersionHash }` instead of overwriting concurrent changes, and
successful writes echo back the new `versionHash`. The Design app's
`write-local-file` and `read-local-file` actions and the code workbench's
localhost workspace provider forward this version chain end to end, and the
workbench now polls open localhost tabs every 5 seconds so external edits
(made directly on disk or by the agent through the bridge) show up without a
manual reload.
