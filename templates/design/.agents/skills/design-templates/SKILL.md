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
