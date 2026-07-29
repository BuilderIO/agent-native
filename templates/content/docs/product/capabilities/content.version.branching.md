---
record_type: "capability"
spec_version: 2
id: "content.version.branching"
name: "Named Page Versions"
user_promise: "Multiple named body versions evolve in parallel under one Page identity and shared properties"
primary_user_job: "Explore and review a substantial alternative without disturbing the current Page or splitting the work across duplicate Pages."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.version.field-history", "content.diff.in-place"]
related_features:
  [
    "content.feature.living-references",
    "content.feature.explore-alternatives-safely",
    "content.feature.read-and-annotate-anything",
    "content.feature.publish-with-confidence",
  ]
roadmap_boundary: "feature"
acceptance_summary: "One Page can hold named alternative bodies with narrower access, independent history, in-place comparison and selective merge, explicit canonical promotion, Version-aware collaboration, and lossless recovery."
proof_requirements:
  [
    "Stable Page and Version identity with shared title, Properties, sharing ceiling, and Discussion",
    "Independent body history, in-place compare, bidirectional selective merge, durable review decisions, and canonical promotion",
    "Version-aware Comments, Discussion, Annotations, receipts, search, agents, publication, and exports under access intersection",
    "Archive, restore, failure recovery, and lossless round-trip of the Version graph",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Named Page Versions

## Why this exists

People need to explore a meaningful alternative without changing the current or published work before the alternative is ready. Copying the Page solves isolation by breaking everything else: identity, Properties, access, Discussion, source provenance, and history drift into parallel objects.

Named Versions keep the work on one Page. They add deliberate alternative bodies and review workflows above ordinary Blocks-field history; they do not turn every autosave into a branch.

## Example workflow

A team has a published article and wants to attempt a larger rewrite. An editor creates a private Version called `Rewrite`, leaves Comments for an agent, and lets the agent edit that Version while the canonical article remains unchanged. The team compares `Rewrite` with the current Version inside the ordinary Page interface, accepts some changes and rejects others, then promotes `Rewrite` when it is ready. The former current Version remains intact and addressable, and publication stays pinned until someone explicitly updates it.

## Product contract

### One Page, deliberate alternatives

- The Page retains one stable ID and URL across every Version.
- The Page title, top-level Properties, Database memberships, source identity, and sharing boundary remain Page-owned and common across Versions.
- Each named Version has stable identity, a human label, Version-specific body state, its own revision history, and a place in the Page's Version graph.
- Exactly one authorized Version is current or canonical. Promoting another Version changes that pointer; it does not overwrite or delete the former current Version.
- A named Version is not an Event, logical Revision, recovery snapshot, duplicate Page, source representation, or publication. Those concepts may refer to a Version but retain their own identities and lifecycles.
- Ordinary Blocks-field history continues independently beneath every named Version and exists even on Pages that never create an alternative.

### Versions in the ordinary Page interface

- Opening Versions changes the normal Page surface. Selecting a Version renders that body in the ordinary editor rather than in a separate diff application.
- Comparing two authorized Versions shows typed differences in place while retaining unchanged context.
- Review may accept or reject one change, all currently visible changes, or a safe filtered set. Compatible changes may move in either direction.
- Accepted and rejected decisions persist immediately with actor, origin, and Version context. Retrying an already-applied decision is idempotent.
- Selective merge does not collapse the two Version identities. Each body and its history remain independently addressable afterward.
- If either side changes after a comparison was prepared, Content shows a stale, refresh, rebase, or typed conflict state. It never silently applies a change against a different base or converts a failed comparison into `no differences`.

### Collaboration stays with the Page

- A Page has one Discussion across all Versions. It is not cloned per alternative.
- A Discussion message records the named Version and exact Revision/Event cursor visible when it was posted. The shared feed may be filtered to the current Version or all authorized Versions.
- Replies inherit the root message's Version scope. A person who cannot access a private Version cannot infer its messages through counts, unread state, participants, notifications, search, summaries, or agents.
- Comments remain Page-owned and target stable Blocks, precise ranges, the named Version and Revision, and quoted fallback context. Deleting or replacing the target text never deletes the Comment.
- Annotations retain exact Version and source-revision context. Ordinary edits may relocate an anchor within that Version; sibling Versions never inherit it silently.
- A filtered visible set of Comments or Annotations may be carried to another Version. Preview distinguishes exact matches, proposed relocations, and unresolved anchors. Accepting a mapping adds a destination target to the same contribution identity and preserves the original target and conversation.
- Execution receipts and other Version-aware contributions keep the Version context visible when reviewed later.

## Access and publication

- Versions inherit Page access by default. A named Version may restrict access to fewer people but can never be shared more broadly than its Page.
- Effective authority is the intersection of Page access and the Version restriction. Page identity and top-level Properties remain visible according to Page access; the Version body, history, diffs, attachments, receipts, and Version-scoped contributions inherit the narrower boundary.
- Inaccessible Versions are absent from ambient discovery. Their labels, participants, counts, backlinks, Query membership, search results, notifications, summaries, and agent context do not leak.
- A known opaque Version link returns an honest access-denied state without exposing private metadata and may offer the normal request-access path when policy permits.
- Search, Queries, references, embeds, agents, compare, merge, export, and source synchronization apply Version access before reading or computing.
- Ordinary Revisions inherit their named Version's access and are not independently shareable.
- Publication is separately pinned to an explicitly selected Version and exact Revision. Promoting the collaborative current Version does not silently alter what is public.

## Promotion, archive, recovery, and export

- Promotion requires the relevant edit/structural authority, commits atomically, and leaves exactly one current Version.
- The replaced current Version remains a normal alternative with its body, history, access, and collaboration anchors intact.
- Non-current Versions can be archived and restored without changing stable identity or losing history.
- Recovery failures cannot leave a half-promoted state or a Page with ambiguous current identity.
- A lossless Content archive preserves authorized Version identities, graph/ancestry information, bodies, per-field history, Discussion, Comments, Annotations, receipts, access metadata, provenance, and assets or stable handles.
- Static or compatibility exports resolve as the acting user. They include only authorized material and report unresolved dependencies rather than silently presenting an incomplete export as complete.

## Boundaries and non-goals

- Named Versions do not replace per-Blocks-field revision history, Undo, recovery snapshots, or queryable History.
- Versions is the product surface; typed diffs, filtered review, merge, and comparison are modes or supporting capabilities beneath it.
- Creating a Version does not duplicate the Page, title, Properties, membership, source identity, or Discussion.
- Publication state is not inferred from which Version is current.
- Comments and Annotations are not copied automatically into sibling Versions. Carry-forward is an explicit, provenance-preserving operation.
- This Capability does not define a second permission, event, Action, or export engine.

## Acceptance stories

### Work privately beside a stable canonical body

Given a Page with a current Version, when an editor creates a restricted `Rewrite` Version and changes its body, then the Page ID, title, Properties, memberships, sharing ceiling, and Discussion remain common while the current body's content remains unchanged.

### Compare and merge without destroying either alternative

Given two authorized Versions containing typed Block additions, edits, moves, and deletions, when a reviewer compares them in the normal Page interface and accepts only selected changes, then only those compatible changes move, both Version identities remain, and every decision has durable attribution. Retrying an accepted decision does not duplicate it.

### Promote without publishing by accident

Given a public artifact pinned to Version A at revision R, when an authorized editor promotes Version B to current, then B becomes the sole collaborative current Version, A remains addressable, and the public artifact remains pinned to A/R until explicitly updated.

### Keep private Versions truly private

Given a Page viewer without access to restricted Version B, when they open Discussion, search, run a Query, ask an agent, follow an embed, inspect notifications, compare Versions, or export the Page, then neither B nor its derived counts, labels, participants, content, or contributions are disclosed. A known direct link yields only an honest denial.

### Carry forward research without losing its origin

Given a filtered Annotation rail containing exact, relocatable, and unresolved anchors from Version A, when an authorized person chooses **Carry visible to this version** for Version B and accepts a subset, then accepted contributions gain B targets with mapping provenance, unresolved anchors remain unresolved, and every original A target and conversation stays intact.

### Recover the complete Page state

Given a Page with several Versions, independent Blocks-field histories, archived alternatives, Version-scoped collaboration, and assets, when an authorized lossless export is restored, then stable Page and Version identities, current designation, bodies, access, histories, anchors, receipts, and authorized dependencies remain coherent.

## Current evidence

Content currently preserves whole-document snapshots and can restore earlier title/body state. Those snapshots are useful recovery donor machinery, not named Versions: they do not prove stable alternative identities, parallel bodies, Version-specific access, a revision graph, in-place selective merge, promotion, or Version-aware collaboration. This Capability remains `approved_shape`.

## Proof plan

1. Create, rename, edit, compare, merge, promote, archive, restore, and address named Versions through both the interface and shared Actions.
2. Verify Page-shared title, Properties, memberships, source identity, access ceiling, and Discussion while independently editing Version bodies and Blocks-field histories.
3. Exercise additions, deletions, moves, structured Blocks, partial review, all-visible review, retries, stale bases, incompatible dependencies, concurrent promotion, and persistence failure.
4. Verify Discussion, Comments, Annotations, receipts, carry-forward, orphan recovery, and exact Version/Revision links across ordinary edits and promotion.
5. Run the complete access matrix through direct reads, search, Queries, counts, notifications, references, embeds, agents, comparisons, publication, and exports.
6. Round-trip a lossless archive and verify stable identity, current state, access, histories, collaboration, provenance, and authorized assets.
7. Complete the Feature workflow through the real Page UI with keyboard and assistive technology, not only schema or Action tests.

## Open questions

- A named Version's exact payload still needs one decision: the primary body only, every Page-owned Blocks field, or an explicitly selected set. Whatever is chosen must not overload Versions to represent separate media/source formats.
- Branch-from rules, ancestry representation, naming collisions, rename behavior, and whether merge creates a distinct graph node remain open.
- Dependency behavior for partially accepting structurally dependent changes needs a precise oracle.
- Concurrent promotion and archiving/restoring the current Version need atomic rules.
- The exact portable Markdown/MDX representation of several named Versions and per-field histories remains open even though the lossless archive obligation is settled.
- Version-specific role grammar, carry-forward authority, anchor relocation thresholds, and the detailed filter/re-anchor controls remain product decisions.
