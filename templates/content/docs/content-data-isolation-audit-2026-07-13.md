# Who can currently see another user's Content data?

Date: 2026-07-13
Scope: `templates/content` and the framework surfaces it directly relies on
Source snapshot: `379af14ca08fb7965d20b87236e8b268765dfb15` (detached HEAD)
Method: read-only source audit plus repository security guards; no production database, CDN, or deployed environment inspection

## Answer

Content's database-backed document model is private by default and its ordinary list, read, update, delete, comments, versions, and database actions generally enforce the intended access boundary. I did not find a simple "sign in as Bob and list Alice's private SQL documents" path in those ordinary actions.

It is not yet safe to describe Content as bulletproof or to move a sensitive personal vault into a shared hosted instance. Five surrounding paths can cross the boundary:

1. A previously public document, or a private document opened with a short-lived agent token, can have its full body retained in a shared CDN cache after the document is made private or the token expires.
2. A person granted `editor` on one Content document can make Notion calls with the document owner's OAuth connection, including linking and pulling a different Notion page if they know its page ID or URL.
3. A same-org user can share a persisted extension with another user as `editor`; when the recipient opens it, the extension runs bridge calls under the recipient's session and can read the recipient's private Content data and send it outward. The code itself calls the missing consent step a TODO.
4. Any service holding the shared symmetric `A2A_SECRET` can mint a valid cross-app identity token for any email address and make Content act as that user. A compromised or malicious peer app is therefore inside every user's data boundary.
5. Local File Mode is scoped to the process/manifest, not to a user. Every authenticated account sharing that runtime can list, read, edit, create, and delete the same configured Markdown roots.

The personal-vault decision is therefore **do not migrate `teenylilthoughts` to shared hosted Content yet**. A trusted, single-user local-file bridge is a different threat model and remains reasonable if the machine, process, and account are all controlled by one person.

## Evidence

### High: shared CDN cache can outlive access

The public document loader selects the full title and content before admitting either `visibility === "public"` or a valid scoped agent token. It tries to mark tokenized responses `private, no-store` (`app/routes/p.$id.tsx:45-67`, `app/routes/p.$id.tsx:94-121`).

The framework SSR handler then overwrites route cache policy on every successful HTML and React Router `.data` response with a shared policy of `public, max-age=600, stale-while-revalidate=604800` (`packages/core/src/server/ssr-handler.ts:246-281`, `packages/core/src/shared/cache-control.ts:1-15`). A regression test explicitly expects route-provided `private, no-store` to be replaced (`packages/core/src/server/ssr-handler.spec.ts:545-562`).

Impact: a URL fetched while public can continue serving the old full body after unpublish; an exact tokenized URL can continue serving a cached body after token expiry. Freshness is ten minutes and stale-while-revalidate is seven days. No visibility-change cache purge was found.

### High: Content editors inherit the owner's Notion authority

The shared Notion helper requires only `editor` access to a Content document, then returns the document owner's email rather than the caller's (`actions/_notion-action-utils.ts:15-25`; equivalent route helper at `server/lib/notion.ts:518-543`). Link, pull, push, create, and conflict-resolution paths use that owner identity.

`link-notion-page` accepts a caller-provided Notion page ID or URL and passes the owner's identity into sync (`actions/link-notion-page.ts:17-31`). The sync layer resolves the owner's OAuth token, fetches that page, links it, and immediately pulls its content into the shared Content document (`server/lib/notion-sync.ts:805-825`, `server/lib/notion-sync.ts:879-887`).

Impact: an editor who knows another Notion page ID/URL accessible to the owner's integration can use Content as a confused deputy to read that page. The same grant also permits Notion writes through push/create paths. Page IDs are high entropy, which limits blind discovery but does not fix the authority mismatch.

### High: shared extensions execute with the viewer's session

Extensions correctly forbid public sharing and restrict shares to the same organization (`packages/core/src/extensions/store.ts:348-364`). That prevents anonymous exploitation, but it does not protect one org member from another.

The extension HTML states that a non-author extension runs `appAction`, `dbExec`, and `extensionFetch` under the viewer's account, and explicitly says the consent step is still a TODO (`packages/core/src/extensions/html-shell.ts:531-547`). The bridge gives `editor` and `admin` roles the unrestricted bridge surface (`packages/core/src/client/extensions/iframe-bridge.ts:207-217`); only `viewer` is denied SQL and outbound proxy access (`packages/core/src/client/extensions/iframe-bridge.ts:219-267`). Content exposes the shared extension UI at `app/routes/_app.extensions.$id.tsx`.

Impact: a malicious org member can author an extension, grant a victim `editor`, and wait for the victim to open it. The code then acts as the victim, reads the victim's correctly scoped private documents, and can exfiltrate them with outbound fetch. The victim does not appear to accept a separate capability grant.

