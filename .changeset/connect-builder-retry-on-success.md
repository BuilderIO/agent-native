---
"@agent-native/core": patch
---

Auto-send the user's pending prompt the moment Builder.io connection
completes. The Connect Builder card carries the user's original ask as
its `prompt` prop; previously the OAuth popup closing left them staring
at a "Send to Builder" button as if they had to retype it. The card now
fires the send automatically once `connecting` flips false with a
configured Builder, but only if the user actually clicked Connect this
session — revisiting an already-connected card still requires an
explicit click so old threads don't replay on re-open.
