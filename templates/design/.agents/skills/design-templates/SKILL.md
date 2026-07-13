---
name: design-templates
description: Save designs as reusable templates and instantiate new designs from saved or built-in templates.
scope: both
---

# Design Templates

Use this skill when the user says "save this as a template", "make a template
out of this", "start from the checkout template", "like our onboarding flow",
or otherwise references reusable or past design structure.

## Lifecycle

- **Find templates:** call `list-templates` before generating from scratch when
  the prompt references an existing design, template, or prior work. It returns
  built-in templates plus saved template designs the caller can access.
- **Save a template:** call `save-as-template` with `designId`. It creates a
  frozen deep copy owned by the caller. Do not rename it to "Copy of ...";
  rename later with `update-design` if needed.
- **Instantiate:** call `create-design` with `templateId`. Saved templates copy
  screens server-side; built-in templates with seed screens do the same.
  Brief-driven built-ins create a shell and then need normal generation.
- **Pure copy:** if the user selected a saved template and gave no prompt, stop
  after `create-design`; open the result in overview. No pending generation and
  no chat handoff is needed.
- **Adaptation:** if a prompt is present, treat copied screens as the source of
  truth. Use `edit-design`, `apply-visual-edit`, or focused file updates to
  adapt them. Do not regenerate from scratch or add duplicate screens.
- **Re-skin:** when `templateApplied.designSystemMismatch` is true, first adapt
  the copied screens to the selected design system tokens, then apply the user's
  requested content or flow changes.
- **Curate:** templates are ordinary designs with `isTemplate: true`. Rename,
  edit, share, or delete them through the normal design/update/share/delete
  actions. "Remove from templates" is `update-design` with `isTemplate: false`.

## Provenance

New designs seeded from a template store `data.templateProvenance` with the
template id, title, and applied timestamp. This is a snapshot, not a foreign
key; deleting or untemplating the source never changes instantiated designs.

## Built-in Template Ids

- `starter:landing`
- `starter:dashboard`
- `starter:mobile-app`
- `starter:pricing`
- `starter:wireframe-kit`
