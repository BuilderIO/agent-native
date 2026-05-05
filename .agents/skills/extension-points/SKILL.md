---
name: extension-points
description: >-
  How extensions render as widgets inside other apps via named UI slots — the
  framework's VS-Code-style extension system. Use when a user asks to add a
  custom widget to an app surface (e.g. "add a sticky-note widget to my mail
  contact sidebar"), when wiring an ExtensionSlot in a template, or when
  marking an extension as installable into a slot.
---

# Extension Points

> **Terminology note.** "Extensions" in this doc are the framework's
> sandboxed Alpine.js mini-app primitive (see the `extensions` skill).
> They are NOT LLM "tools" (function calls). The slot-system tables are
> still physically named `tool_slots` and `tool_slot_installs` for
> back-compat — see the table at the bottom of this doc and the
> "Database & API names" section in the `extensions` skill.

## Mental model

**Slots** are named React-shaped holes in apps. **Extensions** are widgets
that opt into filling those holes. The framework matches them up by string
ID.

Three primitives:

| Primitive            | What it is                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| **Slot**             | `<ExtensionSlot id="..." context={...} />` dropped into an app's JSX                            |
| **Slot target**      | A row saying "extension X can render in slot Y" — `tool_slots` table (Drizzle: `extensionSlots`) |
| **Slot install**     | A row saying "user U wants extension X in slot Y" — `tool_slot_installs` (Drizzle: `extensionSlotInstalls`) |

When `<ExtensionSlot>` renders, it queries the user's installs and mounts
one `<EmbeddedTool>` (a small auto-sized iframe) per install, pushing the
slot's context into each via postMessage. (The component is still exported
as `EmbeddedTool` for back-compat.)

## Slot ID convention

`<app>.<area>.<position>` — three dot-separated lowercase-kebab segments.

- `mail.contact-sidebar.bottom`
- `mail.thread-toolbar.actions`
- `clips.right-panel.tabs`
- `calendar.event-detail.bottom`

Stable strings. Renaming a slot is a data migration — same as renaming a
route.

## How to author an extension that fills a slot

1. **Create the extension** with `create-extension`. The HTML can read
   `window.slotContext` to get the host's context (the contact email,
   recording id, etc.) and subscribe to changes via
   `window.onSlotContext(fn)`.

   ```html
   <div
     x-data="{ contact: null }"
     x-init="contact = window.slotContext; window.onSlotContext(c => contact = c)"
   >
     <template x-if="contact">
       <div class="rounded-lg border p-4 m-4">
         <p class="text-sm">
           Notes for <span x-text="contact.contactEmail"></span>
         </p>
       </div>
     </template>
   </div>
   ```

2. **Declare the slot target** with `add-extension-slot-target`:

   ```
   add-extension-slot-target { extensionId: "<id>", slotId: "mail.contact-sidebar.bottom" }
   ```

3. **Install it** for the current user with `install-extension`:

   ```
   install-extension { extensionId: "<id>", slotId: "mail.contact-sidebar.bottom" }
   ```

The slot will pick up the install on its next render (≤2s via polling sync,
immediate after the action's UI invalidation).

## How to declare a slot in your app

Drop `<ExtensionSlot>` wherever you want to allow extensions:

```tsx
import { ExtensionSlot } from "@agent-native/core/client/extensions";

// inside your component
<ExtensionSlot
  id="mail.contact-sidebar.bottom"
  context={{ contactEmail: contact.email, contactName: contact.name }}
  showEmptyAffordance
/>;
```

> The legacy import path `@agent-native/core/client/tools` continues to
> re-export the same component for back-compat with existing templates.

Props:

- `id` — slot identifier. Must match what extensions target.
- `context` — object pushed to each embedded extension as `slotContext`. Re-pushed
  whenever this prop changes.
- `showEmptyAffordance` — when true, shows a "+ Add widget" button in the
  empty state. Default: false (slot renders nothing when empty).
- `className` / `toolClassName` — optional styling hooks. (The `toolClassName`
  prop name is kept for back-compat; it styles the embedded extension's
  iframe wrapper.)

The host doesn't register slots in advance — `<ExtensionSlot>` is the
declaration. If an extension targets a slot ID that no app has placed, it
just won't render anywhere (the install record is harmless).

## Context contract

Each slot publishes whatever shape it wants via the `context` prop. There's
no schema enforcement in v1 — extensions should null-check fields and fail
gracefully if a field they expect is missing.

Document the context shape next to your `<ExtensionSlot>` so extension
authors know what to read. Convention: include the document in the slot
ID's prefix section so the agent can find it (`mail.contact-sidebar.*`
slots all publish `{ contactEmail, contactName }`).

