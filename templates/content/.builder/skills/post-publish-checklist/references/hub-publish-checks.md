# Hub Publish Checks

Validation steps for hub pages during the post-publish checklist (Phase 10). Load this reference when `hub_slug` is present in `phases/01-topic-validation.yaml`. Consult [hub-linking](../../hub-linking/SKILL.md) for link direction rules and anchor text strategy.

## Prerequisites

- `hub_slug` and `page_type` (`pillar` or `cluster`) from `phases/01-topic-validation.yaml`
- `output/hubs/<hub_slug>/hub.yaml` exists and is readable
- Reverse link patches in `phases/08-seo-reverse-links.yaml` (if generated at Phase 8)

## Hub Link Verification (extends Step 9)

After the standard reverse internal linking audit, run these hub-specific checks. Each check targets a link direction from the [hub-linking](../../hub-linking/SKILL.md) skill.

### Check 1: Pillar ↔ Cluster Bidirectional Links

Read `hub.yaml` `links:` section. For each link where `from == current_page_slug` or `to == current_page_slug`:

| Page Type   | Verify                                                                                  | Severity if Missing                                     |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Pillar**  | Contains an outbound link to every cluster page that has `status: in-progress` or later | **Critical** -- pillar must link to all active clusters |
| **Cluster** | Contains exactly 1 link to the pillar page                                              | **Critical** -- every cluster must link to pillar       |
| **Cluster** | Pillar backlink is within the first 2-3 paragraphs (introduction)                       | **Important** -- placement matters for SEO signal       |

**Process:**

1. Scan `post.md` for each expected outbound hub link URL (`https://www.builder.io/blog/<target-slug>`)
2. If found, record as verified
3. If missing, flag with severity and the planned anchor text from `hub.yaml`

### Check 2: Cluster ↔ Cluster Sibling Links

For cluster pages, check planned sibling links from `hub.yaml`.

| Timing                         | Check                                                                  | Action                                     |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------ |
| **During sequential creation** | Sibling links with `status: planned` to not-yet-published clusters     | Skip -- these are deferred to finalization |
| **During sequential creation** | Sibling links with `status: implemented` to already-published clusters | Verify the link exists in `post.md`        |
| **During finalization**        | ALL planned sibling links                                              | Verify every planned sibling link exists   |

**Severity:** Missing sibling links during finalization are **Important** (not Critical). The pillar ↔ cluster links are the structural backbone; sibling links are enhancement.

### Check 3: Reverse Link Patches Applied

If `phases/08-seo-reverse-links.yaml` contains reverse link patches:

1. For each patch targeting the pillar's `post.md`, verify the link was inserted (search for the `target_url` in the pillar's `post.md`)
2. If the patch was applied by the `/content-hub` orchestrator skill, the link should exist
3. If the patch was NOT applied, flag as **Important**: "Reverse link to [target] not yet applied to pillar"

## Hub.yaml Status Updates (extends Step 13)

After all verification checks pass, update `hub.yaml` with the current page's results.

### Page Status Update

Set the current page's status in `hub.yaml`:

| Page Type | Field Path              | New Value   |
| --------- | ----------------------- | ----------- |
| Pillar    | `pillar.status`         | `published` |
| Cluster   | `clusters[slug].status` | `published` |

### Link Status Update

For all links in `hub.yaml` involving the current page:

1. Links where `from == current_page_slug` AND the link was verified to exist in `post.md`: set `status: verified`
2. Links where `to == current_page_slug` AND the source page is already published AND the link was verified to exist in the source page: set `status: verified`
3. Leave other link statuses unchanged (`planned` or `implemented`)

### Hub-Level Fields Update

| Field                   | Update                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ahrefs_units_consumed` | Add this page's Ahrefs unit consumption (from phase files) to the running total                                                            |
| `current_page_index`    | Advance to the next page in the publishing queue                                                                                           |
| `status`                | Set to `in-progress` if pages remain; `published` if all non-skipped pages are `published`; `partial` if any page is `failed` or `skipped` |
| `links.last_updated`    | Set to today's date                                                                                                                        |

### Hub Status Determination Logic

```
if ALL non-skipped pages have status == published:
  hub.status = "published"
elif ANY page has status == failed OR status == skipped:
  hub.status = "partial"
else:
  hub.status = "in-progress"
```

## Schema Markup Verification (extends Step 7)

| Page Type      | Expected Schema               | Additional Check                                       |
| -------------- | ----------------------------- | ------------------------------------------------------ |
| **Pillar**     | `Article` (NOT `BlogPosting`) | Must include `hasPart` array listing cluster page URLs |
| **Cluster**    | `BlogPosting`                 | Must include `isPartOf` pointing to pillar page URL    |
| **Standalone** | `BlogPosting`                 | No hub-related schema checks                           |

**Severity:** Wrong schema type for pillar pages is **Critical**. Missing `hasPart` or `isPartOf` is **Important**.

## Metadata.yaml Hub Fields (extends Step 12)

When assembling `metadata.yaml` for a hub page, add these fields:

```yaml
# Hub context (only present when hub_slug is set)
hub_slug: "claude-code"
page_type: pillar # pillar | cluster
hub_status: in-progress # hub-level status after this page
hub_links_verified: 8 # count of links involving this page now verified
hub_links_total: 12 # total links involving this page in hub.yaml
```

## Examples

### Example 1: Cluster Page Passes Hub Checks

**Input:** Cluster page `claude-code-vs-cursor` within hub `claude-code`.

**Hub link verification:**

```yaml
hub_link_checks:
  pillar_backlink:
    found: true
    location: paragraph_2 # Within first 2-3 paragraphs
    anchor_text: "complete guide to Claude Code"
    status: verified
  sibling_links:
    - to: claude-code-beginners
      status: implemented # Already published, link verified
      found: true
    - to: claude-code-tips
      status: planned # Not yet published, deferred
      skipped: true
  reverse_link_patches:
    - target: pillar
      applied: true
      verified: true
```

**hub.yaml updates:**

```yaml
# Page status
clusters[claude-code-vs-cursor].status: published

# Link statuses
links[from=claude-code-vs-cursor, to=pillar].status: verified
links[from=claude-code-vs-cursor, to=claude-code-beginners].status: verified
links[from=pillar, to=claude-code-vs-cursor].status: verified # Reverse patch was applied

# Hub-level
current_page_index: 3 # Advanced
ahrefs_units_consumed: 8200 # Running total
```

### Example 2: Pillar Page Missing Cluster Link

**Input:** Pillar page for hub `react-hooks`, 6 cluster pages planned.

**Hub link verification (excerpt):**

```yaml
hub_link_checks:
  cluster_links:
    - to: use-state-guide
      found: true
      status: verified
    - to: use-effect-guide
      found: true
      status: verified
    - to: custom-hooks
      found: false # MISSING
      status: implemented # Was implemented at Phase 8 but link is gone
      issue:
        severity: critical
        message: "Pillar page missing link to cluster 'custom-hooks'. Expected URL: /blog/custom-hooks. Planned anchor: 'building custom hooks'"
```

**Result:** `checklist_pass: false` (1 critical issue). The pillar-to-cluster link must be restored before publishing.
