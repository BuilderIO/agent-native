---
"@agent-native/core": patch
---

Fix the agent sidebar's resize handle sometimes leaving the whole page unable
to select or copy text.

The resize handle set `document.body.style.userSelect = "none"` on mousedown
(so a drag doesn't select page text) and only cleared it on `mouseup`. If the
drag ended abnormally -- the mouse button released outside the browser
window/iframe, or the effect unmounted/re-ran mid-drag (sidebar layout
change, fullscreen toggle) -- `mouseup` never fired and `userSelect` stayed
stuck at `"none"` for the rest of the session, silently breaking selection and
copy everywhere in the app, including agent chat responses. Now a
`window` `blur` listener and the effect cleanup both unconditionally restore
`userSelect`, so a stuck state can no longer persist. The DB admin SQL
editor's splitter drag had the same defect and gets the same fix.
