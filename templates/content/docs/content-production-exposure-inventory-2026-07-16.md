# Content Production Exposure Inventory Preflight

Status: unauthenticated content-free preflight complete; credentialed exposure inventory pending
Evidence date: 2026-07-16
Implementation route: [Content E2EE Implementation Wayfinder](./content-e2ee-implementation-wayfinder.md)
F3/F4 evidence: [Content E2EE F3/F4 Evidence Matrix](./content-e2ee-f3-f4-evidence-matrix.md)

## Purpose and boundary

This artifact records the first safe production-exposure preflight for Content. It distinguishes:

- **Verified production facts** observed through public metadata or content-free HTTP responses.
- **Repository-derived facts** that describe intended deployment wiring or available capability but do not prove effective production configuration.
- **Blocked unknowns** that require credentialed, read-only provider or application access.

The preflight did not read production documents, document metadata, share rows, database rows, user identities, customer data, environment values, connection strings, media objects, extension contents, provider tokens, or logs. Synthetic nonexistent route identifiers were used only to characterize response and cache behavior.

This is not the credentialed production exposure inventory required before baseline PR 1 opens. It narrows that remaining inventory to explicit, content-free reads.

## Methodology

The read-only pass inspected four surfaces:

1. Checked-in Content deployment configuration and GitHub workflows.
2. Public GitHub repository, environment, deployment, and check-run metadata available to the existing read token.
3. Public Netlify site metadata projected to non-secret deployment fields.
4. Response status and selected cache headers from the production root, health route, authenticated database-health route, synthetic public-document route, synthetic public API route, and synthetic application route.

Local tooling and credential paths were checked for presence only. No environment variable or provider configuration value was printed.

## Exposure inventory

