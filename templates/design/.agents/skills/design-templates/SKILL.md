---
name: design-templates
description: >-
  Find, save, copy, and adapt Design templates. Use when the user references a
  template, a prior design, or wants a reusable starting point.
---

# Design Templates

## Prerequisites

- Read `navigation` or call `view-screen` when the current template or design
  is unclear.
- Treat built-in and user-created entries as one template concept. Their
  ownership and available share/delete actions differ, but creation uses the
  same action.

## Workflow

1. **Resolve the starting point.** When the user mentions a template, past
   design, or prior work, call both `list-design-templates` and `list-designs`
   before generating. Match the requested name or id; ask only when multiple
   plausible results remain.
2. **Save a reusable template.** Call `save-design-as-template` with the source
   `designId`. The action snapshots inline screens, canvas dimensions,
   defaults, linked design system, and locked layers.
3. **Create from a template.** Call `create-design-from-template` with the
   resolved `templateId`. Pass `designSystemId` only when the user selected an
   override; the action access-checks it and returns the effective linked id.
4. **Stop after a pure copy.** If there is no prompt and no pending design-system
   adaptation, open the copied design and do not start generation.
5. **Adapt copied screens.** When the user supplied a prompt or chose a
   different accessible design system, call `get-design-snapshot` exactly once,
   then refine the existing unlocked content with `edit-design`. Never call
   `generate-design`, delete the copied screens, or recreate the template from
   scratch.
6. **Verify.** Read back the copied design and confirm its screens, canvas
   dimensions, linked design system, and locked-layer boundaries before
   reporting completion.

## The Template On Follow-Up Requests

A copied screen is edited in place. After the first refinement saves, the
design's own files are the *result*, not the template — so a later turn that
reads only `get-design-snapshot` has no idea what the template specified, and
fonts and artboard dimensions drift a little further on each request.

The two facts that drift are cheap, so they arrive on their own. `view-screen`
reports `design.createdFromTemplate` on every turn for a template-created
design, carrying `lockedDimensions` per screen and `lockedFonts`. Both are
captured from the template at copy time, so they describe the template even
after the design has been edited many times. Honour them in every
`edit-design` pass: never change them as a side effect of another request — no
resizing the artboard, changing a `canvasFrames` width or height, switching the
primary viewport, or substituting a typeface to fit new content.

## Changing The Size On Purpose

An explicit request for a different size wins over the template baseline. Apply
it with `update-design` `dataOperations`, setting `canvasFrames.<fileId>`, and
tell the user the design now differs from its template.

Pass every geometry value as a JSON number. `canvasFrames` keeps only finite
numbers on read, so `"width": "595"` writes successfully and then reads back as
*no* width — the update looks applied and silently is not. `update-design` now
rejects that write, and the error names the field; resend it as
`"width": 595`.

Call `get-design-template --designId="<id>"` when you need more than those two
facts — the template's original markup, or its locked layers — for example
before a structural edit or when the user asks how far the design has moved
from its template. The full template files are large, which is why they are a
deliberate second call rather than part of every turn.

## Locked Layers

`data-agent-native-locked="true"` is authoritative. Keep each locked element
and all descendants byte-for-byte unchanged during adaptation. If the user
explicitly wants one changed, ask them to unlock it in the Layers panel first.

## Ownership

- Built-in templates cannot be renamed, shared, or deleted.
- Owned user templates may be shared with the standard resource sharing UI and
  deleted with `delete-design-template`.
- Do not model templates as ordinary `designs` rows and do not invent alternate
  template action names.

## Related Skills

- `design-generation` — creating and refining Design screens.
- `design-systems` — applying linked systems and tokens.
- `sharing` — access and sharing rules for user-created templates.
