---
record_type: "capability"
spec_version: 2
id: "content.knowledge.search"
name: "Search"
user_promise: "Fast access-aware search across titles, bodies, rows, sources, and later comments/review"
primary_user_job: "Find the most useful authorized evidence quickly and understand where it came from and how fresh it is."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.access.visibility-closure"]
related_features: ["content.feature.durable-foundations"]
roadmap_boundary: "feature"
acceptance_summary: "Search performs indexed lexical retrieval first across eligible objects, fuses a semantic lane on hosted Postgres, ranks by relevance before personal freshness, returns access-scoped snippets and highlights with source and freshness, and shares ranking semantics between people and agents."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence:
  [
    "../../../actions/document-discovery.db.test.ts",
    "../../../app/lib/content-command-search.test.ts",
    "../../../app/components/ContentCommandSearch.tsx",
  ]
superseded_by: null
last_reviewed: "2026-11-08"
---

# Search

## Why this exists

Search is how a system remembers aloud. It must be quick without ever pronouncing information a viewer may not read.

## Example workflow

A contributor searches a phrase, opens an indexed Page snippet, filters to a connected Source, and sees that one result is stale rather than treating it as current.

## Product contract

Search performs indexed lexical retrieval first across eligible objects, returns access-scoped snippets and highlights with source and freshness, and shares ranking semantics between people and agents.

- **Meaning, not only words.** On hosted Postgres, a semantic lane matches by meaning through embeddings computed as content is committed. It fuses into the same ranked result for every caller rather than becoming a separate answer surface, and exact and partial title matches stay a protected prefix. The lanes and their fusion follow the core [search architecture](../../../../../docs/search-architecture.md).
- **Freshness ranks within relevance.** After relevance, results the searcher recently opened rank ahead of the rest, then recently changed results. Freshness reorders matches; it never admits a non-match or lifts a result over an exact title. One person's opens never change another person's ranking or reveal who read what.
- **Derived data stays inside access.** Embeddings, similarity scores, and recorded opens are derived from Pages and follow `content.access.visibility-closure` and `content.agent.audience-safe`: a vector, score, or neighbor never discloses an object the searcher can't read, and lost access invalidates what was derived from it.

## Boundaries and non-goals

Visibility closure owns authorization. Semantic retrieval ranks real objects; this is not semantic-answer generation, a source-truth override, or a leakage-prone global index. Suggesting related work beside an open Page belongs to `content.knowledge.related`, which reuses this index.

## Acceptance stories

### Suppress a private matching title

Given a private matching Page, when a viewer searches its title and body, then no result, highlight, count, or ranking inference exposes it.

### Label a stale connected result

Given a stale connected Source result, when it appears, then its freshness state is visible and opening it follows the Source policy.

### Find a Page by what it means

Given a Page titled "Q3 hiring plan" whose body discusses the recruiting budget, when a person searches "how many people can we hire this quarter" on hosted Postgres, then the Page appears through the semantic lane with its source and freshness, and an agent asking the same query receives the same order.

### Keep personal freshness personal

Given two teammates who can read the same Pages, when one of them opens a Page repeatedly, then only that person's ranking for a matching query changes, and nothing the other teammate sees reveals who opened it.

## Current evidence

Existing search paths are in progress donor substrate, but complete indexed, freshness, and agent-parity proof is incomplete. This Capability remains `in_progress`.

The command picker uses the shared paginated search Action, with title-only,
document-type and modified-date predicates applied before pagination. Parent
context is independently access-scoped. The query supports a bounded
Google-style operator set: quoted "exact phrases", `-excludedTerm`,
uppercase `OR` between terms, `intitle:term`, and implicit AND across bare
words; `%`, `_`, and `*` stay literal, and an all-workspaces scope option
omits the space filter while keeping server-side access scoping. Search ranks
the complete authorized match set before pagination. Exact and contiguous
partial titles form protected tiers above title-word, description, and body
matches; modification time only breaks otherwise equal results. Snippet windows
prefer context containing more positive terms. Focused tests cover later pages,
private-parent suppression, hidden-result counts, title tiers, useful snippets,
type filters, and each operator. A 10,000-document PGlite benchmark covers the
current warm-query budget. This is bounded lexical search substrate, not proof
of indexed retrieval across every Source, authoritative author filtering,
freshness ranking, or policy-governed global search.

When a query matches nothing, the search Action corrects each word of four or
more characters that no visible title or description contains, to the closest
words that one does (one edit, two for words of eight or more characters). The
vocabulary comes only from Pages the same search could return, so a
correction never exposes a word from a Page the searcher can't open; the
response lists the corrections. Body words aren't corrected yet, and a library
of more than 50,000 distinct title and description words is corrected from its
most-used 50,000. The committed relevance eval gates its typo cases, and
focused tests cover access, filters, punctuation, text stored in other forms,
phrases, short words, literal matches, the word cap, and paging on both the
index and the scan.

Local browser verification of the command picker covered 27 authorized matches
across two result pages, equal-title parent context, keyboard opening, title/body
and type/date filters, explicit request failure and retry. Pagination and retry
return focus to the search input. A reversible composition with the companion
sidebar controls change verified collapsed Search and the 390px mobile drawer:
the picker and filters remain visible above the drawer, Escape returns to Search,
and opening a result closes the drawer. This composed proof depends on that
companion's entry wiring and shared CommandMenu layer fix; it does not certify
screen-reader output or broader cross-context retrieval policy.

No Content search uses embeddings or recorded opens yet. The semantic lane and
the record of recently opened resources are planned in the core search
architecture, and the relevance eval's `question` class stays report-only until
search targets it.

## Proof plan

1. Index titles, bodies, rows, and Sources; test lexical queries, snippets, highlights, and pages.
2. Verify private-match suppression, human/agent ranking, freshness, provenance, and opening.
3. Exercise stale indexes, source refresh, reload, keyboard traversal, and result summaries.
4. Make the relevance eval's `question` class gating once the semantic lane serves Content, and prove that freshness reorders results only within a relevance tier and only for the person whose opens produced it.

## Open questions

- Which embedding provider computes Content's vectors, and whether Page text may leave the deployment to do so, is undecided.
- Whether other people's opens may count as a shared popularity signal, and how to do that without revealing who read what, is undecided. The searcher's own recent opens are the first accepted freshness signal.
- How strongly freshness weighs against relevance should be set by the relevance eval rather than chosen in advance.
