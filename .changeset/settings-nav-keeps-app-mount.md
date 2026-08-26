---
"@agent-native/core": patch
---

Keep the workspace app mount when navigating the settings side-nav. Clicking a settings nav item under a mounted app (for example `/dispatch/settings`) could rewrite the URL to `/settings/general` and leave the app entirely, because the nav rebuilt the mount from the env/manifest-derived base path, which fails closed to an empty string that is indistinguishable from "mounted at the origin root". Settings navigation now anchors on the mount already present in the address bar, which also fixes tab selection from a mounted settings URL and the same drop in the integrations, secrets, and automations deep links.
