---
"@agent-native/toolkit": patch
---

Give the sidebar chat rail's "more chats" control a disclosure chevron that
flips with its state instead of the `IconDots` glyph the chat rows above it
already use for their overflow menus. Hosts are free to pass the same label for
both disclosure states — Brain, Assets, Factory, Plan, and Dispatch all pass a
plain "Chats" — so the glyph was the only part of the control that could report
state, and it never moved. Pressing it did expand the rail, but the button
looked like a menu trigger that had silently failed.
