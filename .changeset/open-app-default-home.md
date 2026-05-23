---
"@agent-native/core": patch
---

`open_app({app: "<id>"})` now defaults to the app's home page (`/`) when neither `view` nor `path` is given, instead of throwing `requires 'app' and either 'view' or 'path'`. Hosts (ChatGPT / Claude) previously wasted a turn on the model's first-attempt retry whenever it omitted view/path; this lands the embed on `/` first try.