### High trust concentration: every holder of `A2A_SECRET` can impersonate every user

The A2A client places the supplied user email directly into the signed JWT `sub` claim (`packages/core/src/a2a/client.ts:40`). The receiving server accepts the verified `sub` as the caller's email (`packages/core/src/a2a/server.ts:117`), and the handler seeds request context from it (`packages/core/src/a2a/handlers.ts:426`). The token is protected from outsiders by its signature, but all connected apps share the same symmetric signing secret and the receiver does not pin an allowlist of peer issuers.

Impact: compromise or misuse of any peer deployment that holds `A2A_SECRET` permits minting a valid Content request for an arbitrary user's email. Content's row scoping then works exactly as designed—for the impersonated identity. This is a system trust-model backdoor rather than an unscoped Content query.

### High when enabled on a multi-user runtime: Local File Mode has no user boundary

In Local File Mode, `list-documents`, `search-documents`, `get-document`, and `pull-document` branch into the configured filesystem before any document access helper (`actions/list-documents.ts:55-56`, `actions/search-documents.ts:53-78`, `actions/get-document.ts:47-49`, `actions/pull-document.ts:68-83`). File IDs are reversible base64url-encoded paths, and the helper reads from process-global manifest roots (`actions/_local-file-documents.ts:67-76`, `actions/_local-file-documents.ts:231-245`, `actions/_local-file-documents.ts:361-410`). The write, create, delete, manifest, and local-component paths use the same global scope.

The framework does fail closed in production unless `AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION=true` is explicitly set, and its error calls the allowed case a "trusted single-tenant local file bridge" (`packages/core/src/local-artifacts/index.ts:346-355`). That is a good safety rail, but once overridden there is still no per-user isolation.

### Medium: document media is not coupled to document ACL revocation

The editor uploads media through the authenticated file-upload route and stores the returned URL in document content (`app/components/editor/image-upload.ts:104-152`). The Builder storage provider returns a hosted URL with no Content read token or document binding (`packages/core/src/file-upload/builder.ts:277-300`).

Impact: anyone who obtains the asset URL, plus relevant storage/provider administrators, may retain access independently of the document's sharing state. Making a document private or revoking a share does not revoke an already disclosed media URL. Runtime confirmation of the provider's anonymous-read behavior is still needed.

### Low: database navigation leaks a backing document ID

`navigate --databaseId` looks up `content_databases` by ID without resolving access, then returns and writes the backing `/page/<documentId>` path (`actions/navigate.ts:14-20`, `actions/navigate.ts:57-61`). The later document read is denied, so this is an existence/backing-ID oracle rather than a body leak.

### Low: private-document existence can be distinguished

`/p/:id` returns 404 for a missing row but a private placeholder for an existing private row (`app/routes/p.$id.tsx:94-138`). IDs are random enough that blind enumeration is impractical, but a leaked ID can be confirmed.

### Sound protections found

- Database-backed documents use `ownableColumns()` and a registered shares table (`server/db/schema.ts:10-27`, `server/db/index.ts:13-25`).
- Normal SQL list/search paths use `accessFilter`; full reads use `resolveAccess`; writes use `assertAccess` (`actions/list-documents.ts:68-97`, `actions/search-documents.ts:93-113`, `actions/get-document.ts:51-65`, `actions/update-document.ts:207-211`).
- Comments, versions, and database child data are normally gated through the backing document and owner-scoped afterward (`actions/list-comments.ts:42-54`, `actions/list-document-versions.ts:20-36`, `actions/get-content-database.ts:53-81`).
- Public agent chat receives only a bounded public-document excerpt. `get-document` is marked authenticated-only, and the anonymous tool filter excludes it (`actions/get-document.ts:36-44`, `packages/core/src/server/agent-chat/action-filters-a2a.ts:48-60`).
- Scoped agent tokens are resource-bound, expiring, and production signing fails closed without a secret; the JSON agent-context endpoint is `no-store` and `no-referrer`.
- The unscoped-query, localhost-fallback, environment-mutation, DB-tool-scoping, unscoped-credential, and environment-credential guards all passed on this source snapshot.

## Who is intentionally allowed to see another user's data?

- The owner.
- A user or organization explicitly granted `viewer`, `editor`, or `admin` on a document.
- Members of the document's organization when visibility is `org`.
- Anyone who knows the link/ID when visibility is `public`; public documents are deliberately omitted from ordinary discovery but readable by direct ID.
- Deployment/database administrators can read document bodies because Content stores plaintext document content in SQL. This is server-side access control, not end-to-end encryption.
- Storage-provider administrators and URL recipients may be able to read uploaded media.
- The configured model/provider receives document material supplied to an agent run. That is a provider-data boundary, not a cross-account ACL bypass.
- Every application or operator holding the shared `A2A_SECRET` is effectively trusted to assert any user's identity to Content.

