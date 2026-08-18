---
"@agent-native/core": patch
---

Fix a bug where closing one chat tab could close several tabs at once (or make a tab reappear right after closing it). A duplicated thread id in the persisted open-tabs list is now de-duplicated on read and write, so a corrupted tab list restored from localStorage self-heals instead of reproducing the issue after every reload.
