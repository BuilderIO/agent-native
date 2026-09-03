---
name: writing-reference-docs
description: >-
  How to write a function/hook/action reference section: plain-language
  signature, real arguments, escalating examples grounded in a real app,
  trimmed prose with no em dashes or semicolons. Use when writing or editing a
  packages/core/docs/content reference page.
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

## Related Skills

- **writing-agent-instructions** — the sibling guide for AGENTS.md/SKILL.md
  prose, which this borrows its "say it once, plainly" spirit from.
- **agent-native-docs** — how to look up the version-matched docs this skill
  helps you write.
- **internationalization** — localized copies under `content/locales/*` need
  the same edit when a source doc's meaning changes (see CLAUDE.md).
