# GitHub Actions Netlify PR previews

PRs do not deploy previews automatically. To preview one site, the internal
author of an open, same-repository PR targeting `main` manually runs the
`Manage Netlify PR previews` workflow from `main`, selects the PR number and one
eligible site, and dispatches the run. GitHub checks the author is an
organization member or owner and is the person who started the run. The build
job has no deployment secrets; the upload job checks out the trusted base
revision, builds its trusted Functions, and receives only the PR's static
artifact. PR-controlled Functions are never deployed.

Preview deploys do not create an isolated database. Before each GitHub Actions
upload, the workflow copies the production PostgreSQL URL from the matching
`NETLIFY_PREVIEW_DATABASE_URL_<TEMPLATE>` GitHub secret into the
`branch-deploy` context used by the aliased prebuilt upload, and the deployed
preview smoke check requires the database and schema to be healthy. Those secrets mirror the matching local
`templates/<template>/.env` `DATABASE_URL`; `chat` uses the production Netlify
database because its local template has no database URL. Treat every preview as
non-isolated and unsafe to write. Only database variables are copied; other
provider credentials remain managed by the Netlify site. The workflow below also
cleans up branch resources left by the former isolation flow.

## How it works

1. **Manual preview** - select one eligible site for an open PR targeting
   `main`. The workflow validates the PR and its internal author, then builds
   the exact PR head revision and publishes a PR alias.

2. **Preview URL** - the workflow smoke-tests the uploaded deploy and records
   its URL as a GitHub deployment on the PR commit.

3. **PR closed** - the workflow deletes any matching
   `GitHub Actions PR preview #*` Netlify deploys. The separate legacy cleanup
   workflow removes any leftover `preview-schema-only/pr-*` or `preview/pr-*`
   Neon branches and old branch-scoped `DATABASE_URL` overrides.

`@agent-native/core` uses PostgreSQL through `DATABASE_URL`.
The Netlify specifics live in the workflow and each template's `netlify.toml`.
Only sites returned by `previewEligibleSiteNames()` in
`scripts/netlify-pr-preview-targets.ts` can receive an artifact-only PR alias.

## Preview access requirements

The GitHub workflow restricts who can create previews; it does not restrict
who can visit their URLs. The Builder.io Netlify team currently has no visitor
protection on these sites. Team protection and protection for non-production
deploys are unavailable on the current plan; Basic protection would also cover
production. Anyone with a preview URL can visit it. Do not put sensitive data
in a preview or use preview workflows that can create real external side
effects.

## Required GitHub secrets

| Secret                                    | Where to get it                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `NEON_API_KEY`                            | Neon dashboard → Account → API Keys                                                              |
| `NETLIFY_AUTH_TOKEN`                      | Netlify User Settings → Personal Access Token                                                    |
| `NETLIFY_ACCOUNT_ID`                      | Netlify team settings → Team ID                                                                  |
| `NETLIFY_PREVIEW_DATABASE_URL_<TEMPLATE>` | Matching production `templates/<template>/.env` URL; `CHAT` uses the production Netlify database. Used only by a manually dispatched preview upload. |

## Restoring production env vars

Production template secrets are not managed by the PR preview workflow. If a
Netlify project loses its env vars during a migration, restore them from the
local ignored template env files:

```bash
pnpm sync:netlify-env -- --template clips
NETLIFY_AUTH_TOKEN=... NETLIFY_ACCOUNT_ID=... pnpm sync:netlify-env -- --template clips --write
```

The script is dry-run by default, logs key names only, writes the production
context, and marks real secrets as Netlify secret values while leaving public
deployment metadata plain so Netlify's secret scanner does not block deploys.
It merges `templates/<name>/.env` and `templates/<name>/.env.local` because
some deploy-relevant auth keys, such as `BETTER_AUTH_SECRET`, currently live in
`.env.local`. Pass `--all` to restore every known template site.

## Site ↔ Neon project mapping

Defined in the workflow's matrix. Update it when adding a new hosted template.

| Template  | Neon project ID         | Netlify site ID                      |
| --------- | ----------------------- | ------------------------------------ |
| analytics | dry-shadow-75673589     | ba983662-dac4-478d-a481-5079e67e4d33 |
| calendar  | super-fire-75593365     | 954fe53b-052e-4401-aac2-2e973e498af8 |
| clips     | aged-glitter-95425960   | 7e3f4fee-258d-4d16-9aaf-154a714e87e2 |
| content   | quiet-heart-51077706    | 5c2198f5-bee4-41c3-8a6d-4869f400eec2 |
| forms     | curly-glade-91979555    | aa0b2020-9983-4d6c-8fb0-65462f960fc4 |
| issues    | crimson-wave-50288362   | 76b94d46-f566-43cd-bddd-01123137ab9a |
| mail      | patient-cake-44789837   | dee98bb0-6143-4205-8c04-afe7bf83d5b5 |
| plan      | late-pine-39936033      | 9d0d7a73-385d-4da1-ba10-1581ffc4d413 |
| slides    | hidden-thunder-16834477 | fd5deb5b-5539-47e1-830c-e5fb5e105efd |
| videos    | soft-pine-75308618      | 3f0c2cd2-06cd-4ab8-bfb4-c199430d1dac |

## Schema changes

`drizzle-kit push` is **not** run in any build (removed after it caused
production data loss — see PR #252). Schema evolution uses `runMigrations`
in each template's `server/plugins/db.ts` — additive SQL only
(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`).

## Follow-ups

- **Agent-Native Plans DNS/TLS.** The Plans Neon project and Netlify site are
  configured and included in the preview-branch workflows. To complete the
  public cutover, `plan.agent-native.com` should resolve as a DNS-only CNAME to
  `agent-native-plan.netlify.app`; then provision/verify TLS in Netlify.

- **PR visual recap publishing.** PR automation can publish org-gated visual
  recap plans to the hosted Plans app by default when `PLAN_RECAP_TOKEN`
  contains the publish token. Set `PLAN_RECAP_APP_URL` only for a self-hosted
  Plans app. Recap links are review aids; they do not replace the GitHub diff
  review.

- **Preview-only actions.** Actions that reach outside the DB (send email,
  charge a card, post to Slack) need their own preview-vs-prod gating so
  preview deploys don't trigger real-world side effects.
