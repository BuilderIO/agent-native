# Time grid and direct manipulation

Use where spatial placement communicates time, duration, and overlap.

- Align a persistent time ruler with stable grid intervals. Pin the chosen
  display timezone across navigation, previews, and edits. Store absolute
  times with an explicit zone for display and recurrence. Handle ambiguous
  and missing local times at daylight-saving transitions.
- Drag to move and resize at visible handles. Show proposed times and conflict
  markers as the pointer moves. Keep keyboard and form controls for the same
  operation. Commit on release through a shared action that validates overlap
  and permissions again.
- Create from an empty slot in an anchored popover prefilled with the proposed
  time range. Keep input on a rejected save, restore the last confirmed grid
  state, and show the conflict and a recovery action.
- Fetch a bounded visible range. Keep the existing grid usable during refresh.
  Resolve late responses against the current range and protect active edits
  from refreshes.

Verify timezone changes, cross-midnight and daylight-saving slots, overlap
rejection, keyboard editing, and narrow-pane access to detail and controls.
