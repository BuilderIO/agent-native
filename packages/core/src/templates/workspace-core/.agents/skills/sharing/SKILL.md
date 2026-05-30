---
name: sharing
description: >-
  Framework-level sharing and privacy for user-authored resources
  (dashboards, documents, forms, decks, etc.). Use when making a resource
  table ownable, wiring list/read/update access checks, or dropping the
  standard share dialog into a template.
---

# Sharing — Private by Default, Explicit Share

## Rule

Any resource a user **creates** (dashboards, documents, forms, decks, compositions, booking links, issues, analyses) is **private to the creator** by default and visible to others only when they have been **explicitly shared** with or when the creator changes visibility to `org` or `public`.

This is the framework-level primitive. Every ownable resource gets it for free — same API, same UI, same skill.

## Concepts

### Three visibility levels

- **`private`** — owner + explicit share grants only. Default.
- **`org`** — owner + explicit grants + anyone in the same org (read-only).
- **`public`** — owner + explicit grants + **anyone with the link** (read-only). Public docs do NOT appear in other users' list/sidebar/search results — `accessFilter` omits them by default. They're reachable by id (`resolveAccess` admits them) so direct links and SSR routes like `/p/:id` keep working. If a list endpoint legitimately needs cross-user public discovery (a template gallery, etc.), pass `accessFilter(table, shares, ctx, minRole, { includePublic: true })`.

Visibility is coarse. Explicit share grants are fine-grained (per user or per org).

### Roles on a share grant

- **`viewer`** — read only.
- **`editor`** — read + write.
- **`admin`** — read + write + manage shares. Does NOT replace the single `owner_email` on the resource.

### Anonymous public URLs stay separate

Form "publish" slugs, booking-link slugs, any feature that exposes a URL to unauthenticated users — these are a different axis and are NOT controlled by the sharing system. Keep them alongside it.

## Make a resource ownable

In your template's `server/db/schema.ts`:

```ts
import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const decks = table("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(), // adds owner_email, org_id, visibility
});

export const deckShares = createSharesTable("deck_shares");
```

Then register it **in `server/db/index.ts`** (not the schema file — keeps the schema file free of the `getDb` closure and avoids circular imports):

```ts
// server/db/index.ts
import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "deck",
  resourceTable: schema.decks,
  sharesTable: schema.deckShares,
  displayName: "Deck",
  titleColumn: "title",
  getResourcePath: (deck) => `/deck/${deck.id}`,
  getDb,
});
```

The `type` string is the stable id the UI and actions use. `getDb` is required — the framework-level share actions use it to reach your template's DB.

### Restricting public visibility and cross-org user shares

Some resources should NOT be reachable by an arbitrary authenticated user even with the link, and should NOT be shareable to an email outside the org. Two optional registration flags lock these axes down:

```ts
registerShareableResource({
  type: "extension",
  // ...
  allowPublic: false, // hides "Public" in the share dialog and rejects it server-side
  requireOrgMemberForUserShares: true, // user shares must target an org member or pending invitee
});
```

- **`allowPublic: false`** — `set-resource-visibility('public')` throws `ForbiddenError`, `accessFilter` / `resolveAccess` treat any stored `'public'` row as private (defense in depth against bad data), and the share popover hides the "Public" option. `list-resource-shares` returns `policy.allowPublic: false` so the UI follows the server.
- **`requireOrgMemberForUserShares: true`** — `share-resource` looks up `principalId` in `org_members` and `org_invitations` (pending) for the resource's `orgId` and rejects user shares to anyone else. The same flag also pins `principalType: "org"` shares to the resource's own org — sharing to a *different* org would let that org's members run code in the viewer's auth context (same threat model as a public extension). (The flag name is kept for backward compatibility; treat it as "lock both user and org shares to the resource's org".)

Use both for resources that execute code or expose privileged data with the *viewer's* credentials. Extensions ship with both set: an extension's HTML calls actions / SQL / the secrets-injecting proxy as the viewer, so a public or cross-org-shared extension would let a stranger run arbitrary code with someone else's auth context. `scripts/guard-extension-no-public.mjs` (CI + `pnpm prep`) statically enforces that the extension registration keeps both flags set.

