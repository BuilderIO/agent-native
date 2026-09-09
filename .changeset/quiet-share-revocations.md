---
"@agent-native/core": patch
---

Notify the affected user when an authorized action removes an explicit user share, so their open views can refresh even when they use another organization. The recipient event contains only the generic action name, without resource details.

`unshare-resource` preserves `ok: true` for an acknowledged revoke and adds `recipientInvalidation.status`: `recorded` confirms the refresh marker was written (not that a browser received it), `unconfirmed` reports a notification error without treating the committed revoke as failed, and `not_applicable` means no explicit user grant was removed. Unconfirmed delivery is logged and has no automatic durable retry. Group, organization, public-access, and general authorization behavior are unchanged.
