---
name: security
description: >-
  Secure app data, actions, routes, and external input. Use when changing
  authentication, authorization, database access, uploads, untrusted content,
  or server-side requests to user-provided URLs.
scope: dev
---

# Security

## Rule

Treat each action, route, query, and external request as a trust boundary.
Validate inputs, check the caller's authority for every row, and fail closed
when access cannot be established.

## Validate input and queries

- Define action inputs with a Zod `schema`; validate data from forms, URLs,
  providers, and files before using it.
- Build database queries with Drizzle. For raw SQL, bind values as parameters;
  never concatenate user input into SQL text.
- Keep large uploads and file contents in file storage. Store only their
  returned ids or URLs in SQL.

## Authorize rows and actions

Choose a table's access model when designing its data:

| Data | Access model |
| --- | --- |
| Private user rows | Store `owner_email` and filter every read and write by the current caller. |
| Organization-wide catalog | Store `org_id` and scope action queries to the active org; gate restricted mutations by org or app role. |
| Team-shared or individually shareable resources | Use `ownableColumns()`, register the resource type, and check access with the sharing helpers. |
| Child rows | Check access to the parent before reading or changing children; add any child-specific rules in the action. |

Do not make a team-wide catalog private by adding a per-user owner filter. For
an organization-owned catalog, `org_id` without `owner_email` is valid: scoped
database tools expose only the active organization's rows, while app actions
still need their own org filter and authorization. For resources users can
share, use these helpers:

- Add `accessFilter(table, sharesTable)` to list and read-many queries.
- Use `resolveAccess(type, id)` for an optional read by id, or
  `assertAccess(type, id, role)` before a read or write that requires access.
- Use an action's `authorize` gate for role-wide restrictions. It decides who
  may call the operation; it does not replace row-level access checks.

Prefer actions for normal app data. A custom HTTP route is appropriate for
protocols such as uploads, streaming, webhooks, OAuth callbacks, or public
unauthenticated resources. An authenticated custom route must establish the
session/request context and apply the same row-level access checks as an action.

## Handle untrusted content and URLs

- React escapes rendered text. Do not pass untrusted content to
  `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `document.write`.
- Use `ssrfSafeFetch` from `@agent-native/core/extensions/url-safety` for
  server-side requests to user- or agent-controlled URLs. It checks private
  network destinations and redirects.
- Treat provider error bodies and uploaded files as untrusted input. Return a
  useful, bounded error to the user without exposing internal details.

## Protect credentials and consequential actions

Never put credential values in source, prompts, action arguments or results,
application state, client bundles, logs, or error messages. Use the shared
credential flow in the `secrets` skill.

For a genuinely high-consequence outward action, such as sending a message,
charging a payment method, or publishing publicly, use `needsApproval` to ask
the user to approve that call. Approval does not grant access: keep the normal
`authorize` and row-level checks as well.

## Related skills

- `actions` — define validated operations shared by the agent and UI.
- `secrets` — connect external services and resolve credentials safely.
- `sharing` — configure access to shareable resources.
