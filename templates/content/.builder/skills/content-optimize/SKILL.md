---
name: content-optimize
description: "Runs SEO optimization, AEO optimization, and publish readiness checks on a drafted post. Use when the user mentions SEO, search optimization, meta descriptions, or preparing a post for publishing."
---

# Optimize Pipeline

Apply SEO optimization, AEO optimization, and the post-publish checklist to an edited draft. Runs Phases 8-10 with no approval gates. Picks up where `/content-write` left off.

## Input

<folder> $ARGUMENTS </folder>

**If the folder above is empty:** Scan `output/posts/` for folders eligible for optimization. A folder is eligible if:

- **Blog mode:** phases 01-07 complete, missing phase 08
- **Refresh mode:** `refresh-scope.yaml` present, missing phase 08

List eligible folders using **AskUserQuestion**:

**Question:** "Which post folder do you want to optimize?"

**Options:** List each eligible folder path as an option (up to 4), noting mode (blog/refresh) for each. If none found, announce: "No eligible post folders found. Run `/content-write` or `/content-refresh-write` first to produce an edited draft."

Do not proceed until a valid folder is selected.

## Mode Detection

Check for `refresh-scope.yaml` in the output folder.

- **If found:** Refresh mode. Read `scope` from `refresh-scope.yaml`.
- **If not found:** Blog mode. Use standard validation.

## Validation

### Blog Mode (no `refresh-scope.yaml`)

Check that the selected folder contains the required artifacts:

1. `phases/01-topic-validation.yaml` -- must exist
2. `phases/02-keyword-research.yaml` -- must exist
3. `phases/03-serp-analysis.yaml` -- must exist (or contain `skipped: true` for trending)
4. `phases/04-content-research.yaml` -- must exist
5. `phases/05-outline-creation.yaml` -- must exist
6. `phases/05.5-content-spec-analysis.yaml` -- should exist (warn if missing, do not block)
7. `phases/06-blog-drafting.yaml` -- must exist
8. `phases/07-content-editing.yaml` -- must exist
9. `draft.md` -- must exist

**If any required file is missing:** Announce which files are missing and suggest running the appropriate earlier command (`/content-research` or `/content-write`). Do not proceed.

### Refresh Mode (selective or full scope)

1. `phases/00-original-post-analysis.yaml` -- must exist
2. `phases/01-refresh-keyword-research.yaml` -- must exist
3. `phases/02-refresh-serp-analysis.yaml` -- must exist
4. `phases/03-delta-analysis.yaml` -- must exist
5. `phases/04-refresh-content-research.yaml` -- must exist
6. `phases/05-refresh-outline.yaml` -- must exist
7. `phases/05.5-refresh-content-spec-analysis.yaml` -- should exist (warn if missing, do not block)
8. `phases/06-refresh-drafting.yaml` -- must exist
9. `phases/07-content-editing.yaml` -- must exist
10. `draft.md` -- must exist
11. `refresh-scope.yaml` -- must exist

**If any required file is missing:** Announce which files are missing and suggest running `/content-refresh-write`. Do not proceed.

### Refresh Mode (metadata-only scope)

1. `phases/00-original-post-analysis.yaml` -- must exist
2. `phases/01-refresh-keyword-research.yaml` -- must exist
3. `phases/02-refresh-serp-analysis.yaml` -- must exist
4. `phases/03-delta-analysis.yaml` -- must exist
5. `post.md` -- must exist (no `draft.md` required)
6. `refresh-scope.yaml` -- must exist

**If any required file is missing:** Announce which files are missing and suggest running `/content-refresh-research`. Do not proceed.

**If `phases/08-seo-optimization.yaml` already exists:** Ask the user: "SEO optimization already exists in this folder. Overwrite it or stop?"

## Content Goal Routing

**Blog mode:** Read `content_goal` from `phases/01-topic-validation.yaml`.

**Refresh mode:** Read `content_goal` from `refresh-scope.yaml`. Fall back to `phases/00-original-post-analysis.yaml` if not present in `refresh-scope.yaml`.

Content goal behavior:

- **Awareness:** Internal links to Builder.io blog posts are fine (educational, SEO-helpful). No product links. Brand Radar records data only.
- **Acquisition:** Product links in internal linking. Brand Radar fills citation gaps with Builder.io examples.
- **Hybrid:** 1 internal link to Builder.io. Brand Radar refines CTA based on AI association data.

**Blog mode:** Read `content_timing` from `phases/01-topic-validation.yaml` for trending mode handling.

**Refresh mode:** Read `content_timing` from `phases/00-original-post-analysis.yaml` for trending mode handling.

---

## Phase 8: SEO Optimization

**Agent:** search-optimizer

Run the 12-step SEO optimization from the SEO Optimization skill:

1. Meta description (150-160 chars, includes primary keyword)
2. SEO title tag (50-60 chars)
3. URL slug
4. Keyword placement verification
5. Internal linking (content-goal-aware)
6. External linking (2-4 authoritative sources)
7. Schema markup (BlogPosting at minimum; FAQPage/HowTo if applicable)
8. E-E-A-T signals
9. Featured snippet optimization
10. Image alt text review
11. Search intent cross-check
12. Heading hierarchy validation

**Trending mode:** Accept absent SERP data. Skip competitive gap references. Focus on on-page fundamentals.

**Refresh mode (metadata-only):** This is the first phase that runs after Gate 1. Read the original `post.md` as the working file (no `draft.md` exists). Apply SEO re-optimization in place.

