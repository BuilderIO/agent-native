---
name: sharing
description: >-
  Framework-level sharing and privacy for user-authored resources
  (dashboards, documents, forms, decks, etc.). Use when making a resource
  table ownable, wiring list/read/update access checks, or dropping the
  standard share dialog into a template.
scope: dev
metadata:
  internal: true
---

# Sharing — Private by Default, Explicit Share

## Rule

Any resource a user **creates** (dashboards, documents, forms, decks, compositions, booking links, issues, analyses) is **private to the creator** by default and visible to others only when they have been **explicitly shared** with or when the creator changes visibility to `org` or `public`.

This is the framework-level primitive. Every ownable resource gets it for free — same API, same UI, same skill.

Workspace apps are the intentional organization-scoped exception: their default
visibility is `org`, configurable by an organization owner/admin. The creator is
stored as the app owner, and the creator or an organization owner/admin can
change the app's visibility or manage its share grants.

## Concepts

### Three visibility levels

- **`private`** — owner + explicit share grants only. Default.
- **`org`** — owner + explicit grants + anyone in the same org (read-only).
- **`public`** — owner + explicit grants + **anyone with the link** (read-only). Public docs do NOT appear in other users' list/sidebar/search results — `accessFilter` omits them by default. They're reachable by id (`resolveAccess` admits them) so direct links and SSR routes like `/p/:id` keep working. If a list endpoint legitimately needs cross-user public discovery (a template gallery, etc.), pass `accessFilter(table, shares, ctx, minRole, { includePublic: true })`.

Visibility is coarse. Explicit share grants are fine-grained (per user, reusable
organization group, or per org).

### Roles on a share grant

- **`viewer`** — read only.
- **`commenter`** — read + add comments, but cannot edit the resource or manage shares.
- **`editor`** — read + write.
- **`admin`** — read + write + manage shares. Does NOT replace the single `owner_email` on the resource.

Share roles apply to one resource; organization roles apply to a team; app
roles apply within one app. These are separate permissions. For role setup,
use `agent-native-docs` to find the current organization and app-role guide.

Before adding an admin gate, identify which role system protects that operation
and use its existing role descriptor and permission checks. Do not replace role
checks with an email comparison or a custom `isAdmin` column.

### Anonymous public URLs stay separate

Form "publish" slugs, booking-link slugs, any feature that exposes a URL to unauthenticated users — these are a different axis and are NOT controlled by the sharing system. Keep them alongside it.

## Make a resource ownable

In your template's `server/db/schema.ts`:

```ts
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import {
  createSharesTable,
  ownableColumns,
} from "@agent-native/core/db/schema";

export const decks = pgTable("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
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

Add `agentRead: { actions: ["get-deck"] }` naming the MCP tool that reads one
resource, so the share panel can send it to Claude, Claude Code and Codex.

The `type` string is the stable id the UI and actions use. `getDb` is required — the framework-level share actions use it to reach your template's DB.

### Restricting public visibility and cross-org user shares

Some resources should NOT be reachable by an arbitrary authenticated user even with the link, and should NOT be shareable to an email outside the org. Two optional registration flags lock these axes down:

```ts
registerShareableResource({
  type: "extension",
  // ...
  allowPublic: false, // hides "Public" in the share dialog and rejects it server-side
  requireOrgMemberForUserShares: true, // user shares must target an org member or pending invitee
  supportsGroupShares: true, // enable reusable organization groups for this resource
});
```

- **`allowPublic: false`** — `set-resource-visibility('public')` throws `ForbiddenError`, `accessFilter` / `resolveAccess` treat any stored `'public'` row as private (defense in depth against bad data), and the share popover hides the "Public" option. `list-resource-shares` returns `policy.allowPublic: false` so the UI follows the server.
- **`requireOrgMemberForUserShares: true`** — `share-resource` looks up `principalId` in `org_members` and `org_invitations` (pending) for the resource's `orgId` and rejects user shares to anyone else. The same flag also pins `principalType: "org"` shares to the resource's own org — sharing to a *different* org would let that org's members run code in the viewer's auth context (same threat model as a public extension). (The flag name is kept for backward compatibility; treat it as "lock both user and org shares to the resource's org".)

Use both for resources that execute code or expose privileged data with the *viewer's* credentials. A public or cross-org-shared resource with that access could let an unrelated user act with the viewer's credentials.

Defaults match historical behaviour: `allowPublic: true`, `requireOrgMemberForUserShares: false`. Resources that don't set the flags work as before.

### Reusable organization groups

The workspace organization model stores reusable groups in
`workspace_user_groups`. Organization owners/admins manage the groups and their
members through the existing group actions. Set `supportsGroupShares: true` on a
resource registration to enable `principalType: "group"` in the generic share
actions and the shared popover's autocomplete. Group ids are always checked
against the resource's organization, and membership is evaluated at access time
so group changes apply to existing shares.

Workspace apps opt into this flag and use the organization default visibility
setting. The app creator is the durable `owner_email`, while organization
owners/admins receive admin access through the registration's
`canManageAccess` callback. For these registrations, a direct resource-level
`admin` share does not override that manager policy; it grants the editor role
for access checks, while only the creator and callback-approved managers can
change visibility or manage share grants.

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

`authorize` is a different axis, not an alternative: it gates whether the caller may run the operation at all, while `assertAccess` scopes which row they may touch. A write action restricted to some teammates needs both — `authorize: appAccess.requireAny(...)` on the action, `assertAccess` inside `run`.

## Create actions must set owner

When inserting a new row, fill `ownerEmail` and `orgId` from the request context:

```ts
import { fail } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";

