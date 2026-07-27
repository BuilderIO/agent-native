---
"@agent-native/core": patch
---

Extract picture shape size and slide dimensions when parsing PPTX files, so importers can tell a full-bleed cover photo from a small inset image and preserve each image's real aspect ratio.
