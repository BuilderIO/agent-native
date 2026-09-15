---
name: writing-reference-docs
description: >-
  How to write a function/hook/action reference section, and how to write or
  rework a whole app's multi-page doc set (Overview/Features/Talk to the
  Agent/Cross-App Use/Developer Guide): plain-language signature, real
  arguments, escalating examples grounded in a real app, verified agent
  behavior, trimmed prose with no em dashes or semicolons. Use when writing or
  editing a packages/core/docs/content reference page, or reworking a
  template-<app>*.mdx doc set.
scope: dev
metadata:
  internal: true
---

# Writing Reference Docs

This came out of rewriting `client-data.mdx`'s hook sections
(`useActionQuery`, `useActionMutation`, `callAction`, `useDbSync`) section by
section with the user. It captures the shape that emerged so the next
reference section starts from it instead of reinventing it.

## Rule

Document each function, hook, or action reference as: a plain-language
purpose statement, a bulleted argument list matching the real signature, two
or more escalating runnable examples grounded in a real app, and a one or two
sentence closing behavior note. Never a bare one-line description with a
single toy snippet.

## Why

The original `client-data.mdx` gave each hook one sentence and one minimal
snippet with no options argument shown at all. That hid real, common needs
(conditional fetching via `enabled`, a post-mutation side effect via
`onSuccess`) that readers would only discover by reading the source. It also
leaned on a hypothetical `leads` domain (`get-lead`, `create-lead`,
`archive-lead`) that reads as unconvincing next to an example grounded in a
real app with a real schema and real access rules.

## How

1. **Match heading level to role.** Hooks that solve the same kind of problem
   get grouped under one parent heading (e.g. `### Action hooks`) with each
   hook as a child heading below it. A utility that is not a hook (like
   `callAction`) is a sibling heading at the same level as the group, not a
   child of it, even if it lives right next to the group.
2. **Open with plain-language purpose, then link out.** State what the
   function is for in one or two sentences ("This hook is intended to be used
   for..."). If it wraps another library's hook (React Query's `useQuery`,
   `useMutation`), link its reference page instead of re-documenting fields
   you don't own.
3. **List real arguments as a short bullet list**, matching the actual
   exported signature in `packages/core/src/client/`, not a paraphrase. Read
   the source before writing the list. Skip the bullet-list format entirely
   for a function that takes only one argument. Fold that into a sentence
   instead:

   ```md
   `useActionQuery()` accepts three arguments:

   - **actionName**: the action's registered name.
   - **params**: the action's input, typed from its `defineAction()` schema.
   - **options**: everything from the [useQuery options](...) except
     `queryKey` and `queryFn`, which the hook sets itself.
   ```

4. **Give two or more escalating examples.** The first is the simplest
   possible call. The second demonstrates one real, common option (a
   conditional fetch, a success callback, a longer timeout), with one
   sentence before it explaining what's different and why it matters.
5. **Ground every example in a real reference app's real action**, not an
   invented one, e.g. `get-ticket`, `send-ticket-reply`, `update-ticket` from
   a real ticket-support example app, rather than `get-lead`/`create-lead`.
   Exception: if the page already threads a hypothetical domain across
   multiple sibling pages (a running example), keep using that domain in this
   page too. Enrich its snippets with the missing option; don't swap the
   domain out from under the other pages.
6. **Close with the one behavior fact a reader needs**, in one or two
   sentences: cache key, invalidation trigger, timeout.
7. **Prose rules, every sentence:** no em dashes, no semicolons (this
   includes table cells), short sentences. Split into two sentences instead
   of joining with either. Reference every function by name with parens,
   `useActionQuery()` not `useActionQuery`.
8. **Example values must mean something to a reader with zero app context.**
   Don't reuse an in-app sentinel value (like a `"me"` string a real action
   resolves specially) without explaining it. Use a literal, self-explanatory
   value instead, like a real-looking email address.

## Don't

- Don't introduce a new framework concept into the primary example just
  because it's technically correct for that hook. If most readers of this
  page will never need to write it themselves (e.g. wiring `ignoreSource` with
  a per-tab id), it belongs in the options table, not the main example, or on
  a deeper page like Advanced.
- Don't swap a page's running example domain without checking whether sibling
  pages share it. Grep the other draft pages for the same domain terms first.
- Don't leave a semicolon or em dash anywhere in the page, including table
  cells. Split into two sentences.
- Don't add a one-item options bullet list for a function that only takes a
  single argument. State it in a sentence instead.
- Don't paraphrase a signature from memory. Grep the actual export in
  `packages/core/src/client/` and read its real parameter and option types.

## App Doc Format (apps only)

This is a second, related pattern this skill covers: writing or reworking a
whole app's doc set under `packages/core/docs/content/template-<app>*.mdx`,
not a single function/hook/action reference section. It came out of reworking
Forms' docs (`template-forms*.mdx`) to match the shape Calendar's docs
(`template-calendar*.mdx`) had already established. It does not apply to a
standalone reference page like `client-data.mdx`.

### The five pages

An app's docs are five pages, in this order:

1. **Overview** (`template-<app>.mdx`) — marketing-level. What the app does, a
   "What it replaces" comparison, a short multi-app-workspace teaser linking
   to Cross-App Use, and a "What you can do with it" list linking into
   Features. No feature depth, no setup steps.