Defaults match historical behaviour: `allowPublic: true`, `requireOrgMemberForUserShares: false`. Resources that don't set the flags work as before.

## Filter list/read queries

```ts
import { accessFilter } from "@agent-native/core/sharing";

const rows = await db
  .select()
  .from(schema.decks)
  .where(accessFilter(schema.decks, schema.deckShares));
```

`accessFilter` admits rows the current user owns, has been shared on, or that the user can reach via `org` visibility. `public` rows are NOT admitted by default — see the visibility section above for why and how to opt in.

## Guard write actions

```ts
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  schema: z.object({ id: z.string(), title: z.string() }),
  run: async (args) => {
    await assertAccess("deck", args.id, "editor");
    // ...proceed
  },
});
```

For delete actions use `"admin"` (or fold in `"owner"` to require the real owner).

## Create actions must set owner

When inserting a new row, fill `ownerEmail` and `orgId` from the request context:

```ts
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";

const ownerEmail = getRequestUserEmail();
// Never fall back to a sentinel like "local@localhost" — that pools every
// unauthenticated write into one shared tenant (see the 2026-04-29 leak and
// guard-no-localhost-fallback). Throw / 401 when there is no session instead.
if (!ownerEmail) throw new Error("Not authenticated");

await db.insert(schema.decks).values({
  id: nanoid(),
  title,
  data,
  ownerEmail,
  orgId: getRequestOrgId(),
  // visibility defaults to 'private'
  // ...
});
```

## Drop in the share UI

```tsx
import { ShareButton } from "@agent-native/core/client";

// In the resource's header/toolbar:
<ShareButton
  resourceType="deck"
  resourceId={deck.id}
  resourceTitle={deck.title}
/>;
```

For list views, show `<VisibilityBadge visibility={row.visibility} />` next to each resource.

## Actions available everywhere

The framework auto-mounts these actions in every template — no per-template boilerplate:

| Action                     | Args                                                                           | Purpose                                   |
| -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| `share-resource`           | `resourceType, resourceId, principalType, principalId, role, notify?, resourceUrl?` | Grant a user or org access. `notify` defaults to true for individual user shares; `resourceUrl` can provide the direct app link used in the notification email. |
| `unshare-resource`         | `resourceType, resourceId, principalType, principalId`                         | Revoke access.                            |
| `list-resource-shares`     | `resourceType, resourceId`                                                     | Current visibility + all share grants.    |
| `set-resource-visibility`  | `resourceType, resourceId, visibility`                                         | Change to `private` / `org` / `public`.  |

Both the agent and the UI call these via the same endpoints.

## Migration pattern for existing tables

When retrofitting an existing resource table:

1. Add `owner_email`, `org_id`, `visibility` columns (defaults `'local@localhost'`, `NULL`, `'private'`).
2. Backfill `owner_email` from any prior creator trail; otherwise leave the default.
3. Add the companion `{type}_shares` table.
4. Register via `registerShareableResource`.
5. Update list/read actions to use `accessFilter`.
6. Update update/delete actions to `assertAccess` with the correct role.
7. Add `<ShareButton>` to the resource header.
8. Add `getResourcePath` in the registration so agent-triggered shares can email a direct link even when no UI supplied `resourceUrl`.

## Templates that opt out

Sharing doesn't apply to:

- **Personal-data apps** (mail, macros) — user-scoped by design.
- **External source-of-truth apps** (issues → Jira, recruiting → Greenhouse) — ACL lives in the upstream system.
- **Demo/boilerplate** (starter) — no resources.

For these, add a short note to the template's `AGENTS.md` explaining why.

## Analytics (follow-up)

Dashboards and analyses in the `analytics` template currently live in the settings KV store (`u:<email>:dashboard-*` keys), not SQL. Sharing requires either migrating them to SQL tables (then applying this skill) or extending the settings store with a parallel share overlay. This is a tracked follow-up — see the analytics template's `AGENTS.md`.

## Debugging

- `ForbiddenError` from an action means the current user isn't owner / hasn't been shared / can't meet the role bar.
- If the agent can't see a resource it just created, check that the insert actually set `owner_email` from the request context.
- If a share doesn't take effect in the UI, confirm the template's `list-*` action uses `accessFilter` — the share rows are there but nothing is reading them yet.
