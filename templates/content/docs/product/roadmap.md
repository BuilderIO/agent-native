# Agent Native Content public roadmap

<!-- Generated from the atomic records in chapters/, features/, and capabilities/. Do not edit this projection directly. -->

Agent Native Content brings documents, data, connected sources, collaboration, and agent work into one durable place. People and agents work on the same real objects through the same permissions and operations. The result is a workspace that can begin as a Page, grow into a system, and remain understandable, portable, and recoverable as more people and automations become involved.

## How to read this roadmap

Content is grouped into six implementation Chapters. Numbered Features describe complete vertical workflows that people can understand and use. Atomic capabilities may arrive piece by piece, but a Feature is not complete until its example workflow works end to end.

Feature statuses:

- **Available:** The complete workflow works for people and agents with the correct permissions, persistence, recovery, accessibility, and polish.
- **In validation:** The complete workflow exists and is being hardened before becoming Available.
- **Partially implemented:** Meaningful parts exist, but the workflow is not yet reliable or proven end to end.
- **Planned:** The Feature is approved and ordered, but does not yet have enough implementation to describe as active.
- **Paused:** Work deliberately stopped while its research and implementation history remain preserved.

No Feature is marked Available yet. Existing foundations are useful, but the complete workflows still need the polish and proof described below.

## Chapter 1: A durable home for your thinking

Chapter 1 gives people and agents a dependable place to create, organize, find, reshape, and recover their work. Pages and Databases remain understandable after an interruption, important material can be reused without drifting copies, and every authorized collaborator can return to the same durable context. The following Features establish that foundation.

### Feature 1: Durable foundations

Pages, Blocks, Databases, Search, history, and recovery form one trustworthy material loop.

**Status:** In validation

**Example workflow:** A teammate creates a project brief, turns its action items into Database records with owners and due dates, closes the app, finds the work again through Search, restores an accidentally deleted Block, and asks an agent to continue from the same durable context.

**What works today:** Content already has SQL-backed Pages, rich Blocks, Databases, Search, document snapshots, and a broad agent Action surface. People and agents can perform much of the ordinary creation and editing loop on the same durable objects.

**What remains:** Stable Block identity, actor-aware history, dependable recovery across every object type, and complete end-to-end action parity still need to become one polished foundation.

**What this Feature includes:**

- **Pages:** Hold durable identity, access, properties, rich content, and the context required to resume work.
- **Blocks:** Give every editable rich-content body the same composable grammar, whether it belongs to a Page, Property, Comment, or message.
- **Databases:** Govern writable collections, membership, typed Properties, validation, defaults, Rules, and the canonical path for creating records.
- **Search:** Finds only what the current person can access and opens the exact object or context they were looking for.
- **History:** Records attributable committed Events and logical Revisions without turning every keystroke into a fake milestone.
- **Recovery:** Restores deleted or changed work without discarding the history that explains what happened.
- **Agent parity:** Lets agents perform the same authorized operations through the same Action surface rather than a second, weaker API.

**Required capability records:** [Pages](capabilities/content.object.page.md), [Blocks](capabilities/content.object.block.md), [Blocks fields](capabilities/content.object.blocks-field.md), [Databases](capabilities/content.object.database.md), [Search](capabilities/content.knowledge.search.md), [Committed Events](capabilities/content.event.committed.md), [History](capabilities/content.history.queryable.md), [Agent and UI parity](capabilities/content.agent.action-parity.md)

**Enhancing capability records:** [Blocks-field revision history](capabilities/content.version.field-history.md), [Actor properties](capabilities/content.property.actor.md), [Document editor](capabilities/content.author.document-editor.md)

### Feature 2: Find your place again

Content makes arrival, navigation, and resumption feel dependable instead of asking people to remember where they left everything.

**Status:** Partially implemented

**Example workflow:** A new teammate follows an invitation, lands in the correct organization and Workspace, pins the project they care about, and later returns directly to the exact Database View they were using.

**What works today:** Content has Personal and organization-backed spaces, Workspace navigation, invitations, sidebar structure, and saved location state in varying degrees of maturity.

**What remains:** Global Home, clearer context switching, intentional pinning and dynamic sidebar sections, and reliable resumption into the exact focused View need to work as one arrival experience.

**What this Feature includes:**

- **Home:** Gives each person a top-level view across the Personal and organization contexts they can access.
- **Workspaces:** Organize Pages and Databases beneath Personal or an Organization without becoming the permission model themselves.
- **Sidebar:** Pins important Pages, Databases, and Queries while allowing dynamic sections such as Recent and Shared with me.
- **Recent work:** Restores the objects and views a person was actually using, scoped by current access.
- **Known links and invitations:** Land on the intended object with an honest access-denied state when permission is missing.
- **Session resumption:** Reopens enough navigation and View state to pick up the work without reconstructing the route manually.

**Required capability records:** [Content spaces and Files](capabilities/content.source.spaces-files.md), [Personal and organization contexts](capabilities/content.workspace.multi-scope.md), [Global Home](capabilities/content.home.global.md), [Personal sidebar](capabilities/content.navigation.sidebar.md), [Session resumption](capabilities/content.workspace.session-restore.md)

**Enhancing capability records:** [Working set](capabilities/content.workspace.working-set.md), [View instances](capabilities/content.workspace.view-instance.md)

### Feature 3: Living references

Reuse canonical Pages and Blocks without producing copies that quietly drift apart.

**Status:** Partially implemented

**Example workflow:** The Docs team maintains one canonical product-description Block that appears across several guides and blog posts, edits it from any occurrence, and sees every authorized location update without copy and paste.

**What works today:** Content can reference Pages, embed ordinary Database Views, and preserve multi-membership without copying canonical records. Existing reference Blocks and source-aware identities provide useful substrate.

**What remains:** Stable Block references, editable Synced Blocks, canonical Page embeds, a complete Connections surface, and typed relationship behavior still need to converge.

**What this Feature includes:**

- **References:** Link to a Page or Block as a compact mention, card, or embedded preview.
- **Synced Blocks:** Render one canonical Block in several places and allow authorized edits from any occurrence.
- **Embedded Pages:** Place a canonical Page inside another surface while preserving its identity and access.
- **Backlinks and forward links:** Show where an object is mentioned and what it intentionally references through Info → Connections.
- **Typed Relationships:** Give important connections explicit meaning that Databases, Queries, Graphs, and agents can use.
- **Graceful degradation:** Omit inaccessible references and preserve understandable broken or deleted-reference states.

**Required capability records:** [References](capabilities/content.object.reference.md), [Synced Blocks and live embeds](capabilities/content.object.transclusion.md), [Links and backlinks](capabilities/content.knowledge.links.md), [Typed Relationships](capabilities/content.relationship.edge.md)

**Enhancing capability records:** [Blocks](capabilities/content.object.block.md), [Named Page Versions](capabilities/content.version.branching.md)

### Feature 4: Make the workspace yours

Personal arrangements and private Views reshape shared work without changing it for everyone else.

**Status:** Partially implemented

**Example workflow:** A sales leader privately filters and groups the shared customer Database around this quarter's accounts, saves that arrangement as an Only-me View, and never changes what the rest of the company sees.

**What works today:** Saved Database Views already support filtering, sorting, grouping, density, and several renderers, while the data model supports Pages belonging to multiple Databases.

