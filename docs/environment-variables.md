# Environment variables

This is the exhaustive maintainer inventory for Agent-Native. It covers
variables used by first-party runtime code, templates, build/deploy scripts,
and checked-in `.env.example` files.

The published [Agent-Native docs site](/docs/environment-variables) is a
curated framework/workspace reference. It intentionally leaves template-only,
provider-catalog, and CI/host plumbing out of the user-facing page.

The list is intentionally broader than the variables most applications need:
some entries are optional feature flags, local development controls, or
internal deployment settings. Do not set a variable just because it appears
here. Follow the owning feature's documentation and keep user- or
workspace-scoped credentials in the database-backed secret store.

The focused user-facing guides remain authoritative for their areas:

- [Deployment](../packages/core/docs/content/deployment.mdx#environment-variables)
  - production hosting, database, and framework configuration
- [Authentication](../packages/core/docs/content/authentication.mdx)
  - auth modes, OAuth, and static bearer fallbacks
- [Security](../packages/core/docs/content/security.mdx)
  - security-sensitive opt-ins and credential boundaries
- Template `server/lib/env-config.ts` files and
  `templates/analytics/app/lib/data-sources.ts`
  - settings UI and provider-specific credential metadata

For committed, non-secret app defaults such as first-run onboarding, prefer
`agent-native.config.ts` and use the [Agent-Native app configuration
guide](../packages/core/docs/content/agent-native-config.mdx) instead of adding
another `VITE_*` flag. `agent-native.ts`, `agent-native.mts`,
`agent-native.config.mts`, and `agent-native.json` remain supported. Keep credentials
and deployment-specific values in the environment or scoped secret store.

`runtime.environment.required` records environment variable names only. The
resolved config is public browser configuration, so set the corresponding
values in the deployment environment or secret store, never in the config file
or a committed `.env` file.

## How variables are loaded

Template development loads the template `.env`, then its `.env.local` override,
and workspace development loads the repository root `.env` before app-local
values. App-local values win when the same key is defined in both places.
`.env.example` files are starter files, not complete references; this page is
the completeness index.

`VITE_*` and `import.meta.env` values can be bundled into browser code. Treat
them as public configuration. Never put a secret in a `VITE_*` variable.

For credentials, use deployment environment variables only for deploy-level
configuration. User-, organization-, and workspace-scoped credentials belong
in the scoped secret/credential store or an OAuth connection. Never commit
values from `.env` files, and use placeholders such as `<API_KEY>` in examples.

## Common application and deployment variables

| Variable                                                           | Purpose                                                                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                     | Primary SQL connection URL. Local development falls back to SQLite when it is unset; production also accepts `<APP_NAME>_DATABASE_URL` or `NETLIFY_DATABASE_URL`.           |
| `DATABASE_AUTH_TOKEN`                                              | Separate database auth token for providers such as Turso/libSQL.                                                                                                            |
| `DB_CONNECT_COOLDOWN_MS`                                           | How long an endpoint stops attempting new connections after one attempt fails (default 2000, jittered). Prevents a refused attempt from immediately producing the next one. |
| `APP_URL`                                                          | Optional canonical public origin for auth, OAuth, A2A, webhooks, and generated links; hosting metadata is inferred when unset.                                              |
| `APP_BASE_PATH`                                                    | Server-side mount prefix for a workspace app such as `/mail`.                                                                                                               |
| `PORT`                                                             | Local Node/Nitro server port.                                                                                                                                               |
| `NITRO_PRESET`                                                     | Nitro build/deployment preset.                                                                                                                                              |
| `IS_RR_BUILD_REQUEST`                                              | Internal React Router build-time preview marker used during prerendering; do not set manually.                                                                              |
| `BETTER_AUTH_SECRET`                                               | Stable Better Auth session-signing secret for standalone production apps; workspace deployments can derive it from `A2A_SECRET`.                                            |
| `BETTER_AUTH_URL`                                                  | Optional Better Auth public-origin override; known template/request context, `APP_URL`, and Netlify or Vercel metadata are inferred when unset.                             |
| `OAUTH_STATE_SECRET`                                               | Dedicated OAuth state-signing secret; falls back to `BETTER_AUTH_SECRET`.                                                                                                   |
| `A2A_SECRET`                                                       | Deploy-level HMAC for A2A and signed background handoffs.                                                                                                                   |
| `SECRETS_ENCRYPTION_KEY`                                           | Legacy app-local/shared secret encryption key. Prefer the dedicated workspace key for shared vaults.                                                                        |
| `WORKSPACE_SECRETS_ENCRYPTION_KEY`                                 | Stable encryption key for a workspace-shared secrets vault.                                                                                                                 |
| `WORKSPACE_SECRETS_ENCRYPTION_KEY_PREVIOUS`                        | Previous workspace vault key during a rotation window.                                                                                                                      |
| `AUTH_MODE`                                                        | Local authentication mode selection.                                                                                                                                        |
| `AUTH_DISABLED`                                                    | Local/preview-only auth bypass; unset already means false, and it must never be used for a public production app.                                                           |
| `AUTH_MAGIC_LINK`                                                  | Set to `0` to force the email/password fallback; otherwise a ready email transport enables magic links by default.                                                          |
| `ACCESS_TOKEN` / `ACCESS_TOKENS`                                   | Static bearer fallback for MCP/connect clients, not browser authentication.                                                                                                 |
| `AGENT_PROD_CODE_EXECUTION`                                        | Production code-execution mode: `off`, `sandboxed`, or `trusted`.                                                                                                           |
| `AGENT_NATIVE_SSR_CACHE`                                           | Deployment-wide SSR shell cache policy.                                                                                                                                     |
| `NODE_ENV`                                                         | Node runtime mode.                                                                                                                                                          |
| `CI`                                                               | Continuous-integration marker used by test/build behavior.                                                                                                                  |
| `DEBUG`                                                            | General debug logging switch used by local tooling and selected runtime paths.                                                                                              |
| `COOKIE_DOMAIN` / `CORS_ALLOWED_ORIGINS`                           | Optional cookie-domain and cross-origin request policy.                                                                                                                     |
| `PING_MESSAGE`                                                     | Minimal template smoke-test message used by example apps.                                                                                                                   |
| `DATABASE_*`                                                       | Database URL, auth-token, and provider-specific connection variants.                                                                                                        |
| `NODE_*`                                                           | Node runtime and CLI options such as `NODE_ENV` and `NODE_OPTIONS`.                                                                                                         |
| `APP_*`                                                            | Server-side app identity and public-origin configuration.                                                                                                                   |
| `A2A_*`                                                            | A2A lifetime, auth, and processing controls.                                                                                                                                |
| `URL` / `PATH` / `HOME` / `PWD` / `SHELL` / `APPDATA` / `INIT_CWD` | Host-provided process and shell metadata used by local tooling.                                                                                                             |
| `CLAUDE_CONFIG_DIR` / `COREPACK_HOME`                              | Tool-specific configuration and package-manager home directories.                                                                                                           |

Database-specific `<APP_NAME>_DATABASE_URL` and
`<APP_NAME>_DATABASE_AUTH_TOKEN` overrides are supported for workspace apps.

Production readiness is checked without returning secret values. The public
`/_agent-native/ping?configuration=1` probe reports missing or weak auth/A2A
secrets, production auth bypasses, local databases, invalid public origins,
and any keys declared under `runtime.environment.required` in
`agent-native.json` or a typed config file. The shared provider shell shows the
same report as a warning/error chip and can copy a remediation prompt for an AI
coding agent.
Set `diagnostics.failOnBuild: true` when a project wants a production Vite
build to fail on these findings instead of logging them.

## Framework and agent namespaces

These namespaces are intentionally indexed as families because they contain
many small, independently deployable controls. The exact keys are scanned by
`guard:env-documentation`, so adding a new key still requires it to fit an
existing documented family or be added as an exact entry here.

| Namespace / pattern                        | Scope                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_NATIVE_*`                           | Core framework feature flags, build metadata, URLs, timeouts, telemetry, security opt-ins, MCP, A2A, realtime, workspace, and desktop controls. |
| `AGENT_*`                                  | Agent engine, model, loop, terminal, run-retention, identity, and CLI controls.                                                                 |
| `VITE_AGENT_NATIVE_*`                      | Public browser mirrors of framework configuration.                                                                                              |
| `VITE_APP_*`                               | Public app name, template, URL, and base-path configuration.                                                                                    |
| `AGENT_NATIVE_ANALYTICS_*`                 | Framework analytics endpoint, public key, and flush behavior.                                                                                   |
| `AGENT_NATIVE_WORKSPACE_*`                 | Workspace app identity, audience, paths, and discovery metadata.                                                                                |
| `AGENT_NATIVE_MCP_*` / `MCP_*`             | MCP catalog, hub, client, OAuth, server, and debug behavior.                                                                                    |
| `AGENT_NATIVE_REALTIME_*`                  | Realtime gateway, transport, and public connection configuration.                                                                               |
| `AGENT_NATIVE_CODE_*`                      | Code-agent profile, usage-file, home-directory, and test-response controls.                                                                     |
| `AGENT_NATIVE_OM_*`                        | Observational-memory thresholds and recent-message limits.                                                                                      |
| `AGENT_NATIVE_BUILD_*`                     | Build/deploy metadata and public analytics identifiers.                                                                                         |
| `WORKSPACE_*`                              | Local workspace runner, proxy, prewarm, app lifecycle, OAuth, and shared-vault controls.                                                        |
| `AGENT_NATIVE_GUARD_*` / `GUARD_*`         | Guard-runner concurrency and local guard tooling.                                                                                               |
| `AGENT` / `HAS_*` / `HEAD` / `PR_AUTHOR_*` | Visual recap CLI and workflow input metadata.                                                                                                   |

## Authentication, provider, and integration variables

| Namespace / pattern                                                                                                                                                 | Scope                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GOOGLE_*`                                                                                                                                                          | Google sign-in, OAuth integrations, push/watch callbacks, Gemini, and service-account configuration. Client secrets and service-account material are secret. |
| `GITHUB_*`                                                                                                                                                          | GitHub OAuth, integration, and token configuration.                                                                                                          |
| `NOTION_*`                                                                                                                                                          | Notion OAuth app configuration, state signing, and legacy API access.                                                                                        |
| `SLACK_*`                                                                                                                                                           | Slack OAuth, webhook verification, allowed workspace/app IDs, and legacy bot access.                                                                         |
| `MICROSOFT_TEAMS_*`                                                                                                                                                 | Teams app and tenant configuration.                                                                                                                          |
| `WHATSAPP_*` / `TELEGRAM_*`                                                                                                                                         | Messaging webhook verification and provider credentials.                                                                                                     |
| `ZOOM_*`                                                                                                                                                            | Zoom OAuth client configuration.                                                                                                                             |
| `SUPABASE_*` / `VITE_SUPABASE_*`                                                                                                                                    | Macros template Supabase auth and public client configuration. The `VITE_*` values are public.                                                               |
| `POSTHOG_*`                                                                                                                                                         | PostHog host, public key, server key, error tracking, and feedback survey configuration.                                                                     |
| `SENTRY_*` / `TAURI_SENTRY_*`                                                                                                                                       | Server, browser, Electron, desktop, and Tauri error-reporting configuration.                                                                                 |
| `OPENAI_*` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `GROQ_API_KEY` / `MISTRAL_API_KEY` / `COHERE_API_KEY` | Built-in agent provider keys and OpenAI-compatible endpoint configuration. Prefer scoped provider keys for multi-tenant apps.                                |
| `*_API_KEY` / `*_ACCESS_TOKEN` / `*_TOKEN` / `*_SECRET` / `*_PASSWORD`                                                                                              | Credential-shaped provider or integration values. They must never contain committed real values.                                                             |
| `*_CLIENT_ID` / `*_CLIENT_SECRET`                                                                                                                                   | OAuth application identifiers and secrets. Client IDs may be public; client secrets are not.                                                                 |
| `*_WEBHOOK_SECRET` / `*_SIGNING_SECRET` / `*_CRON_SECRET`                                                                                                           | Inbound webhook or scheduled-job verification material.                                                                                                      |
| `*_SECRET_KEY` / `*_PUBLIC_KEY` / `*_PRIVATE_KEY`                                                                                                                   | Provider keys whose name distinguishes secret, public, or private material.                                                                                  |
| `*_EMAIL` / `*_ADDRESS` / `*_LOGIN` / `*_BEARER_TOKEN`                                                                                                              | Provider identity and credential fields.                                                                                                                     |

The analytics template's provider catalog also supports credentials such as
`GOOGLE_APPLICATION_CREDENTIALS_JSON`, `BIGQUERY_PROJECT_ID`,
`ANALYTICS_BIGQUERY_EVENTS_TABLE`, `AMPLITUDE_*`, `MIXPANEL_*`,
`HUBSPOT_*`, `GONG_*`, `APOLLO_API_KEY`, `CLAY_PUBLIC_API_KEY`,
`JIRA_*`, `GRAFANA_*`, `PROMETHEUS_*`, `PYLON_*`, `COMMONROOM_*`,
`DATAFORSEO_*`, and `TWITTER_BEARER_TOKEN`. These are provider credentials,
not deployment defaults; configure them through the analytics credential UI or
workspace connection when available.

## Template and application namespaces

| Namespace / pattern                        | Scope                                                                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANALYTICS_*` / `DASHBOARD_*` / `UPTIME_*` | Analytics jobs, alerting, reports, session replay, monitor sweeps, and retention.                                                                                                        |
| `ASSETS_*` / `S3_*` / `IMAGES_*`           | Assets/image generation, object-storage, and image-service configuration. Access and secret keys are confidential.                                                                       |
| `BRAIN_*`                                  | Brain jobs, distillation, and Clips export configuration.                                                                                                                                |
| `CLIPS_*`                                  | Clips media workers, transcription, remuxing, compression, desktop builds, and Sentry settings.                                                                                          |
| `CONTENT_*`                                | Content demo, E2E, parity, and public-base-url settings.                                                                                                                                 |
| `DISPATCH_*`                               | Dispatch database, workspace smoke, owner, builder, vault, and sender-trust settings.                                                                                                    |
| `AGENT_NATIVE_WORKSPACE_REPO_URL`          | Optional Git repository URL that Dispatch provisions as the Builder project for hosted workspace app creation. Defaults to the Agent-Native workspace repository.                        |
| `PLAN_*`                                   | Plan local/hosted URLs, publishing, guest limits, E2E, recap, and visual-answer integration.                                                                                             |
| `FACTORY_*`                                | Factory public URL, webhook, and Builder integration settings.                                                                                                                           |
| `CRM_*`                                    | CRM enrichment and provider settings.                                                                                                                                                    |
| `BUILDER_*`                                | Builder connection, project, gateway, CMS, image-generation, search, and deployment settings. Private/public keys remain deploy- or connection-scoped as described by the security docs. |
| `EMAIL_*` / `SENDGRID_*` / `RESEND_*`      | Mail sender, inbound webhook, and provider configuration.                                                                                                                                |
| `TURNSTILE_*` / `VITE_TURNSTILE_*`         | Server verification and public browser site key for CAPTCHA.                                                                                                                             |
| `NOTIFICATIONS_*` / `TRACKING_*`           | Email, Slack/webhook notification, and tracking provider configuration.                                                                                                                  |
| `CREATIVE_CONTEXT_*`                       | Creative Context A2A URL, key, and timeout.                                                                                                                                              |
| `FRAME_*` / `ELECTRON_*` / `TAURI_*`       | Local frame and desktop application configuration.                                                                                                                                       |
| `IMAGE_*`                                  | Image-generation concurrency and related local controls.                                                                                                                                 |
| `GMAIL_*`                                  | Gmail push/watch topic, audience, and signer configuration.                                                                                                                              |
| `DISCORD_*`                                | Discord webhook/application verification configuration.                                                                                                                                  |
| `FUSION_*`                                 | Fusion environment and origin configuration.                                                                                                                                             |
| `INTEGRATION_*`                            | Integration reservation and dispatch controls.                                                                                                                                           |
| `RUN_*`                                    | Background-job and runner toggles.                                                                                                                                                       |
| `SITE_*`                                   | Builder site identity and browser integration settings.                                                                                                                                  |
| `VISUAL_RECAP_*`                           | Visual recap CLI and workflow configuration.                                                                                                                                             |

Other template-specific values are covered by the suffix patterns in the
provider table (`*_URL`, `*_ID`, `*_PORT`, `*_TIMEOUT_MS`, `*_LIMIT`,
`*_ENABLED`, `*_PATH`, `*_ORIGIN`, `*_HOST`, `*_REGION`, `*_BUCKET`,
`*_ENDPOINT`, and `*_PUBLIC_URL`). Their owning template source is the final
authority for defaults and accepted values.

## Hosting and build metadata

| Namespace / pattern                                                                                                                      | Scope                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `NETLIFY_*` / `DEPLOY_*`                                                                                                                 | Netlify deployment context, URLs, database wiring, and deploy metadata.                     |
| `VERCEL_*` / `CF_*` / `AWS_*` / `FLY_*` / `RENDER_*` / `K_*` / `FUNCTION_*`                                                              | Host-provided runtime and deployment metadata. These are normally supplied by the platform. |
| `NITRO_*`                                                                                                                                | Nitro preset, port, and public URL configuration.                                           |
| `GA_*` / `GTM_*`                                                                                                                         | Public analytics measurement and tag-manager identifiers.                                   |
| `NPM_TOKEN` / `NODE_AUTH_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`                                                                            | Release, package-publish, and repository automation credentials. CI-only.                   |
| `NPM_CONFIG_*`                                                                                                                           | npm install/build configuration used by hosting or release jobs.                            |
| `AGENT_NATIVE_NPM_*`                                                                                                                     | Package availability and publish bootstrap controls. CI/release-only.                       |
| `NETLIFY` / `VERCEL` / `RENDER`                                                                                                          | Bare host markers supplied by deployment platforms.                                         |
| `AWS_*` / `LAMBDA_*` / `CLOUDFLARE_WORKERS`                                                                                              | Cloud runtime markers and build/runtime adapters.                                           |
| `FUNCTIONS_*`                                                                                                                            | Functions runtime markers.                                                                  |
| `*_REF` / `*_SHA` / `BRANCH` / `CONTEXT` / `PULL_REQUEST`                                                                                | Build and deploy context supplied by hosting or CI systems.                                 |
| `*_NAME` / `*_STATE` / `*_RESULT` / `*_RUN_ID` / `*_REASON` / `*_STATUS` / `*_OK` / `*_AT` / `*_OUTPUT` / `*_JSON`                       | CI workflow handoff values. These are ephemeral and are not application settings.           |
| `*_FILE` / `*_REVISION` / `HEAD_*` / `PR_*` / `REQUESTED_*` / `RUNNER_*`                                                                 | Additional CI handoff paths, revisions, pull-request, runner, and request metadata.         |
| `ACTION` / `ACTOR` / `DEPLOY` / `METHOD` / `OPERATION` / `TEMPLATE` / `WORKSPACE` / `TARGET` / `ROUTE` / `SHA` / `TRUSTED_REPOSITORY`    | Trusted-acceptance and deployment workflow selectors.                                       |
| `MERGED` / `REPO`                                                                                                                        | Internal workflow state and repository identifiers.                                         |
| `APPLE_*` / `MACOSX_*` / `GGML_*` / `NEON_*` / `CORE_CLI_VERSION` / `RELEASE_VERSION`                                                    | Desktop signing, native build, preview-database, and CLI release settings.                  |
| `AUTO_*` / `CLEAR_*` / `DRY_RUN` / `MAX_AGE_MINUTES` / `REBUILD` / `PUBLISHED_PACKAGES` / `DIFF_*` / `IS_FORK` / `SHOT_*` / `SUPPRESSED` | Internal deployment and visual-recap workflow controls.                                     |

## Local development and test controls

These are useful for maintainers and automation, not required for a normal
production deployment:

| Pattern                                                                                                                        | Scope                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `E2E_*` / `PLAYWRIGHT_*` / `*_SMOKE_*` / `SIGN_IN_MATRIX_*`                                                                    | Browser, end-to-end, and smoke-test configuration.                                          |
| `CHAT_FIRST_SCREENSHOT_DIR` / `CHAT_FIRST_ELECTRON` / `CHAT_FIRST_ELECTRON_EXECUTABLE`                                         | Chat-first workbench QA output, optional Electron lane toggle, and an optional Electron binary override. |
| `HEADLESS_ONRAMP_*` / `STANDALONE_CHAT_DEV_*`                                                                                  | CLI and standalone-chat QA harnesses.                                                       |
| `DEV_*` / `DEBUG_*` / `*_DEBUG` / `CHOKIDAR_*`                                                                                 | Local development and diagnostics.                                                          |
| `AUTH_SKIP_EMAIL_VERIFICATION`                                                                                                 | Local/test auth convenience; never use to weaken production auth.                           |
| `VITEST_*` / `VITEST`                                                                                                          | Test-runner behavior and worker configuration.                                              |
| `UPDATE_I18N_*`                                                                                                                | Maintainer-only i18n baseline updates.                                                      |
| `CODESPACES` / `GITPOD_*` / `CODEX_HOME` / `XDG_CONFIG_HOME` / `CLAUDE_CONFIG_DIR` / `COREPACK_HOME`                           | Tool-host or development-environment detection.                                             |
| `DEV` / `MODE` / `SSR`                                                                                                         | Vite-provided build-mode flags exposed through `import.meta.env`.                           |
| `ALLOW_DRIZZLE_PUSH_ON_NEON` / `AN_*` / `AUTO_CREATE_DEFAULT_ORG` / `DO_NOT_TRACK` / `ENABLE_*` / `PI_*`                       | Explicitly opt-in local or maintainer controls. Read the owning source before setting them. |
| `CLAUDE_PROJECT_DIR` / `CODE_AGENTS_PROJECT_ROOT` / `LANES` / `FORCE_COLOR` / `LC_ALL` / `LC_CTYPE` / `NO_COLOR` / `PNPM_HOME` | Local coding-agent, shell, package-manager, and test-lane tooling.                          |

## CI-only variables

| Variable                      | Purpose                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`                 | Database name for the ephemeral Postgres service container used by the Content DB test lane. |
| `POSTGRES_HOST_AUTH_METHOD`   | Auth method for that same throwaway container; `trust` keeps the lane password-free.         |
| `S2573_PGLITE_INSTALL_PREFIX` | Install prefix for the PGlite build used by the Content database row-migration lock test.    |

GitHub Actions also creates short-lived step handoff variables such as
`HEAD_SHA`, `MATRIX`, `PLAN_JSON`, `PLAN_URL`, `PR_NUMBER`, `RUN_URL`,
`ROLLBACK_SHA`, `ASSERTIONS`, and `RECAP_*`. They are workflow plumbing, not
application configuration. The secrets and vars used by those workflows are
listed in the workflow files under `.github/workflows`; values must be supplied
through GitHub Actions secrets/variables, never committed to this repository.

The following variables are set by the CI workflow for service containers and
integration tests only — they are not used in application runtime code:

| Variable                      | Purpose                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`                 | Database name for the PostgreSQL service container used in CI integration tests.                |
| `POSTGRES_HOST_AUTH_METHOD`   | PostgreSQL host-based authentication method for the CI service container (e.g. `trust`).        |
| `S2573_PGLITE_INSTALL_PREFIX` | Override for the PGlite native binary install prefix used by the content-database lock CI test. |

## Dynamic environment keys

Some framework paths intentionally read `process.env[key]` after a key has been
selected from a registry or a template manifest. The complete dynamic sets
come from these sources:

- `packages/core/src/agent/engine/provider-env-vars.ts`
- `packages/core/src/secrets/register-framework-secrets.ts`
- `templates/*/server/lib/env-config.ts`
- `templates/analytics/app/lib/data-sources.ts`
- `.env.example` files in the template and workspace roots

Do not add a second ad-hoc resolver for a credential key. Register the key in
the owning manifest, document its family or exact name here, and route stored
user/org/workspace values through the scoped credential APIs.

## Keeping this index complete

Run the focused check from the repository root:

```bash
pnpm run guard:env-documentation
```

The check scans first-party runtime/config files, deployment files, GitHub
Actions workflows, and `.env.example` manifests. It ignores generated docs and
tests, then verifies that every static key matches an exact entry or documented
wildcard above. Add a specific entry when a new variable has semantics that are
not represented by an existing namespace or suffix family.
