# Agent Native Content architecture

Agent Native Content is one composable system in which documents, structured
records, connected data, human collaboration, and agent work share stable
objects and one Action surface. A person chooses the surface that fits the
moment: a Page for writing, a Database for governed records, a View for a
particular presentation, a Query for derived collections, a Reference for
reuse, an Expression for computation, or a Template for distributing a whole
working system.

```text
Stable Pages, Blocks, Blocks fields, Databases, and References
                              ↓
              Typed Properties and one expression language
                              ↓
                  Queries, Views, and reusable renderers
                              ↓
                    Committed Events and typed Actions
                              ↓
             History, review, Rules, notifications, and agents
                              ↓
                 Templates compose and govern the same graph
```

Everything uses one Content object graph and one access model. Tasks,
dashboards, public roadmaps, research systems, blogs, and editorial workflows
are configurations of these primitives, not parallel engines.

## Product principles

1. **One object, many projections.** Views, memberships, References, embeds,
   Sources, Graphs, and Canvases do not create accidental copies.
2. **Simple gestures, composable machinery.** An `@` mention remains a
   Reference; computation and automation appear only when requested.
3. **Typed underneath, humane on top.** Values retain stable meaning while
   renderers change how they look.
4. **One Action surface.** People, agents, automations, APIs, and the interface
   use the same permissions, validation, audit behavior, and mutation semantics.
5. **Access before computation.** Search, Queries, relationships, aggregates,
   exports, agents, and embedded hosts see only authorized information.
6. **Source truth is explicit.** Every connected Source declares how reads,
   synchronization, and write-back behave. Unknown provider data survives
   faithful round-tripping.
7. **Events describe committed meaning.** They record actors, origins,
   causality, and recoverable change rather than every keypress.
8. **Changes remain reviewable work.** Suggestions, typed diffs, Versions,
   automation receipts, and History persist instead of evaporating with a
   dialog.
9. **Templates fork; they do not possess.** Instances are owned, editable
   snapshots with provenance and optional reviewed updates.
10. **Import and export are constitutional.** Collaborative Content may use SQL
    as its working truth, but people can bring work in, take it out, and keep
    connected originals where they belong.
11. **Product status stays honest.** Donor code, dependencies, and isolated
    tests never prove a whole Capability or Feature by association.

## Object boundaries

- A **Page** owns stable identity, title, access, top-level Properties, and one
  or more Blocks fields.
- A **Blocks field** owns one editable rich-content body and its attributable
  revision history. Comments and Discussion messages use the same grammar
  without becoming full Pages.
- A **Database** owns membership, schema, defaults, validation, Rules, and the
  canonical creation route for its records.
- A **Query** derives a typed collection from Databases, Sources, or other
  Queries without owning the source records.
- A **View** belongs to one Database or Query and owns downstream filtering and
  presentation. It may be shared or Only me, but it never grants access to its
  input.
- A **Relationship** is one canonical typed edge. Relation Properties, inline
  references, Info, Queries, Graph, and Canvas are projections and editors of
  that edge.
- A **Source** is an adapter with explicit capabilities, provenance, access,
  and synchronization policy. It never becomes a Page's identity or primary
  Database.

## Change and proof boundaries

Every atomic Capability has its own proof requirements. A Feature is complete
only when its required Capabilities are verified and its example workflow works
end to end through the real interface and Actions. Existing provider-specific
machinery may donate implementation, but it does not promote a generic contract
until that contract is tested on its own terms.

Named Page Versions sit above ordinary Blocks-field revision history. Revision
history supports attribution, comparison, and recovery everywhere. Named
Versions later provide deliberate alternatives, selective merge, access
restriction, and canonical promotion under one Page identity.

## Governance boundary

Content provides flexible local objects and governed reusable catalogs.
Organizations can approve Sources, Templates, Custom Properties, Expressions,
Skills, and Custom Blocks without turning every ordinary object into a global
type. Non-bypassable security and identity policy remains framework-wide;
Content can be its best management surface without becoming an independent
authority with conflicting answers.