2. **Features** (`template-<app>-features.mdx`) — every feature area a user
   would actually use, ordered the way someone would approach the app (build,
   then publish, then protect, then analyze, then route), with
   `Steps`/`Callout`/`Table`/`Diagram` for how to set each one up.
3. **Talk to the Agent** (`template-<app>-agent.mdx`) — how the agent sees the
   user's screen, grounded in the app's real `view-screen`/`navigate` actions
   and application-state keys, then prompts by task in a `Cards` grid.
4. **Cross-App Use** (`template-<app>-integrations.mdx`) — how the app
   connects to Dispatch (the "same workspace: automatic" / "separate
   deployments: one manual step" split is generic framework behavior,
   identical across apps), then the app's own real cross-app mechanisms.
5. **Developer Guide** (`template-<app>-developers.mdx`) — quick start, an
   action reference table by category, the data model, an action walked
   through, a routes-reference `FileTree`, and how to customize it.

Calendar's docs are the reference implementation. Read them before writing the
equivalent page for another app.

### Match the audience to the page tier

Overview, Features, Talk to the Agent, and Cross-App Use are for an
interested but non-technical reader. Don't assume prior knowledge of the
framework's own vocabulary (SQL-backed, unauthenticated, endpoint, action) and
prefer plain equivalents ("the same form" instead of "the same SQL-backed form
definition"). Developer Guide is for developers: SQL, schemas, and action
names belong there, not on the earlier four pages.

### Don't force a section that doesn't apply

Calendar has capabilities other apps may not: a real `ExtensionSlot`
(documented in its own Talk to the Agent page), and a live external provider
(Google Calendar) it can escalate to with a raw API call. Before copying
either section into another app's docs, verify the app actually has the
underlying capability (grep for `ExtensionSlot` usage, grep for
`registerEvent`/`emit` calls or provider-API actions). If it doesn't, omit the
section entirely rather than writing around a capability that isn't there.
The goal is mirroring the *format*, not force-fitting content Calendar happens
to have.

### An action walked through (Developer Guide only)

Show the real source of one real action file, with `AnnotatedCode` line-range
annotations pointing at actual line numbers in that pasted source. Don't
synthesize a CLI invocation example instead. Pick an action with a genuinely
reusable pattern (a concurrency lock, a two-table uniqueness check, input
normalization), not just the simplest one.

## Verify Agent-Driven Claims

Applies broadly, to any docs page, reference section or app page alike.
Before writing that a prompt or an agent action "does X," confirm it actually
does, ideally by running the real action against the real app rather than
inferring behavior from reading the action's code or its `description` field
alone. Two things this catches that a code read alone won't: a missing
runtime prerequisite (an action implemented correctly but that throws because
a dependency like file storage isn't configured), and a claim that's flatly
untrue (an action that doesn't exist for what the doc describes, like "turn on
spam protection" when spam-protection keys are an app-wide Settings field with
no action that sets them). When a claim doesn't hold up, don't soften it into
a hedge. Either fix the doc to describe what's real, or cut the claim.

## Retiring or Merging a Doc Page

Applies broadly, to any page under `packages/core/docs/content`. Add the old
slug to `DOCS_SLUG_REDIRECTS` in
`packages/docs/app/components/docs-slug-redirects.ts` (a plain slug-to-slug
map, dependency-free, checked by `packages/docs/tests/redirects.test.ts`)
before deleting the old `.mdx` file. Don't leave a merged or renamed page
without a redirect entry, or the old URL just 404s.

## Localizing a Docs Restructuring

Applies broadly, to any page under `packages/core/docs/content`.
`pnpm guard:i18n-catalogs` checks three separate things after a docs
restructuring, and each needs a different fix:

- A nav label added or removed in `packages/docs/app/i18n/en-US.ts` (e.g. a
  new page's sidebar entry) needs the same key added or removed in every
  other locale file under `packages/docs/app/i18n/`. Reuse an existing
  sibling app's translation for the same concept (e.g. Calendar's
  `calendarFeatures`) instead of coining a new one.
- A source doc that changed meaningfully needs its locale copies under
  `content/locales/*` updated too, or the doc-coverage gap recorded as
  reviewed debt via `UPDATE_I18N_DOC_COVERAGE_BASELINE=1 pnpm
  guard:i18n-catalogs`. Diff the baseline file afterward to confirm it only
  changed the entries you expected.
- A short technical fragment (a diagram label, a product name) that's
  legitimately identical across languages (a shared loanword, a proper noun)
  isn't a translation gap. Add it to `scripts/i18n-no-translate-terms.txt`
  instead of forcing an artificial difference, but only after confirming that
  other locales which DID translate the surrounding text also left this exact
  fragment alone, not that it was simply missed.

## Related Skills

- **writing-agent-instructions** — the sibling guide for AGENTS.md/SKILL.md
  prose, which this borrows its "say it once, plainly" spirit from.
- **agent-native-docs** — how to look up the version-matched docs this skill
  helps you write.
- **internationalization** — localized copies under `content/locales/*` need
  the same edit when a source doc's meaning changes (see CLAUDE.md and
  "Localizing a Docs Restructuring" above for the guard/baseline mechanics).
