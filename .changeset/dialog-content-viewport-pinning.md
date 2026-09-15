---
"@agent-native/toolkit": patch
---

Stop dialogs from hiding the controls at their bottom edge. `DialogContent`
capped itself at `min(760px, 100vh - 32px)` and then clipped with
`overflow-hidden`, so on a short viewport the rows that grow last — footers,
advanced sections, model pickers — were painted outside the box with no way to
scroll to them. It now scrolls its own content. `AlertDialogContent` had no
height cap at all and simply ran off both edges of the viewport; it now gets
the same cap and internal scroll.
