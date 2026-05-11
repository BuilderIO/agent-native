---
"@agent-native/core": patch
---

Builder upgrade URL: stop appending the org display name. `BUILDER_ORG_NAME` is a human-readable label (e.g. "Nicholas kipchumba Space"), not a URL slug or id — URL-encoding it produced paths like `/app/organizations/Nicholas%20kipchumba%20Space/billing` which Builder's router silently bounces to `/app/projects`. We now always link to the org-agnostic `/account/billing`, which resolves the active org from session and lets users with multiple orgs switch from that screen.