The code audit cannot name the exact emails currently holding grants, exact documents marked `org`/`public`, or whether dangerous environment overrides are enabled. That requires a production access inventory and deployment/CDN configuration read.

## Inferences

- The ordinary database action layer is materially stronger than "vibe-coded" suggests. Most direct document CRUD paths follow the framework's access primitives consistently.
- The highest risks live where one subsystem's trust model meets another: SSR caching, external OAuth, executable extensions, and local filesystem mode.
- A private-by-default flag is insufficient for a personal vault if revocation is not reliable, media is independently public, or same-org executable content can act as the viewer.
- Even after the cross-user bugs are fixed, hosted Content will not be zero-knowledge. Infrastructure operators remain inside the trust boundary unless document content and media are end-to-end encrypted with keys unavailable to the server.

## Uncertainties

- No production database was inspected, so current share grants and `public`/`org` rows are unknown.
- No deployed environment was inspected, so `AUTH_DISABLED`, Local File Mode production override, which peers hold `A2A_SECRET`, CDN behavior, and storage-provider settings are unverified.
- Runtime exploit tests were not run. The worktree has no `node_modules`, so `pnpm action db-check-scoping --format json` failed because the `agent-native` binary is unavailable.
- The media URL's anonymous-read policy was inferred from the upload contract and needs a deployed fetch test.
- The extension exploit was traced statically and should be confirmed with two disposable org accounts and a harmless canary payload before remediation is declared complete.

## Recommendation

Treat these as migration gates, in order:

0. **Immediate prerequisite — inventory production exposure and restore dynamic evidence.** Inspect the deployed Content database, CDN, blob provider, authentication mode, Local File Mode override, A2A peers, and current public/org/share rows without reading document bodies. Install the worktree dependencies and rerun `pnpm action db-check-scoping --format json`; perform the anonymous media fetch test. This inventory changes urgency and blast-radius planning, not whether the P0 findings are remediated.
1. **P0 — remove private data from the universal SSR cache contract.** Public/tokenized document bodies must not be emitted through a route that the framework forcibly caches as a shared shell. Move the body to an auth/token-checked data request or create a narrowly reviewed non-shell response with revocation-safe caching. Add a public-to-private and token-expiry CDN regression test.
2. **P0 — add explicit extension capability consent.** A recipient must not run another user's extension with their own private-data/action/outbound-fetch authority merely by opening it. Bind bridge permissions to an accepted, visible capability manifest; default shared extensions to viewer-safe reads and no exfiltration path.
3. **P0 — stop delegating owner Notion OAuth to ordinary Content editors.** Use the caller's connection, require a distinct integration-manager grant, or constrain sync to the already-linked remote page with no relink/create authority.
4. **P0 — replace shared-secret A2A identity assertion with bounded trust.** Require peer-bound issuer identity, a pinned audience, and a subject constrained to the identities and scopes that peer may assert. Treat peer compromise as an explicit threat in tests and rotation procedures; choose the signing mechanism during protocol design rather than in this audit.
5. **P0 — keep Local File Mode single-tenant by construction.** Do not enable its production override on a multi-user deployment. If hosted vaults need filesystem semantics, introduce a per-user storage root and enforce ownership before decoding or reading a path.
6. **P1 — use private blob storage with authorization or short-lived signed reads** so document ACL revocation also revokes media access.
7. **P1 — add a production access-inventory action/report** that lists each document's owner, visibility, user/org grants, inherited children, attached external sources, and independently hosted media. This answers "who can see what now" without raw database access.
8. **P1 — add two-account adversarial tests** for private CRUD, comments/versions/databases, org visibility, direct shares, public-to-private revocation, Notion editor behavior, extensions, agent/MCP/A2A identity, and Local File Mode refusal.
9. **P2 — close metadata oracles** such as unscoped database navigation and private-document existence differences.

After P0/P1 remediation, run the audit again against the deployed Content app with disposable Alice/Bob/Mallory accounts, the real CDN, the real storage provider, and an inventory of actual share rows. Only then make the vault migration decision.

## Sources

Primary sources are the repository files cited inline above. Automated checks run successfully on this snapshot:

- `pnpm guard:no-unscoped-queries`
- `pnpm guard:no-localhost-fallback`
- `pnpm guard:no-env-mutation`
- `pnpm guard:db-tool-scoping`
- `pnpm guard:no-unscoped-credentials`
- `pnpm guard:no-env-credentials`

Dynamic scoping action attempted but unavailable in this worktree:

```text
pnpm action db-check-scoping --format json
sh: agent-native: command not found
Local package.json exists, but node_modules missing
```
