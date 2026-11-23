---
"@agent-native/core": patch
---

When a provider key is saved in another organization the person also belongs to, the missing-key error now opens with its two fixes (save the key in this organization, or switch to the one holding it) and explains after, with the organization's name after both fixes. Neither that explanation nor the one for a key saved only as someone's Personal key repeats the key any more, and a provider that needs one specific key now words an explained miss the way the any-key error does, "<provider> credential not configured. <explanation> Tried: <key>". Together these keep the fixes in a stop's one-line reason however long the key and organization names are. When that organization's name can't be read, the message no longer says "the another organization".
