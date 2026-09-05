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
