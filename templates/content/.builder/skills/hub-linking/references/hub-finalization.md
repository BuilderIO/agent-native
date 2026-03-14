# Hub Finalization Process

Detailed process for `/content-hub --finalize`. The hub orchestrator skill orchestrates these steps; this reference provides the implementation details.

## Prerequisites

- `hub.yaml` exists at `output/hubs/<hub_slug>/hub.yaml` (created by hub-planning skill)
- At least some pages have reached `published` status
- The hub-linking skill's Step 5 defines the link injection rules

## Step 1: Pre-Flight Status Check

Read `hub.yaml` and assess page completion:

1. Count pages by status: `published`, `in-progress`, `planned`, `failed`, `skipped`
2. If zero pages are `published`: Warn "No pages are published yet. Finalization requires at least the pillar page to be published."
3. If unpublished pages exist: Warn "N pages have not reached published status: [list]. Finalize with current pages?"

Present options via AskUserQuestion:

- **Proceed** -- Finalize with published pages, skip incomplete ones
- **Stop** -- Return to complete remaining pages first

## Step 2: Cluster-to-Cluster Link Injection

For each planned cluster ↔ cluster link in `hub.yaml` where `status: planned`:

1. Read the source cluster's `post.md`
2. Find the appropriate body section (matching the target cluster's topic area)
3. Generate contextual anchor text following the hub-linking skill's anchor text strategy (50% primary keyword, 30% semantic variation, 20% natural phrase)
4. Insert the link as a markdown inline link: `[anchor text](https://www.builder.io/blog/target-slug)`
5. If the anchor text doesn't fit naturally, add a brief contextual sentence carrying the link
6. Write the modified `post.md` back
7. Update `hub.yaml` link status from `planned` to `implemented`

**If a link cannot be inserted** (no natural placement found):

- Flag with location context: "Could not find natural placement for link from [source] to [target]"
- Suggest alternatives to user (different section, different anchor text)
- Continue -- do not block finalization on a single link

## Step 3: Final Link Validation Sweep

For each link in `hub.yaml` regardless of current status:

1. Read the source page's `post.md`
2. Search for the target URL (e.g., `https://www.builder.io/blog/target-slug`)
3. If found: update status to `verified`
4. If missing: flag as error -- "Link from [source] to [target] not found in post.md"

**Orphan detection:**

- A page is orphaned if it has zero inbound hub links
- Every cluster must have at least 1 inbound link from the pillar (error if missing)
- Every cluster should have at least 1 inbound sibling link (warning if missing)
- The pillar must have at least 1 inbound link from every published cluster (warning if missing)

**Reverse link patch check:**

If reverse link patches from cluster creation were not applied (pillar missing links to some clusters), flag: "Pillar is missing links to clusters: [list]. These may need manual insertion."

## Step 4: Pillar Page Re-Validation

Re-run the post-publish-checklist on the pillar page only:

1. Read the pillar's `post.md` (modified by reverse link patches during cluster creation)
2. Run the 13-step checklist
3. Focus on: link count validation (pillar should link to all published clusters), schema markup (`hasPart` should list all published cluster URLs), word count (may have increased from added link sentences)
4. Update `phases/10-post-publish-checklist.yaml` in the pillar folder

## Step 5: Hub Status Finalization

Update `hub.yaml`:

1. **Hub status:**
   - If all non-skipped pages are `published`: set `status: published`
   - If any pages are `failed` or `skipped`: set `status: partial`
2. Set `links.last_updated` to today's date
3. Record final link counts:
   ```yaml
   link_summary:
     total: N
     verified: N
     implemented: N
     planned: N  # Should be 0 after finalization
     errors: N
   ```

## Step 6: Post-Finalization Recommendations

After finalization completes, present:

1. **Hub summary** (status, page counts, link counts)
2. **Cross-hub style audit recommendation:** "Voice drift increases when pages are written in separate sessions. Consider reviewing all hub pages for voice consistency. Areas to check: opening style, paragraph length, code example density, terminology consistency."
3. **Next steps options:**
   - Capture learnings -- Run `/content-compound` on the hub
   - Style audit -- Review all pages for voice consistency
   - View hub -- Open `hub.yaml` for the final blueprint
   - Done -- End

## Resume Support

If finalization is interrupted:

- Link statuses in `hub.yaml` are the source of truth
- On resume, scan for `status: planned` links to identify incomplete injections
- Skip links already `implemented` or `verified`
- Re-run validation sweep on all links (validation is idempotent)