| Surface | Classification | Evidence | Blocked unknown | Smallest safe closure action |
| --- | --- | --- | --- | --- |
| Live URL and deployment | Verified production | `https://content.agent-native.com` mapped publicly to Netlify site name `agent-native-content`, site ID `5c2198f5-bee4-41c3-8a6d-4869f400eec2`, and ready production deploy ID `6a58e6b5394b57000833fb79`, published from branch `main` at `2026-07-16T14:13:58Z`. Public Netlify metadata showed production commit `6d62b7a0b556...`, while upstream and fork `main` were `671c2273de06...` at probe time. Production was therefore behind both main refs at that instant. | Private build state, logs, environment metadata, and the reason for the lag were unavailable. | Use a scoped read-only Netlify credential to read the named deploy's build metadata and logs without retrieving environment values. Record only state, timestamps, commit, and sanitized failure category. |
| GitHub deployment metadata | Verified production metadata boundary | `BuilderIO/agent-native` was public, non-fork, with default branch `main`. The readable GitHub environments were `copilot` and `npm-publish`; recent GitHub deployments were package-publish deployments. No Netlify check run was attached to the probed main commit. | GitHub does not expose Content's Netlify production deployment state through these surfaces. | Treat Netlify, not GitHub Deployments, as the deployment source of truth. No new GitHub access is needed for this gap. |
| Database connectivity and provider | Mixed: connectivity verified; provider repository-derived | `GET /_agent-native/health` returned `200`, `ok: true`, and content-free database health fields. The repository maps Content preview infrastructure to Neon project `quiet-heart-51077706`, and the Content Netlify build selects `NETLIFY_DATABASE_URL` before `DATABASE_URL`. | The production database provider, project, branch, replicas, backups, privileged readers, retention, and deletion behavior were not verified. Public health intentionally omits them. | First inspect Netlify environment-key presence and context without values. Then use Neon read-only project/branch/IAM metadata if that mapping is confirmed. Do not connect to the database or query rows for this provider-identification step. |
| CDN and cache | Verified production | `/` returned `200` with `public, max-age=600, stale-while-revalidate=604800, stale-if-error=3600` in both browser and CDN cache controls. A synthetic unknown application path returned the same cached `200` shell. `/_agent-native/health` returned `no-store`. Synthetic missing `/p/...` and `/api/pages/public/...` reads returned `404` with `no-cache`. | No public-to-private transition, token revocation, purge, or stale-body test was performed. No real public document was read. | Use a disposable synthetic document in the credentialed phase to run the PR 1 warm-cache privacy-transition and token-revocation test, then delete it and retain only statuses, headers, and body hashes. |
| Authentication | Partly verified production | `/api/db-health` returned `401` with `no-cache`, while the general health endpoint remained public. The repository explicitly allowlists public document/API, agent-chat/status, Builder connection/status, and environment-status route families. | Effective identity-provider configuration, session policy, administrator roles, and account coverage remain unknown. | Run one controlled signed-out and disposable signed-in browser check, then read only presence/status booleans from authenticated configuration diagnostics. Do not record account identifiers. |
| Local File Mode | Repository-derived | Content supports `AGENT_NATIVE_MODE=local-files`, trusted Desktop/browser folder handles, local component workspaces, and database-backed copies when local files are shared. The repository describes a fail-closed production boundary, not proof of the deployed mode. | Effective production mode, unsafe override state, registered roots, host filesystem ownership, and tenant cardinality remain unknown. | Read only the effective mode enum and unsafe-override presence through a sanitized deployment diagnostic. If local-file mode is enabled, prove the runtime is single-tenant without enumerating paths or filenames. |
| A2A and hosted agent access | Repository-derived | Content allows the hosted agent-chat and agent-engine status route families through the outer auth path. Netlify functions have a 75-second limit and a 55-second agent soft timeout. | Effective A2A secrets, peer identities, issuer/audience restrictions, accepted apps, pending payloads, and privileged readers remain unknown. | Use an authenticated content-free inventory returning peer count, auth-mode count, bounded-trust status, and queue counts only. Inspect no payloads, prompts, identities, URLs, or tokens. |
| Media and blob storage | Repository-derived | Content has upload, media, transcription, and private-blob abstractions. The repository requires large payloads to use file/blob storage rather than SQL and acknowledges that deployment-held blob encryption is server-readable rather than user-held-key E2EE. | Effective provider, object ACL, public/signed URL policy, deletion support, backups, legacy inline payloads, and privileged readers remain unknown. | Read provider type and policy booleans through scoped provider metadata, then aggregate inline-reference and blob-reference counts without returning URLs. Use one disposable object for anonymous-read, revocation, expiry, and deletion proof. |
| Extensions | Repository-derived | Content exposes authenticated extension routes backed by the shared sandboxed extension runtime. Repository capability does not prove installed production state. | Installed count, visibility, grants, legacy capability state, egress allowlists, and external origins remain unknown. | Return aggregate counts by visibility, grant state, capability version, and egress-enabled state. Do not return extension names, HTML, origins, principals, or stored data. |
| Notion | Repository-derived | Content implements per-user Notion OAuth, document and comment sync, database sources, and raw provider API access through the user's OAuth connection. Repository rules prohibit a deployment-level user token as the product authority. | Connection count, scope/health buckets, linked-document count, sync backlog, token retention, provider policy, and privileged readers remain unknown. | Use an authenticated aggregate status that returns only connection, link, health, and backlog counts. Retrieve no identities, page IDs, titles, URLs, tokens, or remote content. |
| Visibility, shares, and current exposure counts | Blocked unknown | Synthetic `/p/...` returned a content-free `404`, proving that one missing public identifier does not fall through to the cached application shell. Repository schema and actions support private, organization, and public visibility plus scoped share tables. | Current counts by visibility, share principal type, inherited access, local-file source, provider source, and media reference were deliberately not read. The safe unauthenticated surface exposes no aggregate inventory. | Before PR 1, run a one-off authorized, read-only aggregate query or equivalent operator report with the content-free output contract below. PR 2 should add the reusable action; the immediate gate must not wait for that implementation. |
| Logs, model providers, backups, support and infrastructure IAM | Blocked unknown | The repository identifies these as plaintext or privileged trust edges but exposes no production truth through public metadata. | Readers, roles, retention, sampling, legal holds, deletion, subprocessors, and zero-retention settings are unknown. | Export content-free IAM/retention metadata from each provider under read-only credentials. Record roles and counts, not identities, payloads, resource URLs, or secret material. |

## Local read-path availability

Presence-only checks found:

- `gh` was installed and authenticated for public/read metadata.
- `netlify`, `neon`, and `psql` were absent.
- Netlify, Neon, and database credential environment variables were absent.
- No Netlify user configuration or linked `.netlify/state.json` was present.

