---
"@agent-native/core": patch
---

Add server-backed search to the organization member list and hide role editing
from admins to match the owner-only role policy.

Enforce the shared member-removal policy in the organization API so admins can
remove ordinary members but cannot remove other admins.

Show an error with a retry action when members cannot be loaded, instead of
presenting failed searches as empty results.

Keep a debounced member search on its first page when pagination is used while
the new query is pending.

Make federated member removals and role changes fail closed when concurrent
membership state changes, and retain millisecond removal markers safely in
PostgreSQL.

Allow still-authorized owners and admins to retry a pending federated member
removal through the original DELETE after identity-authority success leaves
local cleanup incomplete.
