---
"@agent-native/core": patch
---

Fix file uploads for Builder connections made through OAuth. New connections
store only an OAuth grant, but the upload provider and the storage capability
gates still looked for a legacy `bpk-` private key, so uploads failed for every
newly connected user.

Builder OAuth now also requests `builder:assets:write`, the scope its
`/api/v1/upload/*` endpoints enforce, and the upload provider sends the OAuth
token when the request's owner has a grant — falling back to a private key only
when there is no grant at all.

Already-connected users must authorize Builder once more to pick up the new
scope.
