---
"@agent-native/toolkit": patch
"slides": patch
---

Fix the visual inspector panel clipping its own scroll area when the host dock is shorter than the viewport-derived max height, so the style panel scrolls with the speaker notes panel open. In Slides: duplicate a deck from the listing screen optimistically so the editor no longer shows "Deck unavailable" for the fresh copy, expose the slide background in the style dock when no element is selected, and hide add/duplicate/delete/reorder slide controls from view-only users instead of letting them apply and silently revert.