## Agent actions

| Action                       | What it does                                                            |
| ---------------------------- | ----------------------------------------------------------------------- |
| `add-extension-slot-target`  | Mark an extension as installable into a slot (extension author opts in) |
| `install-extension`          | Install an extension into a slot for the current user                   |
| `uninstall-extension`        | Remove an extension from a slot for the current user                    |
| `list-extensions-for-slot`   | List installable extensions for a given slot ID                         |
| `list-extension-slots`       | List slot targets an extension declares                                 |

Typical flow when a user asks "add a CRM widget below my contacts":

1. `list-extensions-for-slot { slotId: "mail.contact-sidebar.bottom" }` —
   see what's already installable
2. If a fitting extension exists: `install-extension`
3. Otherwise: `create-extension` → `add-extension-slot-target` →
   `install-extension`

## Lifecycle

**Mount** — host calls the slot installs API, renders an `<iframe>` per
install. The iframe URL includes `?slot=<slotId>` so the runtime knows it's
embedded (enables auto-resize, suppresses anything that only makes sense
full-page).

**Context push** — host posts `agent-native-slot-context` immediately on
iframe load, and again on every prop change. The extension reads the
current value synchronously via `window.slotContext` and subscribes via
`window.onSlotContext(fn)` for live updates.

**Auto-resize** — when in slot mode, the iframe runtime measures its
content height and posts `agent-native-tool-resize` (postMessage type kept
for back-compat) to the host. The `<EmbeddedTool>` sets the iframe height
accordingly. Use `ResizeObserver` to follow content changes.

**Extension API** — embedded extensions have the full helper set:
`appAction`, `appFetch`, `dbQuery`, `dbExec`, `extensionFetch`,
`extensionData` (with `toolFetch` / `toolData` legacy aliases). Same auth
context as full-page extensions.

**Unmount** — uninstall deletes the install row. Polling sync invalidates
the `slot-installs` query and the host re-renders without the iframe.

## Permissions

- Installing requires viewer access to the extension. A user can only
  install extensions they have access to.
- Declaring slot targets requires editor access to the extension.
- Slot installs are per-user — installing a widget only affects the
  installing user's view. There's no org-wide "default install" in v1.
- Slots themselves are ungated. Any app code can drop an `<ExtensionSlot>`
  in any user's view; the slot's contents come from that user's installs.

## What this is NOT

- **Not a way to render arbitrary React in slots.** Slots only render
  Alpine.js iframe extensions. Same security/auth/sandbox as
  `/extensions/:id`.
- **Not cross-extension messaging.** Two extensions in the same slot can't
  read each other's `extensionData`. Use actions or app SQL if widgets need
  to coordinate.
- **Not a slot manifest.** Slot targets live in the `tool_slots` table
  (Drizzle export `extensionSlots`), not in the extension's HTML content.
  The agent can re-target an extension without rewriting it.
- **Not for arbitrary code modification.** If a user wants to change how
  the app itself behaves (not add a sandboxed widget), use the
  `self-modifying-code` skill instead.

## Cross-references

- `extensions` skill — authoring Alpine.js mini-apps (the substrate for widgets)
- `sharing` skill — how access flows from extension sharing to slot installs
- `context-awareness` skill — how extensions read what the user is looking at
- `actions` skill — how `install-extension` etc. are auto-mounted
