---
record_type: "capability"
spec_version: 2
id: "content.knowledge.related"
name: "Related work"
user_promise: "A small, current set of related Pages and records beside the one you're reading, so people can move through a workspace without maintaining a hierarchy by hand"
primary_user_job: "Find the few current things related to what I'm reading without knowing where anyone filed them."
kind: "surface"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.knowledge.search",
    "content.knowledge.links",
    "content.relationship.edge",
    "content.access.visibility-closure",
  ]
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "Related work derives a short, diverse, access-scoped list of current related objects from declared links and Relationships plus search similarity and freshness, says why each appears, and never turns a suggestion into a Relationship."
proof_requirements:
  [
    "Access closure for candidates, explanations, counts, and ordering, including inaccessible intermediate objects",
    "Diversity, freshness, and explanation behavior over near-duplicate, stale, and sparsely linked fixtures",
    "Same result for the UI and agents through one Action, with reload, empty, and failure states",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-11-08"
---

# Related work

## Why this exists

A workspace grows faster than anyone can file it. Folders and links only help when someone has already put them in place. People still need a dependable next step from the Page in front of them, toward the few current things that bear on it, without first deciding where everything belongs.

## Example workflow

A product manager opens a launch brief that nobody has linked to anything. Beside it, Content suggests five related items: the pricing decision the brief mentions, last week's customer research notes, the launch checklist Collection, a design spec similar in content, and a newer revision of an older brief. Each says why it appears. Two near-identical copies of the research notes show up as one entry. The manager opens the research notes, then turns one suggestion into a typed Relationship on purpose.

## Product contract

- Related work is a derived, read-only list for one open object. It holds a small number of items, not an endless feed.
- Candidates come from declared connections (links, backlinks, typed Relationships, shared Collection membership) and from observed ones: content similarity from the search index and the viewer's recent work. Freshness prefers recently changed and recently opened items the same way Search does.
- The list stays diverse. Near-copies and several versions of one thing don't crowd out other useful items.
- Each item says why it appears, such as "linked from this Page", "in the same Collection", or "similar content", using only facts the viewer may read.
- A suggestion is visibly different from a declared Relationship or backlink and never becomes one by being shown, clicked, or dismissed. Making it a Relationship is a separate, deliberate edit through `content.relationship.edge`.
- Access closure applies before ranking: an object the viewer can't read never appears, never counts, and never shapes the list as an unseen bridge between two readable ones.
- People and agents receive the same list for the same object and viewer through one Action.

## Boundaries and non-goals

- Links own declared references and Info → Connections. Relationships own typed edges. Graph queries own traversal. Search owns the index, the semantic lane, and freshness signals; this Capability reuses them rather than keeping its own.
- This is not automatic Relationship inference, a social activity feed, a recommendation system across organizations, or a second index.
- It does not move, file, or tag anything, and it does not replace Pages, Collections, or the sidebar as the structure people choose.

## Acceptance stories

### Suggest without asserting

Given a Page with no links that shares a topic with a design spec, when a viewer opens it, then the spec appears as "similar content", the Page's Connections stay empty, and no Relationship exists until the viewer creates one deliberately.

### Leave out an inaccessible neighbor

Given Page A and Page C are each linked only through Page B, which the viewer can't read, when the viewer opens A, then C is not suggested on the strength of that path, and nothing in the list, its count, or its explanations reveals that B exists.

### Keep near-copies from crowding the list

Given three nearly identical copies of a research note and several other related Pages, when the list is built, then the copies take at most one place and the remaining places go to different items.

## Current evidence

No Content surface computes related work today. Backlinks, typed Relationships, Collection membership, and the lexical search index are partial substrate; the semantic lane and recorded opens it would draw on are planned in Search but not built. This Capability remains `exploring`.

## Proof plan

1. Build fixtures with linked, unlinked, near-duplicate, stale, and access-restricted objects; test candidate selection, diversity, freshness, and explanations.
2. Verify closure through inaccessible bridges, revoked access, deleted targets, and agent requests.
3. Compare the UI and Action results for the same object and viewer, then exercise reload, empty, slow, and failed states with keyboard and assistive-technology paths.

## Open questions

- Where the list appears first (the Info rail beside Connections, the end of a Page, or the command menu) needs design.
- How many items it shows, and how declared and observed signals weigh against each other, should be set by an eval rather than chosen in advance.
- Whether Collections and rows get related work, or only Pages at first, is undecided.