**What remains:** Automatic personal overrides, named Only-me Views, reusable typed Queries, and predictable pinning and sharing behavior need complete product surfaces.

**What this Feature includes:**

- **Personal View changes:** Remember one person's filters, sorting, grouping, density, and presentation over a shared View.
- **Only-me Views:** Save named private Views over shared records without forking their data.
- **Shared Views:** Give collaborators a dependable starting presentation while preserving personal exploration.
- **Saved Queries:** Turn reusable selection and output logic into durable Content objects that can be linked and embedded.
- **Multiple Database memberships:** Let one Page participate in several collections without gaining a primary Database identity.
- **Pinned navigation:** Let each person choose the working set that deserves persistent space in the sidebar.

**Required capability records:** [Database and Query Views](capabilities/content.view.query.md), [Reusable Query objects](capabilities/content.query.object.md), [Personal View state](capabilities/content.view.personal-state.md), [Shared Views](capabilities/content.share.views.md), [Multiple Database memberships](capabilities/content.object.multi-membership.md)

**Enhancing capability records:** [Personal sidebar](capabilities/content.navigation.sidebar.md), [Typed expression language](capabilities/content.expression.language.md)

### Feature 5: See your information your way

Move among compatible Database and Query Views without changing the records underneath.

**Status:** In validation

**Example workflow:** A marketing team edits its editorial Database as a Table, plans work on a Board and Calendar, then gives executives a compact List of the same canonical articles.

**What works today:** Table, List, Board, Gallery, Calendar, Timeline, and Form renderers already exist, along with shared filters, sorts, grouping, calculations, and visible-field controls.

**What remains:** Every renderer needs the same proven permissions, Actions, agent context, accessibility, persistence, performance, keyboard behavior, and recovery. Incomplete Views should remain gated until they pass that contract.

**What this Feature includes:**

- **Table and List:** Support fast scanning, keyboard navigation, inline editing, and flexible visible fields.
- **Board and Gallery:** Arrange records by workflow state or visual identity while preserving canonical records.
- **Calendar and Timeline:** Place records across dates and ranges through the same typed time Properties.
- **Form:** Collect new records through a saved presentation of the Database's schema and validation.
- **View controls:** Filter, sort, group, format, and conditionally style each presentation.
- **Density:** Adjust compact, cozy, or comfortable spacing and secondary information without creating another View type.
- **Renderer conformance:** Gives every View the same permissions, Actions, agent context, accessibility, persistence, and recovery contract.

**Required capability records:** [Typed renderers](capabilities/content.renderer.typed.md), [Database and Query Views](capabilities/content.view.query.md), [View renderer conformance](capabilities/content.view.renderer-conformance.md), [Large Database performance](capabilities/content.view.scale.md)

**Enhancing capability records:** [Fast keyboard capture](capabilities/content.view.fast-capture.md), [Grouping and aggregation](capabilities/content.view.grouping-aggregation.md), [Timeline View](capabilities/content.view.timeline.md)

## Chapter 2: Come to consensus without losing the evidence

Chapter 2 keeps collaboration attached to the work being shaped. People and agents can discuss a Page or Database, leave precise feedback, review attributable changes, explore alternatives, and preserve how the team reached its conclusion without rescuing the useful parts from a separate chat afterward. The following Features create that collaboration loop.

### Feature 6: Collaborate in context

Comments, Discussion, messages, notifications, and history stay anchored to the Page or Database being shaped.

**Status:** Partially implemented

**Example workflow:** A teammate comments on an unclear paragraph, discusses the larger issue in the Page's Discussion, links the conversation to Slack, and returns later to see the Comment, replies, and resulting changes together.

**What works today:** Content supports anchored Comment threads, replies, resolution, mentions, notifications substrate, and document history. These already keep precise feedback closer to the artifact than an external chat can.

**What remains:** Every Page and Database needs its universal Discussion, rich Blocks-field messages, stable permalinks, access-safe Slack continuation, and clearly attributable message revisions.

**What this Feature includes:**

- **Comments:** Attach precise feedback to text, Blocks, media, or other exact material and preserve the historical target if that material changes.
- **Discussion:** Gives every Page and Database one continuing channel for collaboration about the whole artifact.
- **Rich messages:** Use Blocks fields so messages and Comments can contain the same references, embeds, Expressions, and structured content as Pages.
- **Threads and replies:** Keep focused sub-conversations understandable without infinite nesting.
- **Permalinks:** Make every message and Comment addressable from Content, Slack, or another Page.
- **Notifications:** Route attention through durable, queryable records without inventing another inbox engine.
- **Attributable revisions:** Let message owners edit their work while preserving visible history instead of erasing what was said.

**Required capability records:** [Page Discussion](capabilities/content.discussion.page.md), [Comments](capabilities/content.comment.page-owned.md), [Blocks fields](capabilities/content.object.blocks-field.md), [Notifications](capabilities/content.notification.source.md), [Committed Events](capabilities/content.event.committed.md)

**Enhancing capability records:** [Agent presence](capabilities/content.agent.presence.md), [Reactions and Polls](capabilities/content.feedback.signal.md)

### Increment to Feature 6: Decide together

Polls and explicit outcome state deepen the same Discussion rather than creating a separate decision system.

**Status:** Planned

**Example workflow:** A team posts a Poll in the Database Discussion, allows each person to choose up to two priorities, closes voting on Friday, records the outcome, and links directly to that result from the resulting plan.

**What works today:** Comments, reactions, rich content, Database Views, and permission-aware collaboration provide pieces of the eventual interaction.

**What remains:** Poll messages, bounded multi-select, stable options, closing behavior, access-safe aggregates, featured Poll rendering, and superseding outcomes still need implementation.

- **Poll messages:** Use the shared rich-message grammar and remain linkable like any other Discussion item.
- **Single or bounded multi-select:** Lets the poll author decide whether responders may choose one answer or a fixed number.
- **Stable options:** Preserves the meaning of existing responses when wording or presentation changes.
- **Close and freeze:** Stops new responses at a deliberate boundary and keeps the resulting aggregate inspectable.
- **Access-safe totals:** Never leak inaccessible participants through counts or aggregates.
- **Outcome state:** Records the current conclusion and allows a later outcome to supersede it without manufacturing a Decision object.

### Feature 7: Review changes in place

Accept or reject proposed human and agent changes in the ordinary Content interface.

**Status:** Partially implemented

**Example workflow:** An agent revises a live article and its metadata; the editor reviews the rendered Page, accepts the stronger passages, rejects an incorrect Property change, and leaves the remaining suggestions pending for another pass.

**What works today:** Source change sets, Builder review machinery, audit records, and document snapshots prove several parts of the review loop and provide useful donor implementations.

**What remains:** Content needs one generic typed diff and suggestion system that reviews bodies, Properties, Blocks, and filtered record sets directly in their ordinary renderers.

**What this Feature includes:**

- **Suggestions:** Preserve a pending change set without mutating the canonical Page immediately.
- **Typed diffs:** Compare body content, Properties, Blocks, and structured values through their normal renderers.
- **Filtered review:** Review only the affected or relevant subset without losing dependent changes outside the current filter.
- **Selective acceptance:** Accept all, reject all, or choose individual compatible changes without seven ceremonial confirmation screens.
- **Stale changes:** Detect when the underlying material has moved and offer an honest rebase, refresh, or conflict state.
- **Agent-authored work:** Group an agent run into one inspectable Revision whose changes remain attributable and recoverable.

