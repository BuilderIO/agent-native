---
name: changelog
description: >-
  How to keep each app's user-facing changelog. Use when you ship a change a
  user would notice (a new feature, a visible improvement, a bug fix), when
  wiring the in-app "What's new" surface into a template, or when releasing
  pending changelog entries.
scope: dev
metadata:
  internal: true
---

# Changelog — user-facing "What's new"

Every template app keeps a `CHANGELOG.md` of **user-facing** changes that
renders in-app via the command menu (Cmd+K → "What's new") and on the settings
page. The flow mirrors changesets so it survives many agents working in
parallel: each change drops a small **pending entry file**, the in-app surface
reads pending files plus `CHANGELOG.md`, and a later **release** can roll those
pending files into dated `CHANGELOG.md` sections.

## When to add an entry

Add an entry whenever you ship something a user of that app would notice:

- a new capability or surface,
- a visible improvement (speed, layout, copy, defaults),
- a bug fix that affects behavior they'd see.

Do **not** add entries for refactors, internal tooling, tests, dependency
bumps, or anything invisible to the end user. The changelog is product notes,
not a commit log — write it the way you'd describe the change to a customer.

## How to add an entry

From the app directory (the template you changed):

```bash
agent-native changelog add "Recordings can be trimmed before sharing" --type added
agent-native changelog add "Faster transcript search" --type improved
agent-native changelog add "Fixed a crash when opening an empty folder" --type fixed
```

`--type` is one of `added`, `improved`, `fixed`, `changed`, `removed`,
`security` (aliases like `feature`, `bugfix`, `enhancement` are accepted). This
writes `changelog/<date>-<slug>.md` — one file per change, so parallel work
never conflicts. You can also hand-write that file; the frontmatter is just:

```md
---
type: added
date: 2026-06-23
---
Recordings can be trimmed before sharing.
```

## Writing good entries

- One user-facing sentence, present tense, no internal jargon or file names.
- Lead with the benefit ("Recordings can be trimmed…"), not the mechanism.
- Markdown is allowed (bold, links) but keep it short — it renders as a bullet.

## Releasing

`release` stamps every pending entry into `CHANGELOG.md` under a dated
`## <date>` section (grouped by type) and deletes the pending files:

```bash
agent-native changelog release            # uses today's date
agent-native changelog list               # preview pending + released
```

Releasing is usually done at deploy/merge time to keep the source tree tidy.
The in-app surface imports `CHANGELOG.md?raw`, and the core Vite plugin merges
adjacent `changelog/*.md` pending entries into that raw markdown at dev/build
time, so product notes become visible without waiting for a manual rollup.

## Wiring the in-app surface (once per template)

Templates already get the rendering for free from `@agent-native/core`. To
expose it in an app:

1. **Command menu** — pass the app's own changelog to `CommandMenu`:

   ```tsx
   import changelog from "../CHANGELOG.md?raw";
   // ...
   <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} changelog={changelog}>
     {/* existing groups */}
   </CommandMenu>
   ```

   This adds a "What's new" entry with an unseen-release dot and an in-app
   dialog — no other wiring needed.

2. **Settings** (optional) — drop the card on the settings page:

   ```tsx
   import { ChangelogSettingsCard } from "@agent-native/core/client";
   import changelog from "../CHANGELOG.md?raw";
   // ...
   <ChangelogSettingsCard markdown={changelog} />
   ```

`CHANGELOG.md?raw` is inlined by Vite at build time, so this works on every
host with no server route or runtime file access.

## Checklist

- [ ] Shipped a user-visible change? Run `agent-native changelog add "…"`.
- [ ] New template UI? Pass `changelog` to its `CommandMenu` and seed a
      `CHANGELOG.md`.
- [ ] Releasing/deploying? Optional: `agent-native changelog release` rolls
      pending → dated sections and deletes the pending files.
