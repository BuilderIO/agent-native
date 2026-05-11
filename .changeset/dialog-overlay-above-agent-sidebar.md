---
"@agent-native/core": patch
---

Raise shadcn floating-UI primitives (Dialog, AlertDialog, Sheet, Drawer, Popover, DropdownMenu, Tooltip, HoverCard, ContextMenu, Menubar, Select) from `z-50` to `z-[250]` so modal overlays cover the agent sidebar header (`z-[240]`). Fixes the case where the "Add Calendar" (and similar) modal opens but the agent chat panel underneath stays visible and interactive.
