---
"@agent-native/core": patch
---

Add `agent-native design matched-check`, a validated source-versus-destination capture that confirms viewport, device pixel ratio, crop, pinned time, and alpha before it reports any fidelity metric, and labels unpinnable clocks unverified instead of passing them.
