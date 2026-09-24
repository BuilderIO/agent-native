---
type: fixed
date: 2026-08-22
---

Org admin panels no longer report a database error as a permission denial. A failed
organization-role lookup now surfaces as a retryable error instead of silently reading
as "you are not an owner or admin", which had been 403-ing the usage stats panel for
real admins whenever the database was briefly unreachable.
