---
"@agent-native/core": patch
---

Register the CRM template in the CLI template catalog.

`crm` is added to `TEMPLATES` as a **hidden** entry (dev port 8107,
`defaultMode: "dev"`), so `agent-native new` can scaffold it by name while it
stays out of the public catalog until it is explicitly unhidden. The mirrored
list in `@agent-native/shared-app-config` is updated to match.

Two cross-template specs are widened to cover it: the UI-primitives sync check
now includes `crm`, and the page-chat handoff check reads CRM's layout from
`app/components/layout/CrmLayout.tsx` and expects `requireActiveHandoff: false`,
since CRM's full-page chat lives on its own `/ask` route.
