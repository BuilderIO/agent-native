---
"@agent-native/core": patch
---

When a provider key is saved in another organization the person also belongs to, the missing-key error now opens with its two fixes (switch the active organization to the one holding the key, or save the key in this one) and explains after, so a stop's one-line reason keeps both fixes even with long key and organization names. When that organization's name can't be read, the message no longer says "the another organization".
