---
"@agent-native/core": patch
---

When a provider key is saved in another organization the person also belongs to, the missing-key error now opens with its two fixes (save the key in this organization, or switch to the one holding it) and explains after. The organization's name comes after both fixes, so a stop's one-line reason keeps them however long the key and organization names are. When that organization's name can't be read, the message no longer says "the another organization".
