---
"@agent-native/core": patch
---

Keep emoji and other multi-code-point grapheme clusters intact while streaming text. The incremental segmentation cache re-segmented from a fixed character offset, so a cluster straddling that offset was cut in half and characters were silently dropped from the smoothed output. The re-segmentation window now starts on a grapheme boundary.
