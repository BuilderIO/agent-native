---
"@agent-native/toolkit": patch
---

Recheck submission gates after asynchronous preparation, dismiss context pickers when their source is disabled, and cancel stale skill requests. Preserve same-named uploads as separate attachments, keep mention panels within resized viewports, and honor RTL navigation and long labels in context menus.

Share full-mode default actions across the + and @ launchers without losing uploads, image-picker handoff, scheduled tasks, automations, opt-in extensions, integration setup, skill creation/import, or terminal controls. Host actions override matching default IDs; lighter modes do not mount full-mode resource hooks. Keep skill review/save/cancel on the existing resource adapter, with duplicate-save protection and stale-request cleanup.

Route special-mode submissions through the normal host acceptance lifecycle, passing mode instructions separately as `composerModeContext` so hosts can revalidate captured integration context before dispatch. Retain the draft, mode, and attachments when preparation or submission fails.

Keep context actions reachable when a composer sits near the viewport top: use available space below the frame when the above-frame panel is too short, and recalculate placement as the visible viewport changes for mobile keyboards or zoom.