**Refresh mode (selective/full):** Same as blog mode -- creates `post.md` from `draft.md`. Additionally:

- Add `dateModified` to schema markup (today's date)
- Preserve the original `datePublished`
- Preserve the original slug

**Output:** `phases/08-seo-optimization.yaml` (creates `post.md` from `draft.md`, or updates `post.md` in place for metadata-only refresh)

---

## Phase 9: AEO Optimization

**Agent:** search-optimizer

Run the 9-step AEO optimization from the AEO Optimization skill:

1. Heading compliance audit (question-form H2/H3s from outline)
2. Answer-first block verification
3. Quote-ready block audit (concise, standalone answers)
4. Specificity enhancers (numbers, dates, versions)
5. Brand Radar check via Ahrefs (content-goal-aware; skip for awareness)
6. PAA (People Also Ask) coverage
7. Semantic keyword distribution
8. Word count final gate (competitive range or guidance range)
9. Final review pass

**Trending mode:** Full AEO optimization. Skip Brand Radar Ahrefs integration (no established citation data).

**Output:** `phases/09-aeo-optimization.yaml` (updated `post.md` in place)

**Important:** Phase 8 and Phase 9 run sequentially. Do not parallelize.

---

## Phase 10: Post-Publish Checklist

**Agent:** (no agent -- run the Post-Publish Checklist skill directly)

Run the 13-step final QA:

1. YAML frontmatter completeness
2. Meta description verification
3. Image alt text audit
4. Internal link count and validation
5. External link count and validation
6. CTA review
7. Schema markup validation
8. Word count confirmation (competitive range or guidance range)
9. E-E-A-T signal check
10. Reverse internal link suggestions
11. Repurposing hook identification
12. Assemble `metadata.yaml` from all phase files
13. Set `pipeline_status: complete`

**Trending mode:** Accept empty SERP-derived fields. Add `trending_followup` scheduling to `metadata.yaml`.

**Refresh mode:** Additionally:

- Verify original slug is preserved
- Add `dateModified` to metadata
- Update `metadata.yaml` with `refresh_history` entry (date, scope, sections rewritten/added, word count before/after, archive path)
- Set `pipeline_status: refresh-complete`

**Output:** `phases/10-post-publish-checklist.yaml` + `metadata.yaml`

---

## Pipeline Complete

When Phase 10 finishes, present the final summary:

**Blog mode:**

```
Blog post complete!

Topic: [topic]
Title: [selected title]
Content Goal: [awareness/acquisition/hybrid]
Word Count: [final count]
Status: [publish-ready / needs-fixes]

Output: [folder path]
├── post.md          <- Final blog post
├── metadata.yaml    <- Full metadata
├── draft.md         <- Pre-optimization draft
├── outline.md       <- Approved outline
├── research-notes.md <- Research artifacts
└── phases/          <- All phase artifacts (01-10)

Critical issues: [count]
Important issues: [count]
Minor issues: [count]
```

**Refresh mode:**

```
Content refresh complete!

Original: [title] ([original publish date])
Refreshed: [new title if changed] ([today's date])
Scope: [metadata-only / selective (N sections rewritten, M added) / full]
Word Count: [old] → [new]
Content Goal: [unchanged / changed from X to Y]
Slug: [preserved]

Archive: archive/post-pre-refresh-YYYY-MM-DD.md

Output: [folder path]/post.md

Critical issues: [count]
Important issues: [count]
```

**If `checklist_pass: false`:** List the critical issues that need manual fixes before publishing.

**If `checklist_pass: true`:** The post is ready to publish.

### Next Steps

Use **AskUserQuestion** to present options:

**Question:** "What would you like to do next?"

**Options:**

1. **Polish** -- Run `/content-polish` for section-by-section editorial refinement (recommended for posts >2,500 words)
2. **Capture learnings** -- Run `/content-compound` on this post to document what worked and what didn't
3. **View the post** -- Open `post.md` for review
4. **Done** -- End the pipeline

---

## Error Handling

### Ahrefs MCP Unavailable

If any Ahrefs MCP call fails during the pipeline:

1. Log the failure in the current phase's YAML output
2. Fall back to WebSearch-based research for that specific call
3. Note reduced data quality in the phase output
4. Continue the pipeline -- do not stop

### Phase Failure

If a phase produces an error or incomplete output:

1. Announce the failure to the user
2. Ask whether to retry the phase, skip it, or stop the pipeline
3. If skipped, write a stub YAML with `skipped: true` and `reason`

### Word Count Overflow

If the post exceeds the competitive median (or guidance range soft max for trending) by 50%+ after Phase 9:

1. The Post-Publish Checklist flags it
2. Suggest trimming specific sections (identify the longest non-essential sections)
3. Do not auto-trim without user approval

## Important Notes

- This command produces the same output folder structure as `/content-blog`, making it fully compatible with `/content-blog --resume` and `/content-compound`.
- In refresh mode, this command is also compatible with `/content-refresh --resume` and produces the same output as the monolithic refresh pipeline's Phases 8-10.
- No approval gates in this command -- the draft was already approved during `/content-write` or `/content-refresh-write` (Gate 3). SEO and AEO are technical optimization passes.
- The Search Optimizer agent runs SEO (Phase 8) and AEO (Phase 9) sequentially within two invocations -- do not parallelize these.
- Content goal routing drives linking strategy and Brand Radar scope across all three phases.
- In refresh mode, keyword data comes from `phases/01-refresh-keyword-research.yaml` (not `phases/02-keyword-research.yaml`).
