# Neon preview branches — per-PR database isolation

Preview deploys share the prod `DATABASE_URL` by default, so any server
cold-start that touches the database writes to prod. To isolate preview
deploys, we use Neon's copy-on-write branching via GitHub Actions.

## How it works

1. **PR opened/updated** — `.github/workflows/neon-preview-branches.yml`
   creates a Neon branch (`preview/pr-<number>`) for each hosted template's
   Neon project, then sets `NETLIFY_DATABASE_URL` on the corresponding
   Netlify site's deploy-preview context.

2. **Netlify auto-deploys** — each template's `netlify.toml` build command
   starts with `export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL}`.
   When `NETLIFY_DATABASE_URL` is set (preview), the build and runtime use
   the branch DB. When unset (prod), they fall through to the real
   `DATABASE_URL`.

3. **PR closed** — the workflow deletes the Neon branches and removes the
   `NETLIFY_DATABASE_URL` env overrides.

`@agent-native/core` stays provider-agnostic — it only reads `DATABASE_URL`.
The Neon/Netlify specifics live in the workflow and each template's
`netlify.toml`.

## Required GitHub secrets

| Secret               | Where to get it                               |
| -------------------- | --------------------------------------------- |
| `NEON_API_KEY`       | Neon dashboard → Account → API Keys           |
| `NETLIFY_AUTH_TOKEN` | Netlify User Settings → Personal Access Token |
| `NETLIFY_ACCOUNT_ID` | Netlify team settings → Team ID               |

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
| slides    | hidden-thunder-16834477 | fd5deb5b-5539-47e1-830c-e5fb5e105efd |
| videos    | soft-pine-75308618      | 3f0c2cd2-06cd-4ab8-bfb4-c199430d1dac |

## Schema changes

`drizzle-kit push` is **not** run in any build (removed after it caused
production data loss — see PR #252). Schema evolution uses `runMigrations`
in each template's `server/plugins/db.ts` — additive SQL only
(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`).

## Follow-ups

- **Preview-only actions.** Actions that reach outside the DB (send email,
  charge a card, post to Slack) need their own preview-vs-prod gating so
  preview deploys don't trigger real-world side effects.
