---
title: "Sharing & Privacy"
description: "Google-Docs-style sharing, built into the framework. Every user-created resource — docs, dashboards, designs, decks, clips, recordings, forms — gets the same private-by-default model with one consistent share UI."
---

# Sharing & Privacy

Every resource a user creates in an agent-native app — a document, a dashboard, a design, a deck, a video edit, a screen recording, a meeting transcript, a form, a booking link — is **private to the creator by default**. Other people see it only when the creator explicitly shares it, or changes its visibility to `org` or `public`.

It looks and works like Google Docs. The same share button, the same dialog, the same three-tier visibility model, the same per-user/per-org grants — across every template, with no per-app reinvention.

## Why one model {#why}

Most app frameworks make sharing a per-feature project. The result: every doc-like surface ends up with its own share dialog, its own permissions schema, its own access-check bugs. In agent-native, sharing is a **framework primitive**. The schema columns, the access-check helpers, the share popover, and the agent-callable share actions all ship with the core. A new template gets the full sharing story by adding two columns and one line of registration.

This also means the agent never has to learn a new sharing model per app. Tell the agent "share this with Alice as an editor" in any template and the same `share-resource` action fires.

## The three visibility levels {#visibility}

Coarse visibility lives on the resource itself; fine-grained grants live in a companion shares table.

| Visibility | Who can see it                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `private`  | Owner + people explicitly granted. **Default for every new resource.**                              |
| `org`      | Owner + explicit grants + anyone in the same organization (read-only).                              |
| `public`   | Owner + explicit grants + anyone with the link (read-only). Doesn't appear in others' lists/search. |

`public` is a deliberately quiet level: a public resource is reachable by direct link, but it does **not** show up in other users' sidebars, lists, or search. That keeps "public for sharing the URL" separate from "public for cross-user discovery." Galleries and template catalogs that genuinely want cross-user discovery opt in explicitly.

## Roles on a share grant {#roles}

When you share with a specific user or org, you pick a role:

- **Viewer** — read only.
- **Editor** — read + write.
- **Admin** — read + write + manage shares (can add/remove other people).

`admin` does NOT change ownership — there's still exactly one owner per resource, distinct from the share grants.

## What's covered {#covered}

Every template that stores user-authored work uses this model. Concretely:

- **Content** — documents
- **Slides** — decks
- **Design** — designs and assets
- **Video** — compositions
- **Clips** — screen recordings (Loom-style)
- **Calls** — meeting recordings and transcripts (Granola-style)
- **Meeting Notes** — transcripts and summaries
- **Forms** — form definitions
- **Calendar** — events and booking links
- **Analytics** — dashboards (rolling out — see the analytics template's `AGENTS.md`)
- **Tools** — sandboxed mini-apps (see [Tools](/docs/tools#sharing))

Every one of these uses the same `ownableColumns()` schema helper, the same `share-resource` action, and the same `<ShareButton>` UI. Move from one template to another and the share dialog looks identical.

## What's not covered {#not-covered}

A few areas are intentionally outside the sharing system:

- **Personal-data apps** (Mail, Macros) — user-scoped by design. There's no "share my inbox" concept.
- **External source-of-truth apps** (Issues → Jira, Recruiting → Greenhouse) — access control lives in the upstream system, not the agent-native app.
- **Anonymous public URLs** — form publish slugs and booking-link slugs that expose a URL to logged-out users are a separate axis. They live alongside the sharing system, not on top of it.

## The share UI {#share-ui}

Every shareable resource gets a share button in its header. Clicking it opens a popover anchored to the button (not a modal) with:

- Visibility selector (`Private` / `Organization` / `Public link`).
- "Add people or teams" autocomplete — search users in the org or paste an email.
- A list of current grants with role pickers and a remove control.
- A copy-link button that respects the current visibility.

The share button is a single import:

```tsx
import { ShareButton } from "@agent-native/core/client";

<ShareButton
  resourceType="deck"
  resourceId={deck.id}
  resourceTitle={deck.title}
/>;
```

For lists, drop a `<VisibilityBadge visibility={row.visibility} />` next to each row so users can see at a glance what's private vs. shared.

## Same model, agent and UI {#agent-and-ui}

The framework auto-mounts these actions in every template — the agent calls them as tools, the UI calls them as HTTP endpoints:

| Action                    | What it does                                      |
| ------------------------- | ------------------------------------------------- |
| `share-resource`          | Grant a user or org access at a specific role.    |
| `unshare-resource`        | Revoke access for a user or org.                  |
| `list-resource-shares`    | Show current visibility plus all explicit grants. |
| `set-resource-visibility` | Change to `private`, `org`, or `public`.          |

Tell the agent "share this design with the marketing team as editors" and it calls `share-resource` against the same endpoint the UI uses. The result shows up in the share dialog the next render.

## Building it into a new template {#building}

If you're creating a template (see [Creating Templates](/docs/creating-templates)), wiring sharing in is short. Two additions to your schema:

```ts
import {
  table,
  text,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const decks = table("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  ...ownableColumns(), // adds owner_email, org_id, visibility
});

export const deckShares = createSharesTable("deck_shares");
```

One registration call in `server/db/index.ts`:

```ts
import { registerShareableResource } from "@agent-native/core/sharing";

registerShareableResource({
  type: "deck",
  resourceTable: schema.decks,
  sharesTable: schema.deckShares,
  displayName: "Deck",
  titleColumn: "title",
  getDb,
});
```

After that, list/read queries pass through `accessFilter()` and write actions use `assertAccess()` to enforce roles. The full pattern (including create-action ownership stamping and the migration recipe for existing tables) lives in the `sharing` agent skill — the agent reads it on demand when building a sharing-aware feature.

## Security guarantees {#security}

Sharing rides on the framework's broader data-scoping model. The two non-negotiable rules:

- **No unscoped queries.** Every query against an ownable table must go through `accessFilter()` (lists), `resolveAccess()` (read-by-id), or `assertAccess()` (writes). A CI guard fails the build if a query against an ownable table runs without one of these helpers.
- **Org isolation.** Resources tagged with an `org_id` are invisible to users from other orgs even to the agent. The active-org session value flows through to SQL, so cross-org leaks are impossible by construction.

See [Security & Data Scoping](/docs/security) for the full model and threat surface.

## See also {#see-also}

- [Security & Data Scoping](/docs/security) — the access-filter and ownership model that sharing rides on.
- [Authentication](/docs/authentication) — sessions, organizations, and how identity flows into the request context.
- [Tools](/docs/tools#sharing) — sharing in the sandboxed mini-app surface.
- [Creating Templates](/docs/creating-templates) — wiring `ownableColumns` into a new template's schema.