**Required capability records:** [In-place typed review](capabilities/content.diff.in-place.md), [Filtered change review](capabilities/content.diff.filtered-review.md), [Suggestions](capabilities/content.revision.suggestions.md), [Committed Events](capabilities/content.event.committed.md), [History](capabilities/content.history.queryable.md)

**Enhancing capability records:** [Agent-assisted review](capabilities/content.diff.ai-assist.md), [Code review](capabilities/content.review.code.md)

### Feature 8: Explore alternatives safely

Create named Versions, compare them, selectively merge them, and promote one without losing the others.

**Status:** Planned

**Example workflow:** A team keeps the published article canonical while creating a private rewrite, compares the two Versions in the normal editor, selectively merges the best changes, and promotes the rewrite only when it is ready.

**What works today:** Content preserves whole-document snapshots and can restore earlier revisions, while the broader event and diff architecture establishes the lower-level history foundation.

**What remains:** Named Page Versions, Version-specific access, in-place comparison, selective merge, canonical promotion, and Version-aware collaboration are still planned.

**What this Feature includes:**

- **One stable Page:** Keeps identity, title, top-level Properties, sharing, and Discussion common across its Versions.
- **Named Versions:** Hold deliberate alternative bodies such as a published article and a new working draft.
- **Version-specific access:** Allows a Version to be more private than its Page, but never more broadly shared.
- **Compare and merge:** Shows differences in the ordinary Page interface and supports selective acceptance in either direction.
- **Canonical promotion:** Makes any authorized Version current without destroying the Version it replaces.
- **Version context:** Quietly anchors Comments, Discussion messages, Annotations, and execution receipts to the Version being viewed.

**Required capability records:** [Named Page Versions](capabilities/content.version.branching.md), [Blocks-field revision history](capabilities/content.version.field-history.md), [In-place typed review](capabilities/content.diff.in-place.md), [Row-level privacy](capabilities/content.access.row-private.md)

**Enhancing capability records:** [Filtered change review](capabilities/content.diff.filtered-review.md), [Annotations](capabilities/content.research.annotation.md)

## Chapter 3: One workspace across every source

Chapter 3 lets people work across Content, local files, and connected providers without rebuilding everything in one proprietary home. A team can combine information from several Sources, edit it through one predictable interface, and keep supported changes synchronized while preserving ownership, access, and provider-specific meaning. The following Features make that shared workspace possible.

### Feature 9: Connect your sources

Choose governed native and provider Sources, preserve their identity, and compose them through Queries and Views.

**Status:** Partially implemented

**Example workflow:** A content lead connects Builder blog articles and resources, aligns their compatible fields in one Query, and works from a shared editorial View without losing which provider owns each record.

**What works today:** Content already models source-backed Databases, source fields and rows, provenance, multi-source composition, and adapters for Builder, Notion, and local material.

**What remains:** Sources need one governed catalog, Queries need to replace the confusing multi-source configuration surface, and field alignment, write routing, and access behavior need end-to-end proof.

**What this Feature includes:**

- **Sources catalog:** Lists approved personal, workspace, and organization connections with their capabilities and policy.
- **Provider adapters:** Give Builder, Notion, Drive, Agent Native apps, and later providers one shared contract with independent certification.
- **Item binding:** Maps each provider item to one stable Content identity without turning the provider into the Page's owner.
- **Typed Queries:** Combine Databases, Sources, and other Queries through one visual selection and alignment model.
- **Provenance:** Shows where each value or representation came from and which system owns changes to it.
- **Access-safe results:** Evaluate every result and aggregate with the current viewer's authority rather than the Query owner's.

**Required capability records:** [Sources catalog](capabilities/content.source.catalog.md), [Source adapters](capabilities/content.source.adapters.md), [Cross-source Queries](capabilities/content.view.source-query.md), [Reusable Query objects](capabilities/content.query.object.md)

**Enhancing capability records:** [Page-linked Sources](capabilities/content.source.page-link.md), [Custom Properties](capabilities/content.property.catalog.md)

### Feature 10: Trust your connected Sources

Keep supported edits synchronized according to one plain-language policy without silently losing provider-specific content.

**Status:** Partially implemented

**Example workflow:** An editor updates a Builder article from Content; the supported changes synchronize, an unknown Builder component survives untouched, and changing Draft to Published remains a separate guarded action.

**What works today:** Builder change sets, guarded writes, raw sidecars, local-folder synchronization, and source metadata already preserve several difficult round-trip and conflict boundaries.

**What remains:** Every adapter needs certification against one plain-language sync policy, seamless automatic synchronization where safe, faithful unknown-content preservation, explicit lifecycle changes, and dependable receipts.

**What this Feature includes:**

- **View only:** Pulls authorized changes into Content and never writes back.
- **Keep in sync:** Moves compatible changes in both directions automatically and interrupts only for a genuine conflict.
- **Review before write-back:** Bundles Content-originated changes into one reviewable set when the workflow requires care.
- **Faithful round-tripping:** Preserves unknown provider-owned structures even when Content cannot render or edit them.
- **Conflict handling:** Uses stable identity and base revisions to prevent silent last-writer-wins data loss.
- **Provider lifecycle:** Treats states such as Draft and Published as explicit guarded changes rather than side effects of ordinary editing.
- **Receipts and retries:** Confirms what the provider actually accepted and retries without duplicating effects.

**Required capability records:** [Source sync policy](capabilities/content.source.sync-policy.md), [Faithful round-tripping](capabilities/content.portability.roundtrip.md), [Source adapters](capabilities/content.source.adapters.md), [Builder round-trip codec](capabilities/content.source.builder-codec.md)

**Enhancing capability records:** [Guarded property changes](capabilities/content.property.guarded-change.md), [Committed Events](capabilities/content.event.committed.md)

### Feature 11: Work across every workspace

Search and save Queries across Personal and organization contexts without widening anyone's access.

**Status:** Partially implemented

**Example workflow:** A person searches their current Workspace, deliberately expands to all accessible contexts, saves a Query spanning Personal and two organizations, and shares it with someone who sees only their own authorized intersection.

**What works today:** Content has Personal and organization spaces, Workspace membership, scoped access checks, and the beginnings of cross-space navigation and search.

**What remains:** Active working context must separate cleanly from retrieval scope, while global Home, cross-context Queries, counts, aggregates, and viewer-specific evaluation need complete implementation.

**What this Feature includes:**

- **Active context:** Determines where new work is created and which organization or Personal surface governs it.
- **Retrieval scope:** Can widen deliberately beyond the active context without moving or re-authorizing objects.
- **Cross-workspace Search:** Expands from the current Workspace to every accessible context through an explicit control.
- **Cross-workspace Queries:** Save durable, shareable definitions that retain each source object's location and provenance.
- **Viewer evaluation:** Shows every reader only the intersection they can access, including counts and aggregates.
- **Global Home:** Composes authorized recent work, Queries, and dashboards without pretending everything belongs to one giant Workspace.

**Required capability records:** [Personal and organization contexts](capabilities/content.workspace.multi-scope.md), [Reusable Query objects](capabilities/content.query.object.md), [Visibility closure](capabilities/content.access.visibility-closure.md)

**Enhancing capability records:** [Global Home](capabilities/content.home.global.md), [Organization teams](capabilities/content.organization.teams.md)

### Feature 12: Bring your local work

