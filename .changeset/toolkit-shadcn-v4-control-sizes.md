---
"@agent-native/toolkit": minor
"@agent-native/dispatch": patch
---

Move the toolkit's Button, Switch, Select, and Input to shadcn new-york-v4 sizing. Buttons are 36px by default and 32px at `sm`, with new `xs`, `icon-xs`, `icon-sm`, and `icon-lg` sizes and a `secondary-destructive` variant for destructive row actions. Switch is 32x18 with a `size` prop (`sm` is 24x14), SelectTrigger and Input take `size="sm" | "default"` (32px or 36px), Toggle is 36px (`sm` 32px), and TabsList is 36px. Alert sets `text-sm` on the root, so titles are 14px, and AlertDescription uses relaxed leading. Adds the shadcn `InputGroup` (`InputGroupAddon`, `InputGroupInput`, `InputGroupButton`, `InputGroupText`, `InputGroupTextarea`) for fields with icons or inline actions. Dispatch's local Button, Switch, Input, Tabs, Toggle, and AlertDialog now re-export the toolkit's, so its tabs and toggles follow the same heights and its confirm dialogs stack above toolkit dialogs. The Dispatch app search matches the 32px toolbar buttons beside it.
