# Delta Thresholds

Threshold tables used by the Content Refresh Analysis skill to determine refresh scope. Each signal is evaluated independently, and the overall scope is the highest triggered level.

## Scope Decision Matrix

| Signal                         | Metadata-Only   | Selective Rewrite      | Full Rewrite                        |
| ------------------------------ | --------------- | ---------------------- | ----------------------------------- |
| Sections needing rewrite       | 0               | 1-40% of sections      | >40% of sections                    |
| New competitor sections to add | 0               | 1-2                    | 3+                                  |
| SERP intent shift              | None            | Minor (same category)  | Major (informational to commercial) |
| Primary keyword ranking change | Still in top 10 | Dropped 5-15 positions | Dropped 15+ or out of top 50        |
| Framework/API version outdated | None            | 1-2 sections affected  | Core premise outdated               |

## How to Apply

1. Evaluate each signal independently
2. Assign the scope level each signal triggers
3. The overall recommendation is the **highest triggered scope** across all signals
4. If exactly on a boundary (e.g., 40% sections), round up to the higher scope

## Signal Evaluation Details

### Sections Needing Rewrite

Count sections where any of these are true:

- Code examples reference outdated API versions
- Competitor content covers the subtopic with significantly more depth
- Community feedback (HN, SO) contradicts the section's claims
- The section's answer-first block no longer matches current best practices

Divide rewrite-needed sections by total sections. 0% = metadata-only, 1-40% = selective, >40% = full.

### New Competitor Sections

Sections that top-5 competitors cover but the original post does not. Only count sections that represent genuine content gaps (not minor subtopics).

### SERP Intent Shift

| Shift Type                     | Classification |
| ------------------------------ | -------------- |
| informational to informational | None           |
| informational to commercial    | Major          |
| commercial to informational    | Major          |
| informational to navigational  | Major          |
| Same category, different angle | Minor          |

### Primary Keyword Ranking Change

If Ahrefs data is unavailable, estimate from SERP position check via WebSearch. A post that no longer appears in the first 5 pages of results is treated as "out of top 50."

### Framework/API Version

Check the post's code examples and technical claims against current documentation. A version bump that changes API surface (e.g., Next.js 14 to 15 with breaking changes) counts. A patch version bump does not.

## Override Rules

The user can override the recommended scope at Gate 1. Valid overrides:

- Force selective when tool recommends metadata-only (user wants to update specific sections)
- Force full when tool recommends selective (user wants a complete rewrite)
- Force metadata when tool recommends selective or full (user only wants SEO updates)

The override is stored in `refresh-scope.yaml` as `scope_override: true` with `original_recommendation` preserving the tool's suggestion.
