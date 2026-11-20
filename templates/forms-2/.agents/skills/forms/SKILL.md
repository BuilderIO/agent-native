---
name: forms
description: >-
  The Forms app's block model, form lifecycle, public respond flow, and action
  map. Use when creating or editing forms, blocks, logic, submissions,
  insights, or anything under shared/form-model.
scope: dev
---

# Forms

## Model

A form is a flat, ordered block list (`shared/form-model/`). Every block is
`{ uuid, type, groupUuid, groupType, payload }`; `blockListSchema` validates it
and keeps unknown payload keys.

- A question is the blocks sharing a `groupUuid`: a `TITLE` block plus one input
  block, or one option block per choice (`MULTIPLE_CHOICE_OPTION`, `CHECKBOX`,
  `DROPDOWN_OPTION`, `MULTI_SELECT_OPTION`). The group uuid is the question id and
  the key of every answers object. Settings live on the group's first input block.
- `deriveQuestions(blocks)` is the only place questions come from.
- `PAGE_BREAK` opens a page; `THANK_YOU_PAGE` opens the end page.
- `CONDITIONAL_LOGIC` blocks hold `{ condition, actions }`. Comparisons and actions
  are in `types.ts`. `evaluatePage`, `resolveNextStep` and the `PageStack` helpers
  drive the respondent's Next and Back; Back pops visited pages.
- `validatePage` (client, one page) and `validateSubmission` (server, walks the
  pages the answers lead through) share one rule set and error codes.
- Agents add content with `compose-form` (items in, blocks out, same save path as
  `save-form-draft`); `save-form-draft` is for precise edits of a list read from
  `get-form`, where every text-bearing block needs `payload.text`.
- Build blocks in code with `questionBlocks()` and `createBlock()`; fixtures are
  in `fixtures.ts`.

## Lifecycle

`blank` -> `draft` (any edit) -> `published` (`publish-form`). A published form
edited later keeps serving its published blocks; edits go to `draftBlocks` and the
editor shows Changes until `publish-form` or `discard-form-draft`. `deleted` is
soft and `restore-form` returns the previous state. `isClosed` is separate.

`publish-form` materializes `questions` from the published blocks. A question
removed by a republish keeps its row with `isDeleted`, so old submissions keep a
column; submission tables and CSV read `questions`, never the current blocks.

## Respond

`/f/:formId` calls `get-public-form` (open, closed or unavailable; unavailable
never says why). `submit-response` is idempotent on `sessionId`, re-checks
published and not closed, validates server-side, and stores only answers to
questions the respondent saw.

## Theme and custom CSS

`settings.theme` (`shared/theme/form-theme.ts`: preset `light`/`dark`, font from an
allowlist of open fonts, `background`/`text`/`buttonBackground`/`buttonText`/`accent`
as `#rrggbb` or `#rrggbbaa`, `pageWidth`, `baseFontSize`, `buttonRadius`, `fieldRadius`) and
`settings.customCss` (max 20 KB) are read with `get-form` and written with
`update-form-settings`. They save immediately, with no draft step, so a change is
on the public form at once. `theme` replaces the whole object; omitted colours
come from the preset. The editor's Customize panel uses the same action.

The theme also carries every Advanced field, all optional, lengths in integer px:
- Images (hosted `http(s)` or `/` URLs, uploaded through the framework file storage,
  never inlined): `logoUrl` + `logoWidth`/`logoHeight`/`logoRadius`; `coverUrl` +
  `coverHeight` (% of viewport height); `backgroundImageUrl` +
  `backgroundImageSize` (`cover`/`contain`) + `backgroundImageAttachment`
  (`fixed`/`scroll`). The background colour is the fallback.
- Inputs: `inputWidthMode` (`fixed`/`full`), `inputWidth`, `inputHeight`,
  `inputBackground`, `inputPlaceholder`, `inputBorderColor`, `inputBorderWidth`,
  `fieldRadius`, `inputMarginBottom`, `inputPaddingX`.
- Buttons: `buttonWidthMode` (`auto`/`full`/`fixed`), `buttonWidth`, `buttonHeight`,
  `buttonAlign` (`left`/`center`/`right`), `buttonFontSize`, `buttonRadius`,
  `buttonMarginY`, `buttonPaddingX`.

Only keys that are set produce CSS (`themeRules`), so an untouched form keeps the
stock look. Hooks added for this: `.forms-actions` (the button row), `.forms-cover`,
`.forms-logo`.