Open a folder or repository through the same Source model while keeping device authority and browser limitations honest.

**Status:** Partially implemented

**Example workflow:** A developer opens a local documentation folder in Content Desktop, edits the files through Content, sees external file changes synchronize back, and later reads the last synchronized representation from Safari without exposing the folder path.

**What works today:** Local File Mode, manifest-declared workspaces, connected-folder Sources, source-backed Pages, conflict records, and a trusted local bridge already establish substantial foundations.

**What remains:** Opening a folder must become effortless, Desktop needs dependable background sync and caching, browser clients need graceful read and queued-write behavior, and the portable vault workflow needs full product polish.

**What this Feature includes:**

- **Local Source Bridge:** Grants access to explicitly selected folders without storing raw paths or file handles in shared SQL.
- **Folders and repositories:** Materialize local files as ordinary Content records while preserving their source identity and structure.
- **Background synchronization:** Lets Desktop or a lightweight helper keep shared representations fresh for browser clients.
- **Browser degradation:** Shows the last authorized Content representation when Safari, Firefox, or another client cannot access local bytes.
- **Queued edits:** Holds permitted source-owned changes with their base revision until an authorized bridge returns.
- **Portable vault:** Keeps the human-readable folder separate from disposable caches and any particular desktop application bundle.

**Required capability records:** [Local Source bridge](capabilities/content.source.local-bridge.md), [Files and folders as Sources](capabilities/content.source.file-folder.md), [Portable Source representation](capabilities/content.portability.source-representation.md), [Portable vault export](capabilities/content.portability.vault-export.md)

**Enhancing capability records:** [Source adapters](capabilities/content.source.adapters.md), [Source sync policy](capabilities/content.source.sync-policy.md)

## Chapter 4: Shape your own working system

Chapter 4 turns flexible Pages and Databases into working systems a team can trust. People with the right expertise can shape data, Views, Templates, Rules, Skills, and agent workflows for everyone else, while validation, governance, and safe evolution keep that flexibility from becoming organizational confetti. The following Features provide those building blocks.

### Feature 13: Data that keeps itself right

Use typed defaults, formulas, validation, and rendering so ordinary data stays consistent.

**Status:** Partially implemented

**Example workflow:** An operations lead creates a request Database whose defaults fill the creator and timestamp, formulas calculate cost, validation rejects an impossible quantity, and a guarded budget change explains its consequences before committing.

**What works today:** Content has a broad typed Property system, formulas and computed fields, editable values, form-required fields, audit fields, and several useful validation donors.

**What remains:** Defaults, formulas, validation, conditional rendering, guarded changes, typed errors, and time semantics need one expression language and one coherent configuration surface across every Property type.

**What this Feature includes:**

- **Typed Properties:** Give text, numbers, choices, dates, people, relationships, files, and rich Blocks explicit behavior.
- **Creation defaults:** Evaluate one-time typed Expressions inside the successful creation transaction.
- **Formulas:** Derive live values from the current row and related data without storing a second truth.
- **Validation:** Reject invalid values consistently across the interface, Actions, API, agents, imports, and Forms.
- **Safeguards:** Add customizable consequence text, confirmation, approval, or conditional authority before sensitive changes commit.
- **Typed errors:** Keep null, error, unavailable, and stale cached values distinct and understandable.
- **Time semantics:** Separate Dates from timezone-aware Instants and quarantine ambiguous legacy floating times honestly.

**Required capability records:** [Typed Properties](capabilities/content.property.typed.md), [Property validation and defaults](capabilities/content.property.constraints.md), [Guarded property changes](capabilities/content.property.guarded-change.md), [Typed expression language](capabilities/content.expression.language.md), [Dates, times, and durations](capabilities/content.time.types.md)

**Enhancing capability records:** [View-derived creation defaults](capabilities/content.view.dynamic-create.md), [Actor properties](capabilities/content.property.actor.md), [Cached expression results](capabilities/content.expression.cached-result.md)

### Feature 14: Share how your organization works

Govern reusable Templates, Properties, Expressions, and Custom Blocks without taking ownership away from adopters.

**Status:** Partially implemented

**Example workflow:** An administrator publishes an approved editorial Template with governed Properties and Expressions; any team can inspect and adopt it, customize the local system, or detach without losing its existing records.

**What works today:** Content already has Templates and several reusable configuration surfaces, while source Properties and local components demonstrate governed and source-backed reuse patterns.

**What remains:** Templates, Custom Properties, Expressions, and Custom Blocks need one understandable catalog model with ownership scope, inspection, adoption, local aliasing, provenance, and faithful detachment.

**What this Feature includes:**

- **Templates:** Package Pages, Databases, Views, Properties, Rules, and content into reusable starting systems.
- **Custom Properties:** Offer approved reusable field definitions without making every ordinary local column secretly global.
- **Expressions:** Store reusable typed logic with personal, workspace, or organization scope.
- **Catalog discovery:** Uses consistent names, descriptions, aliases, ownership, compatibility, and previews.
- **Adoption:** Lets someone inspect a governed building block before binding it into their local system.
- **Detachment:** Preserves the current data and behavior as a faithful local copy when someone leaves the shared lineage.

**Required capability records:** [Multi-object Templates](capabilities/content.template.graph.md), [Template governance](capabilities/content.template.governance.md), [Database item Templates](capabilities/content.template.item-body.md)

**Enhancing capability records:** [Custom Properties](capabilities/content.property.catalog.md), [Organization teams](capabilities/content.organization.teams.md)

### Feature 15: Put your organization's know-how to work

Govern reusable Skills so the agent offers the right instructions for the current person and object.

**Status:** Planned

**Example workflow:** A writer selects a paragraph and opens Ask Agent; Content prioritizes the organization's approved voice-and-style Skill, explains that it will propose a replacement, and records the resulting edits when invoked.

**What works today:** The Agent Native framework already loads governed developer Skills, and Content provides selection context and the shared Agent chat for carrying out authorized work.

**What remains:** Content needs a user-manageable Skills catalog, scope and compatibility rules, contextual discovery, specific-over-general ranking, clear mutation previews, and shared invocation for people and agents.

**What this Feature includes:**

- **Skills catalog:** Stores governed instructions with personal, workspace, organization, or public-core scope.
- **Compatibility:** Surfaces only Skills that apply to the current selection, Block, Page, Database, Property, or View.
- **Scope precedence:** Ranks the most relevant allowed instruction without flooding the interface with the entire catalog.
- **Declared effects:** Explains whether invocation proposes edits, replaces content, adds a Comment, or acts elsewhere.
- **Shared invocation:** Lets people and agents use the same Skill through the ordinary Agent chat and Action fabric.
- **Receipts:** Records what instruction ran, against which context, with which resulting actions.

**Required capability records:** [Expression catalog](capabilities/content.expression.catalog.md), [Skills catalog](capabilities/content.agent.skill-catalog.md), [Agent-authored Expressions](capabilities/content.agent.expression-authoring.md)

**Enhancing capability records:** [Template governance](capabilities/content.template.governance.md), [Unified commands](capabilities/content.command.fabric.md)

### Feature 16: Evolve systems safely

Review upstream changes to adopted systems, keep local work intact, and choose what to accept or detach.

**Status:** Planned

**Example workflow:** A new version of the editorial Template adds one Property and changes a Rule; each Database owner sees the impact, accepts the Property, declines the Rule, preserves local changes, and stops seeing the same declined update.

