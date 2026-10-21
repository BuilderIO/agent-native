---
"@agent-native/core": patch
---

Hold route module warmup until 4 seconds after the page's load event, so Safari no longer logs "preloaded using link preload but not used" for every warmed route. Data warmup still starts right away.
