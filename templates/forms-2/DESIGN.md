# Visual Design Contract

Forms is a quiet, document-like workbench for building forms and reading what
people sent back. The shell stays out of the way; the form is the content.

## Product mode

- Mode: `operate`
- Audience and cadence: people who build and review forms several times a week.
- Primary workflow: start a form, publish it, share the link, read responses.

## Visual direction

- Direction name: Quiet paper
- Palette family: warm near-black ink on white, one saturated blue for the
  primary action, hairline borders instead of fills.
- Type treatment: Inter throughout; 14px labels, 18px section headings, a 28px
  form title on form pages and 40px on the form itself.
- Composition: a 250px left rail, a 48px top bar, and a 900px content column.
  The public form is a bare 700px column with no chrome.
- Shape language: 7-8px radii, 1px hairline borders, a soft ring shadow on inputs.
- Anti-references: page titles that repeat the navigation item, marketing and
  upgrade links in the rail, filled cards, decorative illustration.

## Guardrails

- Measured values live in `app/global.css` tokens; use them, not new colors.
- Keep the shell mounted above the outlet; the public form sits outside it.
- Never use browser `alert`, `confirm` or `prompt`; use dialog primitives.
