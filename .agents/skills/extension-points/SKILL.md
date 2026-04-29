---
name: extension-points
description: >-
  How tools render as widgets inside other apps via named UI slots — the
  framework's VS-Code-style extension system. Use when a user asks to add a
  custom widget to an app surface (e.g. "add a sticky-note widget to my mail
  contact sidebar"), when wiring an ExtensionSlot in a template, or when
  marking a tool as installable into a slot.
---

# Extension Points

## Mental model

**Slots** are named React-shaped holes in apps. **Tools** are widgets that opt
into filling those holes. The framework matches them up by string ID.

Three primitives:

| Primitive            | What it is                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| **Slot**             | `<ExtensionSlot id="..." context={...} />` dropped into an app's JSX             |
| **Slot target**      | A row saying "tool X can render in slot Y" — `tool_slots` table                  |
| **Slot install**     | A row saying "user U wants tool X in slot Y" — `tool_slot_installs` table        |

When `<ExtensionSlot>` renders, it queries the user's installs and mounts one
`<EmbeddedTool>` (a small auto-sized iframe) per install, pushing the slot's
context into each via postMessage.

## Slot ID convention

`<app>.<area>.<position>` — three dot-separated lowercase-kebab segments.

- `mail.contact-sidebar.bottom`
- `mail.thread-toolbar.actions`
- `clips.right-panel.tabs`
- `calendar.event-detail.bottom`

Stable strings. Renaming a slot is a data migration — same as renaming a
route.

## How to author a tool that fills a slot

1. **Create the tool** with `create-tool`. The HTML can read `window.slotContext`
   to get the host's context (the contact email, recording id, etc.) and
   subscribe to changes via `window.onSlotContext(fn)`.

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

2. **Declare the slot target** with `add-tool-slot-target`:

   ```
   add-tool-slot-target { toolId: "<id>", slotId: "mail.contact-sidebar.bottom" }
   ```

3. **Install it** for the current user with `install-extension`:

   ```
   install-extension { toolId: "<id>", slotId: "mail.contact-sidebar.bottom" }
   ```

The slot will pick up the install on its next render (≤2s via polling sync,
immediate after the action's UI invalidation).

## How to declare a slot in your app

Drop `<ExtensionSlot>` wherever you want to allow extensions:

```tsx
import { ExtensionSlot } from "@agent-native/core/client/tools";

// inside your component
<ExtensionSlot
  id="mail.contact-sidebar.bottom"
  context={{ contactEmail: contact.email, contactName: contact.name }}
  showEmptyAffordance
/>;
```

Props:

- `id` — slot identifier. Must match what tools target.
- `context` — object pushed to each embedded tool as `slotContext`. Re-pushed
  whenever this prop changes.
- `showEmptyAffordance` — when true, shows a "+ Add widget" button in the
  empty state. Default: false (slot renders nothing when empty).
- `className` / `toolClassName` — optional styling hooks.

The host doesn't register slots in advance — `<ExtensionSlot>` is the
declaration. If a tool targets a slot ID that no app has placed, it just
won't render anywhere (the install record is harmless).

## Context contract

Each slot publishes whatever shape it wants via the `context` prop. There's
no schema enforcement in v1 — tools should null-check fields and fail
gracefully if a field they expect is missing.

Document the context shape next to your `<ExtensionSlot>` so tool authors know
what to read. Convention: include the document in the slot ID's prefix
section so the agent can find it (`mail.contact-sidebar.*` slots all publish
`{ contactEmail, contactName }`).

## Agent actions

| Action                  | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `add-tool-slot-target`  | Mark a tool as installable into a slot (tool author opts in)  |
| `install-extension`     | Install a tool into a slot for the current user               |
| `uninstall-extension`   | Remove a tool from a slot for the current user                |
| `list-tools-for-slot`   | List installable tools for a given slot ID                    |
| `list-tool-slots`       | List slot targets a tool declares                             |

Typical flow when a user asks "add a CRM widget below my contacts":

1. `list-tools-for-slot { slotId: "mail.contact-sidebar.bottom" }` — see
   what's already installable
2. If a fitting tool exists: `install-extension`
3. Otherwise: `create-tool` → `add-tool-slot-target` → `install-extension`

## Lifecycle

**Mount** — host calls the slot installs API, renders an `<iframe>` per
install. The iframe URL includes `?slot=<slotId>` so the runtime knows it's
embedded (enables auto-resize, suppresses anything that only makes sense
full-page).

**Context push** — host posts `agent-native-slot-context` immediately on
iframe load, and again on every prop change. The tool reads the current value
synchronously via `window.slotContext` and subscribes via
`window.onSlotContext(fn)` for live updates.

**Auto-resize** — when in slot mode, the iframe runtime measures its content
height and posts `agent-native-tool-resize` to the host. The `<EmbeddedTool>`
sets the iframe height accordingly. Use `ResizeObserver` to follow content
changes.

**Tool API** — embedded tools have the full helper set: `appAction`,
`appFetch`, `dbQuery`, `dbExec`, `toolFetch`, `toolData`. Same auth context as
full-page tools.

**Unmount** — uninstall deletes the install row. Polling sync invalidates
the `slot-installs` query and the host re-renders without the iframe.

## Permissions

- Installing requires viewer access to the tool. A user can only install
  tools they have access to.
- Declaring slot targets requires editor access to the tool.
- Slot installs are per-user — installing a widget only affects the
  installing user's view. There's no org-wide "default install" in v1.
- Slots themselves are ungated. Any app code can drop an `<ExtensionSlot>`
  in any user's view; the slot's contents come from that user's installs.

## What this is NOT

- **Not a way to render arbitrary React in slots.** Slots only render
  Alpine.js iframe tools. Same security/auth/sandbox as `/tools/:id`.
- **Not cross-tool messaging.** Two tools in the same slot can't read each
  other's `toolData`. Use actions or app SQL if widgets need to coordinate.
- **Not a slot manifest.** Slot targets live in the `tool_slots` table, not
  in the tool's HTML content. The agent can re-target a tool without
  rewriting it.
- **Not for arbitrary code modification.** If a user wants to change how
  the app itself behaves (not add a sandboxed widget), use the
  `self-modifying-code` skill instead.

## Cross-references

- `tools` skill — authoring Alpine.js mini-apps (the substrate for widgets)
- `sharing` skill — how access flows from tool sharing to slot installs
- `context-awareness` skill — how tools read what the user is looking at
- `actions` skill — how `install-extension` etc. are auto-mounted