Custom CSS is stored through `sanitizeCss` (no `<`, balanced braces) and rendered
only in Preview and `/f/:id`, inside `.forms-surface { ... }`, never in the editor
or app chrome. Stable class hooks on the respondent DOM: `.forms-root` (page
column), `.forms-page` (the current page's form), `.forms-question`,
`.forms-question-title`, `.forms-title` (form and thank-you titles),
`.forms-input` (fields and option cards), `.forms-button` (Back, Next, Submit),
`.forms-thank-you`.

## Mentions (answer piping)

A text block, heading or question title can hold mention tokens
(`shared/form-model/mentions.ts`; `parseMentions`, `serializeMentions`,
`mentionToken`): `{{answer:<questionId>}}` is the respondent's answer to that
question (the group uuid, from `get-form` or `deriveQuestions`), and
`{{meta:submission-id}}`, `{{meta:respondent-id}}` and `{{meta:form-name}}` are
metadata. Write them as plain text in a `compose-form` text, heading or question
title. The editor draws them as pills; Preview and `/f/:id` replace them with the live
answer (empty when unanswered; the submission id fills in after submit). Exports,
CSV and insights keep the raw token text. Only earlier questions make sense to
mention, since later ones are unanswered.

## Templates and start screen

`shared/form-templates` holds the built-in templates (`contact-form`,
`registration-form`, `customer-feedback`, `trivia-quiz`, `web-project-intake`,
`personality-quiz`); `buildTemplate(id)` returns fresh blocks. `create-form` takes
`templateId` to start from one. The editor's blank-form start screen offers Create
with AI (opens the agent chat prefilled for this form), Use a template and Import
form (CSV, Markdown, text and JSON parse in the browser; PDF, Word and images go to
the agent with the file attached, which builds the form with `compose-form`).

## Hidden and calculated fields

`HIDDEN_FIELDS` and `CALCULATED_FIELDS` blocks hold `fields: [{ id, name, ... }]`; each named field is a
derived question of type `HIDDEN_FIELD` or `CALCULATED_FIELD`, so it gets a Submissions and CSV column and an
`{{answer:<field id>}}` mention. A hidden field takes the `/f/:id?<name>=value` query parameter of the same
name (nothing else is stored). A calculated field has a `type` (`number` or `text`, required to take part)
and an `initialValue`; the logic action `calculate` (`fieldId`, `operator` add, subtract, multiply, divide,
set or formula, `value`) updates it. `calculateFields` recomputes every value from the current answers, in
form order, in the renderer and again in `submit-response`, which ignores any submitted value. Neither block is
shown to respondents. `compose-form` takes `hidden_field` and `calculated_field` items and a `calculate` logic action.

## Folders, order and versions

A workspace holds forms and one level of folders (`forms.folderId`, route
`/workspaces/:id/folders/:folderId`). `move-form` takes `workspaceId` plus an
optional `folderId`; without it the form lands at the workspace's top level.
`list-forms` takes `folderId` (an id, or `"root"` for forms outside every folder).
`delete-folder` trashes the folder and returns its forms to the top level.
`reorder-forms` stores each form's `position` for one workspace or folder.

Every publish saves a version (blocks plus settings); draft saves snapshot at most
once per 5 minutes and edits inside that window merge into the same version, so a
publish snapshot is never overwritten. A form keeps 50 versions. The newest is the
current one. `restore-form-version` writes a version's blocks to the draft and its
settings to the form; the published blocks stay live until `publish-form`.

## Share, embeds and Insights views

The Share tab builds three embeds from one option set (`app/components/share/embed-code.ts`):
Standard (an iframe), Popup (a trigger element plus `/forms-embed.js`) and Full page
(a full-bleed iframe document). Options travel as `/embed/:id` query parameters
(`hideTitle`, `alignLeft`, `transparentBackground`, `dynamicHeight`, `trackEvents`);
an option that is off is left out. `/embed/:id` is chromeless and public like `/f/:id`;
it records visit, start and page events only with `trackEvents=1`. With
`dynamicHeight=1` it posts `{ type: "forms:height", height }` to its parent and
`/forms-embed.js` (a static asset in `public/`) resizes the iframe.

Insights has Answers, Visits and Drop-offs views. `get-form-insights` also returns
`completionDurationMs`; `uniqueRespondents` counts distinct respondent ids from visit
events (`data.respondentId`) and completed submissions. `get-form-visit-series` gives
visits per hour or day; `get-form-dropoffs` gives, per question, the sessions that
answered it and those whose last answer it was without submitting.

## Custom domains

Settings > Domains (`add-domain`, `list-domains`, `verify-domain`, `delete-domain`).
A domain starts pending with a CNAME record (to `FORMS_DOMAIN_CNAME_TARGET`) and a TXT
record `_forms-verify.<host>` = `forms-verify=<token>`. `verify-domain` does a Node DNS
TXT lookup and only a matching record makes it verified; a missing record or a failed
lookup leaves it pending and says which. `map-domain-form` serves a published form on a
verified domain at `/<slug>`: the `$slug` route reads `window.location.host` and calls the
public `get-domain-form`, so the SSR shell stays the same for every visitor.

`GET /_domains/allowed?domain=<host>` answers 200 only for verified domains. It is
Caddy's on-demand TLS `ask` endpoint. This app issues no certificates; run Caddy in front:

```
{
  on_demand_tls {
    ask http://forms-app:3000/_domains/allowed
  }
}
https:// {
  tls {
    on_demand
  }
  reverse_proxy forms-app:3000
}
```

Caddy must pass the original `Host` header (its `reverse_proxy` does by default).

## Access

Workspaces belong to the org (`orgId`); outside an org they belong to their
creator. Every authenticated action goes through `actions/_access.ts`.
The default workspace is created on the first authenticated read, never at boot.

## Dev data

`pnpm script seed-forms` creates the fixture forms (`fixture-*`), the Studio and
Ops workspaces, and the Event feedback form. `--fresh` leaves an account with only
its default workspace.
