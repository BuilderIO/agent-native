---
"@agent-native/core": patch
---

Find-and-replace edits that miss only because of spacing around `: ; , < >` (for example Prettier's `padding: 4px` against stored `padding:4px`) now report the stored text as the closest match, and a multi-line quote against shorter content no longer returns an empty hint. The edit is still never applied loosely.
