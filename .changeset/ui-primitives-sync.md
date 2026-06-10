---
"@agent-native/core": patch
---

Add a byte-identity guard spec for shared ui primitives across templates, and resync all drifted primitives to their canonical versions.

The guard (`packages/core/src/templates/ui-primitives-sync.spec.ts`) hashes every `templates/*/app/components/ui/*.tsx` file and fails if any primitive diverges from the majority-held canonical without an explicit allow-list entry. The allow-list documents intentional deviations (custom-themed macros components, calendar DayPicker API version split, assets autoGrow textarea, etc.) so future drift is caught immediately.

Resynced primitives include: tooltip (Portal + z-[250] + text-sm canonical), dropdown-menu (IconCircleFilled + container prop), popover (PopoverAnchor + portalled prop), dialog (hideClose prop), sheet (showClose/showOverlay props), sidebar (SheetTitle/SheetDescription accessibility), command (DialogTitle accessibility), badge, separator, scroll-area, label, form, alert-dialog, aspect-ratio, carousel, collapsible, drawer, input-otp, resizable, toggle (svg helpers + min-w), hover-card (origin transform var), navigation-menu (open state classes), radio-group and context-menu (IconCircleFilled), plus "use client" removal from forms/mail artifacts.