**What works today:** Version history, diff donors, stable identifiers, Templates, and source change-review machinery provide the pieces needed to compare evolving systems.

**What remains:** Governed building blocks need version pinning, affected-object previews, owner-scoped adoption, selective apply and reset, remembered declines, deprecation, and safe permanent divergence.

**What this Feature includes:**

- **Version pinning:** Keeps each adopted Template or Custom Property on the version its owner trusts.
- **Impact preview:** Shows affected Databases, Views, Queries, formulas, Rules, Templates, and agent workflows before publication.
- **Three-way comparison:** Distinguishes the old shared definition, the proposed update, and local changes.
- **Selective adoption:** Lets each owner accept compatible changes, decline others, or apply a safe batch.
- **Quiet decline memory:** Avoids repeatedly demanding review until the upstream change materially differs.
- **Detach to local:** Ends the shared lineage without breaking the current system or losing provenance.

**Required capability records:** [Template updates](capabilities/content.template.update.md), [Custom Properties](capabilities/content.property.catalog.md), [In-place typed review](capabilities/content.diff.in-place.md)

**Enhancing capability records:** [Template governance](capabilities/content.template.governance.md), [Committed Events](capabilities/content.event.committed.md)

### Feature 17: When this happens, that follows

React to committed Events with visible, governed Actions, retries, notifications, and receipts.

**Status:** Partially implemented

**Example workflow:** When a qualified lead enters a Database, a Rule assigns the owner, asks an agent for a bounded summary, sends the right notification, and leaves one receipt showing every action and retry.

**What works today:** Shared Actions, audit history, a framework scheduler, notifications, Automations, provider effects, and active Event and Rule work already cover much of the execution substrate.

**What remains:** Content needs one durable Event spine and Rule model with atomic claims, retries, idempotency, agent effects, notification routing, receipts, and a humane inspection surface.

**What this Feature includes:**

- **Events:** Provide atomic facts about what committed, who or what caused it, and which objects changed.
- **Rules:** Match typed conditions after commit without becoming a second expression or permission engine.
- **Actions:** Invoke the same operations available to the interface and agents.
- **Schedules and heartbeats:** Use the framework's single scheduler for time-based conditions and missed-run policy.
- **Buttons:** Give owners an explicit interface for invoking governed Actions with known inputs and consequences.
- **Agent effects:** Delegate bounded work without granting the Rule more authority than its actor or policy permits.
- **Receipts and retries:** Preserve exactly-once claims, crash recovery, honest skips, and queryable outcomes.

**Required capability records:** [Committed Events](capabilities/content.event.committed.md), [Rules](capabilities/content.rule.deterministic.md), [Agent and UI parity](capabilities/content.agent.action-parity.md)

**Enhancing capability records:** [Scheduled automation](capabilities/content.automation.scheduled.md), [Action Buttons](capabilities/content.action.button.md), [Agent-run automation](capabilities/content.agent.automation.md)

### Feature 18: Run projects your way

Use an editable Task and Project system built from ordinary Content rather than a second hidden engine.

**Status:** Partially implemented

**Example workflow:** A product team installs the blessed project Template, captures tasks from the keyboard, assigns owners, links subtasks and dependencies, and uses My Tasks while every task remains an ordinary editable Page.

**What works today:** Pages, Databases, status and person Properties, relations, Board and Calendar Views, Templates, Comments, and agent Actions already let teams assemble useful project systems.

**What remains:** The blessed Template needs fast capture, polished defaults, task and subtask Views, My Tasks, activity, dependencies, permissions, and end-to-end Builder dogfooding without introducing a separate task engine.

**What this Feature includes:**

- **Blessed Template:** Provides a strong starting system that remains inspectable and editable like any other Content setup.
- **Fast capture:** Creates work quickly with unambiguous View-derived defaults and useful keyboard navigation.
- **Assignments:** Use ordinary typed Person and Team Properties with access-safe attention and notifications.
- **Subtasks and dependencies:** Store hierarchy and blocking relationships through typed Relations with cycle protection.
- **My Tasks:** Queries assigned work across authorized memberships without inventing a private task datastore.
- **Project status:** Combines explicit owner judgment with useful rollups rather than pretending a formula can manage the project.
- **Ordinary Pages:** Lets every Task retain rich content, Properties, Discussion, Versions, and the ability to join other Databases.

**Required capability records:** [Blessed Task and Project Template](capabilities/content.system.task-project.md), [My Tasks](capabilities/content.system.my-tasks.md), [Task dependencies](capabilities/content.system.dependencies.md), [Project status](capabilities/content.system.project-status.md)

**Enhancing capability records:** [Fast keyboard capture](capabilities/content.view.fast-capture.md), [Typed Relationships](capabilities/content.relationship.edge.md), [Notifications](capabilities/content.notification.source.md)

### Feature 19: Plan work across time

Edit dates and dependencies through Timeline and Gantt-style planning while preserving the same typed records underneath.

**Status:** Planned

**Example workflow:** A project manager opens a Timeline, drags a blocked launch task into the following week, sees the dependency conflict, accepts a proposed schedule repair, and preserves the updated dates and Relationships everywhere else.

**What works today:** A Timeline renderer, typed date Properties, drag editing, relations, grouping, and shared View configuration already exist as partially proven pieces.

**What remains:** Timeline needs full renderer conformance and polish, while dependency metadata, schedule constraints, milestones, repair proposals, critical path, and Gantt-style interaction remain planned layers.

**What this Feature includes:**

- **Timeline:** Places records across typed dates, Instants, ranges, and durations.
- **Direct manipulation:** Moves or resizes permitted work through ordinary typed Actions.
- **Dependency connectors:** Renders the same Relationships used by Queries and project workflows.
- **Schedule constraints:** Detects invalid ordering and either refuses, explains, or proposes a repair according to policy.
- **Gantt mode:** Combines Timeline, dependencies, milestones, grouping, and schedule behavior without becoming another View family.
- **Critical path:** Remains a later planning layer after dependency and constraint semantics are dependable.

**Required capability records:** [Timeline View](capabilities/content.view.timeline.md), [Dates, times, and durations](capabilities/content.time.types.md), [Typed Relationships](capabilities/content.relationship.edge.md), [Schedule constraints](capabilities/content.schedule.constraints.md)

**Enhancing capability records:** [Task dependencies](capabilities/content.system.dependencies.md), [Grouping and aggregation](capabilities/content.view.grouping-aggregation.md)

### Feature 20: Build new surfaces

Create a one-off artifact, then promote it into a governed reusable Custom Block when it earns reuse.

**Status:** Partially implemented

**Example workflow:** An agent creates a one-off interactive calculator inside a Page; its owner inspects the source and rendered result, then promotes it to an approved Custom Block that coworkers can insert from the slash menu.

**What works today:** Sandboxed Extensions, local MDX components, HTML artifacts, executable-code foundations, and shared component toolkits already demonstrate several rendering and execution modes.

**What remains:** These pieces need one Custom Block lifecycle with inspectable source, secure sandboxing, optional typed props, one-off artifacts, promotion, governed catalogs, source-backed origins, and slash-command discovery.

**What this Feature includes:**

