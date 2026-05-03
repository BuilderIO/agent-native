# {{APP_TITLE}} Workspace Instructions

These instructions apply at the workspace root. App-specific behavior belongs
in `apps/<app>/AGENTS.md`; shared cross-app behavior belongs in
`packages/shared/AGENTS.md` or `packages/shared/.agents/skills/`.

## Workspace Scope

- Keep root changes focused on workspace orchestration, shared configuration,
  deploy settings, and monorepo tooling.
- Keep application routes, actions, server plugins, and app state inside the
  relevant `apps/<app>` directory unless multiple apps need the same behavior.
- Put reusable code in `packages/shared` only after at least two apps need it.
- Never copy live credentials, personal email addresses, customer data, or
  company-specific placeholder values into source files.

## Workspace Identity

Use the workspace root `.env` for shared identity and cross-app trust settings:

- `WORKSPACE_ORG_NAME` — human-readable organization name.
- `WORKSPACE_ORG_DOMAIN` — bare domain owned by the workspace, with no protocol
  or path.
- `WORKSPACE_OWNER_EMAIL` — initial owner/admin email for repairs and
  integration defaults.
- `A2A_SECRET` — shared secret for cross-app A2A signing. Generate with
  `openssl rand -hex 32` or `pnpm repair:workspace-org -- --name ...`.

`DISPATCH_DEFAULT_OWNER_EMAIL` is optional. Set it only for trusted,
single-workspace deployments where unlinked integration requests should run as
the workspace owner, and prefer the same value as `WORKSPACE_OWNER_EMAIL`.

## Org Repair

When asked to repair workspace org or A2A configuration:

1. Read `.env` first. Do not infer the organization, domain, owner email, or
   secret from old examples.
2. Run `pnpm repair:workspace-org -- --name "<org>" --domain example.com --owner-email owner@example.com`
   to create or update generic workspace identity values.
3. Prefer the app's organization settings UI or authenticated org routes for
   changing `allowed_domain` and `a2a_secret`.
4. If direct SQL is unavoidable, inspect the live schema first and use only
   parameterized `INSERT` or `UPDATE` statements. Ensure the target org has
   `organizations.name`, `organizations.allowed_domain`,
   `organizations.a2a_secret`, and an `org_members` owner row for
   `WORKSPACE_OWNER_EMAIL`.
5. Never use `DROP`, `TRUNCATE`, destructive `ALTER`, or an unscoped
   `DELETE`. Do not rotate `A2A_SECRET` without updating every app that trusts
   it.
