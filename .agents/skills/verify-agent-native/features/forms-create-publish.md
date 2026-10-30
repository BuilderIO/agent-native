# Create and publish a form

A Forms user starts a blank form, names it, adds a field, and publishes it.
The form then shows as `published` in the editor and the forms list, with a
public link.

## Sub-features

- `create-blank` opens a new form editor through `Skip prompt`.
- `edit-title` persists the `Form Title` value.
- `publish-empty-rejected` refuses to publish a form with no fields.
- `add-field` adds a `Short Text` field from the `Add Field` menu.
- `publish` flips the status to `published` and exposes `Copy public form link`.
- `list` shows the form on `All forms`.

## How to get to it (user POV)

- Sidebar `New form` button, then `Skip prompt` in the dialog.
- Header `New Form` button on `/forms`.
- Empty-state `Create Form` button on `/forms` when there are no forms.
- Describing the form in the `New form` dialog and choosing `Send prompt`
  hands off to the agent. This needs a connected model.

## Driving it with drive.ts

Preconditions:

- An isolated Forms instance: `launch.ts --app forms --run <run-id>`, and
  `doctor.ts --run <run-id>` is ok.

- **Create, edit, publish, read back.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/forms-create-publish.ts --param "title=Verify proof form"`.
  The recipe:
  - lands on `/forms/<id>?tab=edit`
  - shows the toast `Cannot publish: form has no fields` after the first
    `Publish`
  - shows the toast `Form published!` after `Add Field` → `Short Text` →
    `Publish`
  - reads back `get-form` with `status: "published"`, the title, and one
    `text` field
  - finds the title on `/forms`.
- **Proof.** `evidence/forms-create-publish/` holds `02-editor-published.png`
  (the `published` badge), `03-forms-list-after.png`, and
  `action-get-form.json`.
- **Other entry points.** The recipe covers the sidebar `New form` button
  only. For the header `New Form` or empty-state `Create Form` button, copy the
  recipe and swap the first click to
  `page.getByRole("banner").getByRole("button", { name: "New Form" })` or
  `page.getByRole("button", { name: "Create Form" })`.

## Gotchas

- `failedResponses` always contains one `400 POST …/update-form`. That is the
  expected empty-publish rejection, not a regression.
- There are two `New form` / `New Form` buttons (sidebar and header). Scope the
  locator to `navigation` or `banner`, or it matches both.
- Title edits autosave 500 ms after the last keystroke, not on blur. Publishing
  flushes the save, so read stored state after a later step, not straight after
  typing.