- **Artifact Block:** Stores Page-owned HTML, styles, and behavior without requiring props or a catalog entry.
- **Source and rendered views:** Lets authors inspect the code underneath and the output it produces.
- **Sandbox:** Denies network and application authority by default while enforcing time, memory, output, and asset limits.
- **Save as Custom Block:** Promotes a useful one-off into a governed reusable definition with stable identity.
- **Custom Blocks catalog:** Controls discovery, ownership, versions, permissions, compatibility, and typed props where useful.
- **Source-backed origins:** Lets repository, Builder, or later Source adapters provide the implementation without creating another product identity.

**Required capability records:** [Artifact Blocks](capabilities/content.renderer.artifact-block.md), [Custom Blocks](capabilities/content.renderer.custom-block.md)

**Enhancing capability records:** [Executable Code blocks](capabilities/content.author.code.md), [Typed renderers](capabilities/content.renderer.typed.md)

### Feature 21: Collect structured input

Build Forms over the same schema, validation, and submission Actions as the Database they populate.

**Status:** In validation

**Example workflow:** A research team publishes an intake Form that validates required fields, lets an external participant submit without reading the Database, creates exactly one record, and triggers the Database's enrichment Rule.

**What works today:** Content already has a Form View, ordered and required questions, schema-backed controls, and an atomic Action that creates and verifies an ordinary Database record.

**What remains:** Content and Agent Native Forms need one shared engine, with polished public submission, richer validation, conditional behavior, permissions, spam protection, receipts, and dependable downstream Rule handoff.

**What this Feature includes:**

- **Form View:** Saves field selection, order, presentation, and submission behavior over one Database.
- **Shared schema:** Reuses the same Property types and validation as Agent Native Forms and ordinary record editing.
- **Conditional fields:** Shows or requires inputs through the typed expression language rather than custom form-only logic.
- **Submission grants:** Allow a person to submit without silently granting broad access to the underlying Database.
- **Idempotent submission:** Prevents duplicate records when a request retries or returns ambiguously.
- **Receipts:** Records the submitted values, actor, resulting Page, and downstream Actions the submitter may inspect.

**Required capability records:** [Shared Form engine](capabilities/content.form.shared-engine.md), [Property validation and defaults](capabilities/content.property.constraints.md), [Agent and UI parity](capabilities/content.agent.action-parity.md), [Committed Events](capabilities/content.event.committed.md)

**Enhancing capability records:** [Rules](capabilities/content.rule.deterministic.md), [Durable Content jobs](capabilities/content.job.durable.md)

### Feature 22: Understand what your data says

Use Charts, Pivots, grouping, measures, and drill-down without creating a separate analytics datastore.

**Status:** Partially implemented

**Example workflow:** A marketing analyst groups campaigns by channel, compares spend and conversions in a Chart and Pivot, then drills into one surprising aggregate to inspect the canonical campaigns behind it.

**What works today:** Database calculations, grouping, rollup foundations, and chart tooling elsewhere in the Agent Native framework provide useful implementation donors.

**What remains:** Content needs typed aggregations, multi-dimensional grouping, Pivot, a shared Chart specification and renderer library, saved Chart Views, embeddable Chart Blocks, and drill-down to canonical records.

**What this Feature includes:**

- **Multiple grouping dimensions:** Partitions typed Query results consistently across Views.
- **Measures and totals:** Compute access-safe counts, sums, averages, subtotals, and grand totals.
- **Charts:** Share one typed chart specification and renderer toolkit with Agent Native Analytics.
- **Pivot:** Places dimensions on rows and columns with typed aggregations in cells.
- **Drill-down:** Opens the canonical records behind an aggregate instead of turning cells into independent data.
- **Accessible summaries:** Explains the chart or pivot meaning beyond color, shape, or pointer interaction.
- **Static fidelity:** Preserves useful output in public Pages, presentations, and exports.

**Required capability records:** [Grouping and aggregation](capabilities/content.view.grouping-aggregation.md), [Pivot View](capabilities/content.view.pivot.md), [Chart View](capabilities/content.view.chart.md), [Access-safe computation](capabilities/content.access.safe-aggregate.md)

**Enhancing capability records:** [Typed renderers](capabilities/content.renderer.typed.md), [Database and Query Views](capabilities/content.view.query.md)

### Feature 23: Build living dashboards

Compose responsive Views, Charts, expressions, controls, and prose into durable operating surfaces.

**Status:** Planned

**Example workflow:** A go-to-market lead assembles a responsive Page with pipeline Charts, filtered account Views, explanatory prose, and personal controls so people and agents can inspect the same operating picture and discuss it in context.

**What works today:** Pages can already combine prose, Blocks, references, expressions, and embedded Database Views, while saved Views provide reusable filtered presentations.

**What remains:** Responsive Page columns, resizable View and Chart Blocks, dashboard controls, chart conformance, personal interaction state, presentation behavior, and export fidelity still need implementation.

**What this Feature includes:**

- **Ordinary Pages:** Serve as the dashboard canvas without introducing a separate dashboard datastore.
- **Embedded Views and Charts:** Reference saved configurations while allowing each occurrence to override size and presentation.
- **Responsive columns:** Arrange, resize, and reorder Blocks with a layout that linearizes coherently on smaller screens and in exports.
- **Controls and Expressions:** Let viewers change authorized filters or inputs without mutating the shared default accidentally.
- **Live context:** Keeps prose, decisions, metrics, and the underlying records together for people and agents.
- **Presentation mode:** Reuses shared Slides primitives to present Pages or ordered records without inventing slide-only content.

**Required capability records:** [Responsive Page layout](capabilities/content.layout.responsive.md), [Chart View](capabilities/content.view.chart.md), [Embedded Content surface](capabilities/content.embed.surface.md)

**Enhancing capability records:** [Presentation mode](capabilities/content.presentation.mode.md), [Typed expression language](capabilities/content.expression.language.md)

## Chapter 5: Capture anything. Keep the thread

Chapter 5 turns the things people encounter into research they can keep using. Material can enter from many capture points, retain its source and exact context, become comfortable to read and annotate, and connect to citations, claims, and other knowledge without losing the original thread. The following Features support that path from capture to understanding.

### Feature 24: Capture into action

Resolve or create one canonical Page in the chosen Database, preserve provenance, and hand it to that Database's Rules and agents.

**Status:** Partially implemented

**Example workflow:** Someone shares a customer interview URL from their phone to the Research Database; Content reuses the canonical Source Page, preserves the transcript and provenance, and lets the Database's Rules extract companies and open questions.

**What works today:** Content can already import or create Pages from files, URLs, providers, local Sources, and Agent Actions, with useful provenance and Database destinations in several paths.

**What remains:** Every entrance needs one Capture contract with remembered destination, canonical deduplication, idempotency, snapshot handling, Template application, receipts, and clean downstream enrichment.

**What this Feature includes:**

- **Many entrances:** Accepts browser capture, share sheets, Clips, URLs, files, email, identifiers, providers, and Agent Actions through one contract.
- **Remembered destination:** Defaults to the last Database used for that entrance while keeping the destination easy to change.
- **Idempotent resolution:** Finds an existing canonical Page or creates exactly one, with a deliberate-copy escape hatch.
- **Provenance:** Preserves the original URL, identifier, provider identity, capture time, snapshot, and available representations.
- **Database handoff:** Applies the destination's Template, defaults, memberships, validation, and permissions.
- **Downstream enrichment:** Lets target-owned Rules and agents summarize, classify, extract, or route the record without making Capture wait for them.
- **Receipts and repair:** Reports what Capture created or reused and allows failed later enrichment to retry independently.

