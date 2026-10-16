---
"@agent-native/core": patch
---

`callAction` and `callActionBlob` accept `uiOnly: true` for actions declared `uiOnly`, minting the browser UI capability before the request so the first call is authorized instead of being refused with 403 `ui_capability_required` and retried.
