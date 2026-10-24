# Submit a form response

A respondent opens a published form's public link, fills it in, and submits.
They see a confirmation, and the form owner sees the answer under Results.

## Sub-features

- `public-render` renders the form title as an H1 and its fields at
  `/f/<slug>`.
- `submit` shows `Response submitted` after `Submit`.
- `results` shows the answer on the form's Results tab.

## How to get to it (user POV)

- The public link icon next to the `published` badge in the editor, or
  `Copy public form link`.
- Visiting `/f/<slug>` directly.

## Driving it with drive.ts

Preconditions:

- The same isolated instance as
  [Create and publish a form](./forms-create-publish.md), with at least one
  published form. Run that recipe first in the same run.

- **Submit and confirm.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/forms-submit-response.ts [--param "title=Verify proof form"] [--param "answer=…"]`.
  The recipe picks the named published form, or the newest one, through
  `list-forms`. It fills the first textbox, sees the `Response submitted`
  heading, confirms the answer in `list-responses`, then finds it on
  `/forms/<id>?tab=results`.
- **Proof.** `evidence/forms-submit-response/` holds
  `02-public-form-submitted.png`, `03-results-tab.png`, and
  `action-list-responses.json` containing the answer.

## Gotchas

- Submitting within 500 ms of the form rendering returns `429` and shows a
  `Submitted too quickly` toast. This is the anti-bot fill-time check. Wait
  about 1 s after render, as the recipe does.

- `?tab=results` redirects to `?tab=responses`. Assert on content, not the URL.
- The recipe fills only the first textbox. Forms with required non-text
  fields need a custom recipe.
- In isolated mode the respondent is the signed-in `dev@local.test`, so
  `submitterEmail` is set. Anonymous submission is not covered.
