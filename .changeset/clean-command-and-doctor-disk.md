---
"@agent-native/core": patch
---

Add `agent-native clean` to reclaim disk from regenerable build caches, and report disk usage in `agent-native doctor`. `clean` is a dry run unless `--apply`, prints the bytes it reclaims per category, and surfaces any delete it could not complete instead of reporting a clean total. `doctor` now shows free space on the volume holding the project, how much `clean` could give back, and flags low free space.
