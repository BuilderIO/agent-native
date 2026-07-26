---
"@agent-native/core": patch
---

Stop workspace apps from intermittently reporting a vault secret as missing.
`resolveSecret` treated a request with no resolved org id as proof the user had
no org, so it only looked at the solo workspace scope — a transient
`org_members` read failure (which `resolveOrgIdForEmail` swallows into `null`)
made an org-scoped vault row vanish for that request and come back on the next
one. It now falls back to the membership lookup the Builder credential path
already used, and always checks the solo workspace scope so a secret written
before the user joined an org stays reachable afterwards. `resolveCredential`
gains the same final solo fallback, and a row that is present but undecryptable
now logs which key and scope failed instead of being reported as absent.