const ownerEmail = getRequestUserEmail();
// Never fall back to a shared sentinel owner; require an authenticated session.
if (!ownerEmail) fail("Not authenticated", { statusCode: 401 });

await db.insert(schema.decks).values({
  id: crypto.randomUUID(),
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
import { ShareButton } from "@agent-native/toolkit/app/sharing";

// In the resource's header/toolbar:
<ShareButton
  resourceType="deck"
  resourceId={deck.id}
  resourceTitle={deck.title}
/>;
```

For list views, show `<VisibilityBadge visibility={row.visibility} />` next to each resource.

## Standard share surface

All app share popovers use one single-panel surface, top to bottom:

1. The invite field: one input for people, organization groups, and the
   org's agents, a role picker, and Invite.
2. People with access: the owner, people, groups, and agents in one list.
   Roles read "Can view", "Can comment", "Can edit", "Can manage access";
   Remove access lives in each row's role menu.
3. General access: Only people invited / Anyone at <org> / Anyone with the
   link.
4. A footer with Copy link (`shareUrl`) and a Send to menu.

Rules:

- Use the text-only `ShareTrigger` from `@agent-native/toolkit/sharing`.
- Never split people and agents into separate tabs or sections. Agents that
  can hold their own access are org service principals
  (`svc-<name>@service.<orgId>`); `list-resource-shares` returns them as
  `agents` for managers, and they are shared as ordinary `user` principals.
  Agents that connect over MCP or OAuth act as the person who connected
  them, so they get no row: put ways to hand the resource to them in Send to.
- Send to (`sendTo`) holds every handoff: `openInAgent` (Claude, Claude Code,
  Codex), resource-specific `items`, `copyAgentPrompt`, and
  `openMcpSettings`. Do not add another agent panel or tab.
- Declare `agentRead: { actions: ["get-<thing>"] }` (plus `idParam` when the
  tool's id argument is not `id`) on the registration. The panel then builds
  Open in Claude, Claude Code and Codex and Copy agent prompt itself: the
  prompt sends the agent to this app's MCP server to call that tool with the
  person's own permissions. Pass `sendTo.openInAgent` only when the app needs
  a different prompt. Agent-readable resources also get Copy agent link.
- When `supportsGroupShares` is enabled, groups come from the same invite
  field's autocomplete. Do not add a separate group-management surface.
- App-specific tabs (`shareTabs`) may remain when they represent a real
  domain action (for example, an embed-code editor).

## Actions available everywhere

The framework auto-mounts these actions in every template — no per-template boilerplate:

| Action                     | Args                                                                           | Purpose                                   |
| -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| `share-resource`           | `resourceType, resourceId, principalType, principalId, role, notify?, resourceUrl?, message?` | Grant a user, group, or org access. `notify` defaults to true for individual user shares; `resourceUrl` can provide the direct app link and `message` an optional short note for the notification email. |
| `unshare-resource`         | `resourceType, resourceId, principalType, principalId`                         | Revoke access.                            |
| `list-resource-shares`     | `resourceType, resourceId`                                                     | Current visibility + all share grants.    |
| `set-resource-visibility`  | `resourceType, resourceId, visibility`                                         | Change to `private` / `org` / `public`.  |

Both the agent and the UI use these same actions. The agent calls them as tools;
UI code should use `ShareButton` / `ShareDialog` or the action client hooks
instead of hand-writing route calls.

To re-skin the share notification email for the whole app, register
`overrideTransactionalEmail("core.resource-shared", render)` from a server
plugin. Do not fork `share-resource` or add another per-resource hook: the
registration's `getBrandName` / `getLogoUrl` / `getSender` / `getHeroHtml` /
`getShareEmailExtras` hooks still feed the default template and the override's
props. See
`/docs/deployment#email-templates`.

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

- **Personal-data apps** (mail) — user-scoped by design.
- **External source-of-truth data** — apply the access policy enforced by the upstream system.
- **Demo/boilerplate** (starter) — no resources.

For these, add a short note to the template's `AGENTS.md` explaining why.

## Debugging

- `ForbiddenError` from an action means the current user isn't owner / hasn't been shared / can't meet the role bar.
- If the agent can't see a resource it just created, check that the insert actually set `owner_email` from the request context.
- If a share doesn't take effect in the UI, confirm the template's `list-*` action uses `accessFilter` — the share rows are there but nothing is reading them yet.
