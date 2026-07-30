---
"@agent-native/toolkit": patch
"slides": patch
---

Fix the visual inspector panel clipping its own scroll area when the host dock is shorter than the viewport-derived max height, so the style panel scrolls with the speaker notes panel open.

In Slides: duplicate a deck from the listing screen optimistically so the editor no longer shows "Deck unavailable" for the fresh copy, and keep the copy's slide ids stable across that handoff so edits made before the duplicate persists are not dropped. Expose the slide background in the style dock when no element is selected, reporting gradients and named background utilities as mixed instead of misreporting them as black. Hide slide add/duplicate/delete/reorder controls and make speaker notes read-only for view-only users, instead of letting their edits apply and silently revert.