**Required capability records:** [Capture and enrichment](capabilities/content.capture.enrich.md), [Sources catalog](capabilities/content.source.catalog.md), [Durable Content jobs](capabilities/content.job.durable.md)

**Enhancing capability records:** [Rules](capabilities/content.rule.deterministic.md), [Multi-object Templates](capabilities/content.template.graph.md)

### Feature 25: Read and annotate anything

Read comfortably, mark exact material, preserve revision context, and find those Annotations again.

**Status:** Planned

**Example workflow:** A researcher opens a PDF, adjusts the reading layout, highlights an exact passage, adds a durable Annotation, and later finds it from the Annotations rail even after the source receives a new revision.

**What works today:** Content already renders rich documents and media Blocks, supports anchored Comments, stores source representations, and has ordinary reading and export foundations.

**What remains:** The dedicated Reader experience, durable Annotation object and rail, precise selectors across media, revision-aware anchoring, carry-forward, reading preferences, progress, dictation, and read-aloud are still planned.

**What this Feature includes:**

- **Reader surface:** Provides personal typography, width, pagination, theme, progress, and distraction-free modes.
- **Document and media representations:** Supports text, transcripts, PDFs, EPUBs, audio, video, and source-aware fallbacks over stable asset handles.
- **Annotations:** Store durable highlights, notes, tags, reactions, or structured extractions independently from resolvable Comments.
- **Precise selectors:** Anchor to text ranges, pages, regions, timestamps, transcript ranges, and the source revision being viewed.
- **Annotations rail:** Reveals highlights only when opened and supports search, filtering, grouping, re-anchoring, and orphan repair.
- **Carry-forward:** Moves a filtered set of relevant Annotations to another named Version without pretending every old anchor still exists.
- **Speech:** Adds dictation and read-aloud through shared Agent Native capabilities rather than a Reader-only AI system.

**Required capability records:** [Reader surface](capabilities/content.reader.surface.md), [Annotations](capabilities/content.research.annotation.md), [Media Blocks](capabilities/content.author.media.md)

**Enhancing capability records:** [Named Page Versions](capabilities/content.version.branching.md), [Source adapters](capabilities/content.source.adapters.md)

### Feature 26: Cite what you found

Turn a link into one durable source-and-locator identity that can render in different citation styles.

**Status:** Planned

**Example workflow:** A writer promotes an ordinary research link to a citation, adds a page locator, switches the article from author-date to footnote style, and watches the bibliography update without re-entering the source.

**What works today:** Content has ordinary links, Page references, source metadata, rich text, equations, and import and export machinery that can donate to citation rendering.

**What remains:** First-class citation identity, locators, promote-to-citation, automatic bibliographies, selectable styles, Zotero interoperability, and semantic portability need implementation.

**What this Feature includes:**

- **Promote to citation:** Converts an ordinary link without losing its anchor or source identity.
- **Source Page:** Resolves or creates the canonical record for the paper, book, website, video, dataset, or other source.
- **Locators:** Preserve page, chapter, figure, timestamp, transcript range, or another precise place within the source.
- **Style rendering:** Presents one semantic citation as a link, author-date reference, number, footnote, or bibliography entry.
- **Bibliographies:** Recompute from the citations actually present rather than maintaining a second manual list.
- **Zotero interoperability:** Uses Zotero identities and CSL styles instead of volunteering to personally maintain civilization's citation formats.
- **Portability:** Keeps citation identity intact across supported imports and exports even when the destination renders it differently.

**Required capability records:** [Citations](capabilities/content.research.citation.md), [Footnotes](capabilities/content.author.footnotes.md)

**Enhancing capability records:** [Faithful round-tripping](capabilities/content.portability.roundtrip.md), [Source adapters](capabilities/content.source.adapters.md)

### Feature 27: Sketch connections, keep what's true

Arrange canonical Content on a Canvas, sketch possible connections, and promote only meaningful typed Relationships.

**Status:** Planned

**Example workflow:** A researcher arranges Sources, claims, and Annotations on a Canvas, draws tentative lines while thinking, and promotes only the strongest line into a typed Supports relationship that Queries and agents can use.

**What works today:** Canonical Pages, Blocks, references, relation Properties, Queries, and embeddable Views provide the objects and edges a spatial surface can eventually arrange.

**What remains:** Canvas, view-local connectors, promotion into typed Relationships, semantic Graph editing, mind maps, force-directed layouts, and graph traversal remain planned capabilities.

**What this Feature includes:**

- **Canvas:** Places Pages, Blocks, Sources, Annotations, media, Views, and Query results in an intentional spatial arrangement.
- **Reusable objects:** Keeps every card or node connected to its canonical Content identity instead of becoming a canvas-only copy.
- **Visual connectors:** Supports brainstorming lines that remain local to the Canvas until their meaning is known.
- **Promote to Relationship:** Turns a chosen connector into a named typed edge that becomes queryable everywhere.
- **Semantic Graph mode:** Creates an already-selected Relationship type directly when the person is deliberately editing the graph.
- **Mind maps and layouts:** Offer hierarchical, grouped, and force-directed arrangements over the same objects and edges.
- **Graph exploration:** Later adds traversal, paths, cycles, ranking, and pattern queries after the relationship substrate is proven.

**Required capability records:** [Canvas](capabilities/content.view.canvas.md), [Graph View](capabilities/content.view.graph.md), [Graph queries](capabilities/content.knowledge.graph.md), [Typed Relationships](capabilities/content.relationship.edge.md)

**Enhancing capability records:** [Reusable Query objects](capabilities/content.query.object.md), [Annotations](capabilities/content.research.annotation.md)

## Chapter 6: Write once, keep it yours, publish faithfully

Chapter 6 carries the same canonical work from private thought into public reading, other applications, portable archives, and future systems. People can publish or embed what they choose, move their full body of work without starting over, and retain meaningful control over custody without creating a second truth that quietly drifts away. The following Features make Content useful beyond Content itself.

### Feature 28: Publish with confidence

Publish one chosen revision faithfully while private collaborative work continues behind it.

**Status:** Partially implemented

**Example workflow:** An editor publishes the current approved article revision, continues working privately on a new Version, previews exactly what public readers can see, and updates the stable URL only when the replacement is ready.

**What works today:** Content already supports sharing, public Pages, stable links, several exports, access checks, and server-rendered public surfaces.

**What remains:** Publication must bind to an exact revision or named Version, preview the real audience closure, render every Block faithfully, isolate private collaboration, preserve lifecycle history, and become polished enough for dependable CMS use.

**What this Feature includes:**

- **Publication object:** Binds one public destination to a Page, selected Version, and exact revision.
- **Page-first publishing:** Keeps Publish, Update publication, and Unpublish inside the familiar Page sharing surface.
- **Stable public URL:** Serves the last explicitly published truth rather than following every private edit automatically.
- **Rich Block fidelity:** Renders every accepted Block family or a deliberate safe fallback through the shared semantic renderer.
- **Audience preview:** Shows what the public reader can actually access before publication.
- **Private-work separation:** Prevents Comments, Discussion, unpublished Versions, inaccessible assets, and internal Properties from leaking.
- **Lifecycle history:** Records who published, updated, or withdrew which revision and preserves the public artifact's provenance.

