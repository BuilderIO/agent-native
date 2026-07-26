---
"@agent-native/core": patch
---

Say at org-creation time that vault keys are not shared between organizations.
The three surfaces that call `createOrgHandler` — the org switcher's create
form, the Team page's create card, and the "create a separate organization"
branch of the no-org gate — now carry one inline line stating that a new
organization starts with an empty vault and needs its own API keys.

The boundary itself is unchanged; only its visibility is. `app_secrets` has no
scope readable by every org (a `workspace` row's `scope_id` is always an org id
or `solo:<email>`, and `readAppSecret` is strict equality), while the vault UI
advertises keys as "available to every workspace app". Users were therefore
discovering the per-org boundary weeks later as a missing key on a page that had
always worked, rather than at the moment they chose to create the org.

The no-org gate shows the line only when the user had an organization available
to join, since the first organization in a workspace has nothing to diverge from.