The exact missing production read path is therefore a scoped Netlify credential for deploy/environment metadata, followed by scoped Neon and other provider read credentials if the presence-only Netlify inventory confirms those providers. Database row access is neither available nor needed for the provider-identification phase.

## Sanitized command record

The pass used projections that excluded bodies, identities, credentials, configuration values, and logs:

```sh
gh repo view BuilderIO/agent-native \
  --json nameWithOwner,url,visibility,isFork,defaultBranchRef

gh api repos/BuilderIO/agent-native/environments
gh api 'repos/BuilderIO/agent-native/deployments?per_page=20'
gh api repos/BuilderIO/agent-native/commits/main

curl -fsS \
  https://api.netlify.com/api/v1/sites/5c2198f5-bee4-41c3-8a6d-4869f400eec2 \
  | jq '{id,name,url,ssl_url,custom_domain,published_deploy:(.published_deploy | {id,state,context,published_at,branch,commit_ref,deploy_ssl_url})}'

curl -sS -D - -o /dev/null https://content.agent-native.com/
curl -sS -D - -o /dev/null https://content.agent-native.com/_agent-native/health
curl -sS -D - -o /dev/null https://content.agent-native.com/api/db-health
curl -sS -D - -o /dev/null https://content.agent-native.com/p/__e2ee_preflight_missing__
curl -sS -D - -o /dev/null https://content.agent-native.com/api/pages/public/__e2ee_preflight_missing__
curl -sS -D - -o /dev/null https://content.agent-native.com/__e2ee_preflight_missing__
```

Only response status and the `content-type`, `cache-control`, `cdn-cache-control`, `age`, `etag`, `location`, `server`, and Netlify request-ID headers were retained. Health response handling retained key names plus `ok`/status booleans; error text was discarded.

## Future PR 2: `production-privacy-inventory` action contract

PR 2 should add a reusable, explicitly operator-authorized, non-public, non-agent-callable `production-privacy-inventory` action. This preflight does not implement it.

The action should:

- Accept no resource identifier, owner, principal, query, or free-form filter.
- Require an explicit deployment/security-admin authorization distinct from ordinary document access.
- Emit a timestamp, schema version, and aggregate counts only.
- Count documents and databases by `private`, `org`, and `public` visibility.
- Count direct shares by principal type without returning principal values.
- Count inherited-share relationships, orphaned share rows, local-file-backed records, source bindings by source type, Notion links by health bucket, media references by storage kind, extensions by capability/egress state, and A2A peers/queues by bounded status.
- Suppress titles, bodies, snippets, comments, properties, filenames, paths, document/database/share/media/extension/provider IDs, user identities, principals, URLs, tokens, keys, prompts, payloads, and error text.
- Produce an audit event containing only the action version, caller authorization class, timestamp, and output hash.
- Fail closed if any requested aggregate would require returning protected values or bypassing tenant/deployment authorization.

Infrastructure IAM, provider retention, backups, CDN policy, model-provider policy, and support access remain separate read-only provider exports; the application action cannot establish those facts.

Before PR 1, an authorized operator may run the same aggregate contract as a reviewed one-off read-only query or report. The reusable action remains PR 2 scope so the baseline authority work owns its authorization, audit, and long-term maintenance.

## Gate conclusion

The safe preflight is complete and useful: it establishes the live Netlify site and deploy, confirms healthy database connectivity without identifying the provider, records the public-shell and missing-public-route cache behavior, proves an authenticated diagnostic rejects anonymous access, and identifies the exact absent local read paths.

The **production exposure inventory gate remains open**. Before PR 1 opens, the credentialed phase must still establish:

- Current content-free visibility, grant, inherited-access, source, extension, Notion, A2A, and media-reference counts.
- Effective production database, blob, CDN, auth, Local File Mode, A2A, extension, Notion, logging, model-provider, and scheduler configuration.
- Provider IAM readers, retention, backups, deletion behavior, and support access.
- Disposable deployed proof for CDN privacy transitions, token revocation, and anonymous media reads.

A quiet aggregate result will not waive baseline PRs 1–2. It establishes blast radius and urgency; it does not prove that the current plaintext trust edges are safe.
