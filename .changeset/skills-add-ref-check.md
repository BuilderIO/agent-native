---
"@agent-native/skills": patch
---

`skills add` now checks the git ref of a GitHub source before cloning and stops with an "Invalid source ref" error if it contains anything other than letters, digits, `.`, `_`, `/`, and `-`, or starts with `-`. Package-manager commands on Windows now go through a quoted command line instead of an unquoted shell.
