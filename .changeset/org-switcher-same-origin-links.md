---
"@agent-native/core": patch
---

Fix the org app-switcher escaping to the official *.agent-native.com site on
custom deployments. `defaultOrgAppLinks` hardcoded each template's prod URL, so a
path-prefixed deployment (served at `<origin>/<app>/`, which bakes
`VITE_APP_BASE_PATH`) linked sibling apps to the first-party hosted site instead
of the current deployment. It now builds `<origin>/<app>/` links when the app is
path-prefixed, and keeps the prod URLs for the first-party subdomain layout.
