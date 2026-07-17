# @agent-native/creative-context

Shared creative-library ingestion, governed reusable contexts, immutable
evidence, hybrid retrieval, brand context, and generation provenance for Agent
Native creative apps.

The package turns Google Slides, Figma, Notion, websites, and uploaded
PPTX/DOCX/PDF/PNG/JPEG/WebP/GIF/safe-SVG files into a versioned SQL corpus. Binary originals, localized visual
fallbacks, and bounded UI thumbnails live in private blob storage; full-slide
and full-frame source renders are temporary QA inputs and are discarded. Text remains directly greppable in
SQL; PostgreSQL deployments add full-text candidates and pgvector visual
similarity in the same `DATABASE_URL` database.

## Install

```bash
pnpm add @agent-native/creative-context
```

Add the server plugin once per app:

```ts
// server/plugins/creative-context.ts
import { setupCreativeContext } from "@agent-native/creative-context/server";

export default setupCreativeContext({ appId: "slides" });
```

Mount the shared Library tab on the app's existing Agent page:

```tsx
import { AgentTabsPage } from "@agent-native/core/client";
import { createCreativeContextAgentTab } from "@agent-native/creative-context/client";

export default function AgentPage() {
  return <AgentTabsPage extraTabFactories={[createCreativeContextAgentTab]} />;
}
```

Importing `./server` registers the package actions through the framework's
package-action registry, applies additive corpus migrations, registers
shareable sources/profiles/contexts/packs, starts resumable import processing,
and conditionally contributes published brand context to agent prompts. Each
owning app also registers a server-side native capture adapter so its Share
popover can submit a deck, design, document, asset, or dashboard by resource id
without sending native payloads through a generic action. The prompt
contribution is omitted structurally whenever application state contains
`{ contextMode: "off" }`.

## Governed contexts

A brand profile contains approved identity and DNA. A Creative Context is the
durable, shareable collection people maintain (for example Default, Marketing,
Product, or Sales). A context pack is the immutable exact-version receipt for
one generation.

- Every personal or organization scope has one non-archivable Default context.
- Requests use Default plus at most one specialty context. Explicit selection
  wins; an app binding or semantic match supplies the automatic specialty.
- `open` contexts publish editor submissions immediately. `review` and
  `admins-only` contexts keep the proposed version private to its submitter and
  context administrators until approval.
- The currently approved snapshot remains active while a newer version is
  pending. Removal affects new retrieval immediately without rewriting old
  packs.
- Publishing into a broader context requires source-management permission and
  explicit confirmation. Acceptance writes an immutable context-owned copy;
  it never changes the original resource's sharing.

The standard UI is the Context tab in the framework Share popover plus the
context-first Library. The Library rail selects Default or a specialty and its
Items, Sources, Approvals, and Settings views show only safe, bounded previews:
slide filmstrips, design frames, rendered document structure, access-scoped
media, and dashboards populated with synthetic preview data.

Exact app-native data is a separate private blob capability. Generic list,
item, pack, status, media, and search responses never expose that capability.
Only the owning app's typed clone action can resolve it, verify the stored hash
and resource identity, and create a new editable resource through that app's
normal persistence path. Imported Google Slides and Figma artifacts continue
to use the stricter trusted-compiler and native-reassembly path.

## Retrieval behavior

- Portable SQL uses normalized grep modes (`allTerms`, `anyTerm`, `phrase`,
  `regex`) and weighted title/summary/body scoring.
- PostgreSQL adds a `tsvector`/GIN candidate lane and one configured multimodal
  embedding family backed by pgvector in the same database.
- SQLite keeps corpus and lexical/caption search only. Visual queries fail with
  a clear PostgreSQL+pgvector requirement; the package never creates another
  SQLite or vector database.
- Every context-backed generation resolves Default plus zero or one specialty,
  applies the specialty ranking boost, and snapshots exact
  `(itemId, itemVersionId)` evidence, lane scores, selection reason, and context
  ids into an immutable context pack.

Context packs are intentionally ownable and independently shareable instead of
inheriting broad source visibility. A pack records one generation's request,
selected evidence, and influence scores, which can reveal private work intent
even when every underlying source is organization-visible. Only the creator can
see a new pack; collaborators receive it through an explicit pack share.
Ordinary source evidence remains subject to current source access and
revocation. Context-owned published snapshots remain replayable at their pinned
version for authorized pack viewers after membership removal.

## Isolated deployments

Apps in one workspace use the shared database in-process by default. If an app
is deployed against a separate database, set `CREATIVE_CONTEXT_A2A_URL` to the
app that owns the corpus and configure either the shared `A2A_SECRET` on both
deployments or a matching org-scoped `CREATIVE_CONTEXT_A2A_KEY`. The fallback
forwards only bounded resolve, validate, generation-record read, and
generation-record write operations through the authenticated A2A protocol.
Caller identity is signed and re-resolved by the receiver, all request and
response shapes are strictly validated, and malformed or timed-out responses
fail clearly instead of falling back to untracked context. Optional
`CREATIVE_CONTEXT_A2A_TIMEOUT_MS` is clamped to 1–60 seconds and defaults to 30
seconds. Do not place these values in client code or application state.

`CREATIVE_CONTEXT_A2A_URL` is opt-in: without it, no A2A request occurs. A
saved or one-generation `contextMode: "off"` also structurally suppresses the
remote path.

## Trust and lifecycle

Imported text is evidence, never instructions. Only human-published, validated
structured brand fields can enter the typed `<brand-context>` prompt block.
Restricted upstream items default to review and exclusion. Organization copies
require an organization admin or verified container owner plus a confirmation
of the exact container and item count. Disconnecting or deleting a source
tombstones it synchronously so retrieval stops immediately; private blobs are
purged asynchronously. Native context submissions use the same fail-closed
private-blob rule and never fall back to SQL payload storage.

## Exports

| Subpath        | Purpose                                                      |
| -------------- | ------------------------------------------------------------ |
| `.`            | Shared types and generation-context helpers                  |
| `./actions`    | Registered action map                                        |
| `./client`     | Library panel, Agent tab, context chip, state hooks          |
| `./connectors` | Connector registry plus public Slides/Figma native compilers |
| `./embeddings` | Multimodal family adapters and bake-off inputs               |
| `./eval`       | Retrieval, quality, and hard-gate evaluation helpers         |
| `./jobs`       | Durable import, enrichment, purge, and rebuild workers       |
| `./messages`   | Shared localized Library UI messages                         |
| `./schema`     | Additive Drizzle corpus schema and migrations                |
| `./server`     | Setup plugin, action registration, prompt/resource wiring    |
| `./store`      | Access-scoped corpus stores                                  |
| `./vector`     | PostgreSQL/pgvector adapter and fail-clear guard             |
