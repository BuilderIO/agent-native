---
"@agent-native/core": patch
---

Shared rich-markdown editors can now disable the default markdown surgical
parser when they own a custom value format, preventing JSON-backed editor content
from being interpreted as literal markdown.