**Required capability records:** [Public publication](capabilities/content.publish.public.md), [Public reading](capabilities/content.publish.reading.md), [Visibility closure](capabilities/content.access.visibility-closure.md)

**Enhancing capability records:** [Named Page Versions](capabilities/content.version.branching.md), [PDF export](capabilities/content.portability.pdf-export.md), [Guarded property changes](capabilities/content.property.guarded-change.md)

### Feature 29: Take the whole vault with you

Export the complete authorized vault into open, understandable formats and a lossless Content archive.

**Status:** Partially implemented

**Example workflow:** An organization exports every object the acting administrator can access into an open Markdown, CSV, assets, and manifest vault plus a lossless Content archive, then verifies the package without Content.

**What works today:** Content exports Page bodies as Markdown, HTML, and PDF-shaped output and can export editable Markdown or MDX source, with local-file workflows already proving part of the portability model.

**What remains:** Whole-vault export needs CSV, assets, an open manifest, a lossless Content archive, Notion-compatible packaging, authorized dependency closure, resumable jobs, verification, and Desktop backup.

**What this Feature includes:**

- **Open vault:** Uses Markdown or MDX, CSV, ordinary asset folders, and a small manifest for stable IDs and richer semantics.
- **Lossless Content archive:** Preserves Versions, Discussion, Comments, Annotations, Rules, provenance, and other Content-specific meaning.
- **Target packages:** Produces destination-aware exports, beginning with a Notion-compatible package and conversion report.
- **Authorized closure:** Materializes exactly what the exporter can currently see without leaking inaccessible dependencies.
- **Assets and Sources:** Includes authorized files or stable handles and reports anything that could not be resolved.
- **Durable transfer job:** Supports progress, interruption, retry, and resume without duplicating work.
- **Local backup:** Lets Desktop maintain a user-chosen portable vault separately from its fast disposable cache.

**Required capability records:** [Portable vault export](capabilities/content.portability.vault-export.md), [Faithful round-tripping](capabilities/content.portability.roundtrip.md), [Durable Content jobs](capabilities/content.job.durable.md)

**Enhancing capability records:** [PDF export](capabilities/content.portability.pdf-export.md), [Local Source bridge](capabilities/content.source.local-bridge.md)

### Feature 30: Move without starting over

Import or migrate a foreign corpus with resumable progress, provenance, repair, and a readable conversion report.

**Status:** Partially implemented

**Example workflow:** A team imports a large Notion workspace, closes the browser halfway through, resumes without duplicate Pages, and reviews a conversion report showing transformed Properties and unresolved assets.

**What works today:** Markdown and MDX import, Notion workflows, Builder pulls, local-folder synchronization, provenance, and provider identities already support several bounded migration paths.

**What remains:** Large migrations need durable server-side orchestration, checkpoints, idempotent deduplication, broader schema fidelity, conversion reports, asset repair, resumability, and explicit partial-failure recovery.

**What this Feature includes:**

- **Canonical import model:** Maps Pages, Databases, Properties, Blocks, relationships, files, and metadata into stable Content objects.
- **Provider-specific adapters:** Interpret Notion, local vaults, Builder, Drive, and later formats without making any provider's dialect the core model.
- **Checkpoint and resume:** Continues large migrations after interruption without duplicating already accepted records.
- **Identity and deduplication:** Preserves stable source IDs and makes repeated imports repair or update the intended objects.
- **Conversion report:** Explains unsupported or transformed semantics instead of quietly dropping them.
- **Repair workflows:** Lets people and agents inspect unresolved mappings, missing assets, conflicts, and partial failures.
- **Provenance:** Keeps enough source context to compare, refresh, or understand the imported material later.

**Required capability records:** [Durable Content jobs](capabilities/content.job.durable.md), [Source adapters](capabilities/content.source.adapters.md), [Faithful round-tripping](capabilities/content.portability.roundtrip.md)

**Enhancing capability records:** [Sources catalog](capabilities/content.source.catalog.md), [Committed Events](capabilities/content.event.committed.md)

### Feature 31: Work on Content inside another application

Mount and edit the same canonical Content object inside an authorized host without forking identity or permissions.

**Status:** Planned

**Example workflow:** A planner mounts the canonical project brief inside another Agent Native app, edits it through the same Actions, and sees the change, history, and permissions remain identical when opening it later in Content.

**What works today:** Agent Native toolkits already share Content components across sibling apps, and Content exposes reusable Actions and object identities that hosts can call without duplicating business logic.

**What remains:** A canonical embeddable surface needs host grants, viewer-scoped authorization, shared editing and history, stable mounting contracts, responsive presentation, and later MCP App compatibility.

**What this Feature includes:**

- **Canonical mount:** Renders the actual Page, View, or focused Content surface rather than a copied snapshot.
- **Host grant:** Gives one named application only the mount and Action capabilities it needs.
- **Viewer authority:** Never lets the host widen what the signed-in person could see or edit in Content itself.
- **Shared Actions:** Routes edits through the same validation, permissions, Events, history, and agent surface.
- **Agent Native toolkits:** Reuse common components and behavior across sibling applications without coupling them to the Content app shell.
- **MCP App widening:** Later exposes the same governed surface to compatible external agent hosts once identity and presentation contracts are proven.

**Required capability records:** [Embedded Content surface](capabilities/content.embed.surface.md), [Embedded host grants](capabilities/content.embed.host-grant.md), [Agent and UI parity](capabilities/content.agent.action-parity.md)

**Enhancing capability records:** [MCP App embedding](capabilities/content.embed.mcp-app.md), [Responsive Page layout](capabilities/content.layout.responsive.md)

### Feature 32: Keep your private vault private

Add user-controlled encrypted custody without abandoning collaboration, recovery, or ordinary agent workflows.

**Status:** Paused

**Example workflow:** A person enrolls a trusted laptop, opens an encrypted private vault locally, grants a local agent bounded access for one task, then revokes the device without exposing the vault to the service.

**What works today:** The private-vault lane has substantial research and fork implementation history around enrollment, encrypted custody, device authorization, fail-closed behavior, and cross-architecture verification.

**What remains:** The complete user product still needs audited cryptographic integration, understandable recovery and revocation, collaboration, agent access boundaries, portable exit, current-main reconciliation, and production proof. Work remains deliberately paused.

**What this Feature includes:**

- **End-to-end encryption:** Keeps private content unreadable to the service outside explicitly authorized plaintext boundaries.
- **Enrollment and recovery:** Gives people understandable key setup, device addition, rotation, revocation, and recovery ceremonies.
- **Device authority:** Lets trusted local clients decrypt only the vaults and operations they are authorized to handle.
- **Agent access:** Makes private-vault availability explicit and bounded rather than silently handing an agent plaintext.
- **Collaboration:** Preserves sharing, Versions, comments, and revocation without weakening the custody promise.
- **Portable exit:** Allows the owner to export readable authorized content and keys without permanent service dependence.
- **Paused boundary:** Retains the existing E2EE research and implementation history without claiming the complete workflow is ready.

**Required capability records:** [Private vault encryption](capabilities/content.security.private-vault.md), [Agent resource consent](capabilities/content.agent.resource-consent.md), [Portable vault export](capabilities/content.portability.vault-export.md)

**Enhancing capability records:** [Local Source bridge](capabilities/content.source.local-bridge.md), [Audience-safe synthesis](capabilities/content.agent.audience-safe.md)
