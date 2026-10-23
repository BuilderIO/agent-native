---
"@agent-native/core": patch
---

Hold route module preloads until 4 seconds after the page's load event, so Safari no longer logs "preloaded using link preload but not used" for every warmed route. Meanwhile, module files are fetched into the HTTP cache, so early clicks still skip the network. Hovering, touching or focusing a link still preloads it right away, and data warmup still starts right away.
