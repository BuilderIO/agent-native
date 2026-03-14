---
name: seed-research
description: "This skill should be used when a pipeline orchestrator skill detects a seed/ subfolder in the output folder. It covers seed content detection, file validation, ingestion for each file type, merge strategy with automated research, source attribution, and handling of blocked URLs, empty files, and edge cases."
---

# Seed Research

Detect, validate, and ingest user-provided research from the `seed/` subfolder in a post's output folder. Seed content supplements automated research -- it never replaces it. The pipeline runs full automated research alongside seed content and merges both into the synthesis.

## When to Use This Skill

- A pipeline orchestrator skill (`/content-blog`, `/content-research`, `/content-lfg`) detects a `seed/` subfolder in the output folder
- The Content Strategist agent runs Phase 1 (Topic Validation) and needs to report seed content presence
- The SEO Researcher agent runs Phase 2 (Keyword Research) and needs to merge seed keywords
- The Content Researcher agent runs Phase 4 (Content Research) and needs to ingest seed URLs, articles, and notes

## Process

### Step 1: Detect Seed Folder

Check for a `seed/` subfolder in the post output folder:

```
output/posts/YYYY-MM-DD-<slug>/seed/
```

**If `seed/` does not exist:** No seed content. Skip all remaining steps. Proceed with standard automated pipeline.

**If `seed/` exists:** Continue to Step 2.

### Step 2: Inventory Seed Files

List all files in the `seed/` folder. Classify each file:

| File | Type | Special Handling |
|------|------|-----------------|
| `urls.txt` | URL list | Fetch during Phase 4 content research |
| `keywords.txt` | Keyword list | Merge during Phase 2 keyword research |
| `notes.md` | Author notes | Use as "author perspective" in synthesis |
| `serp-intents.txt` | SERP intent clusters | Merge during Phase 3 SERP analysis |
| Any other `.md` file | Research source | Parse as article/content during Phase 4 |
| Any other `.txt` file | Research source | Parse as plain text during Phase 4 |

### Step 3: Validate Seed Files

Apply validation rules per file type. Skip files that fail validation with a warning -- do not fail the pipeline.

**urls.txt validation:**
- One URL per line
- Must match `https?://` pattern (skip lines that do not)
- Skip blank lines and lines starting with `#` (comments)
- Warn on known-blocked domains: `reddit.com` ("Paste as .md instead"), `youtube.com` without transcript tool ("Needs transcript tool -- consider pasting transcript as .md")
- Maximum 50 URLs. If exceeded, warn: "Seed urls.txt has N URLs (max 50). Using first 50."

**keywords.txt validation:**
- One keyword per line
- Plain text only. If commas detected in lines, warn: "keywords.txt appears to contain CSV. Expected one keyword per line."
- Skip blank lines and lines starting with `#` (comments)
- Maximum 200 keywords. If exceeded, warn: "Seed keywords.txt has N keywords (max 200). Using first 200."

**Markdown files (.md) validation:**
- UTF-8 encoding
- Maximum 5MB per file
- Maximum 20 `.md` files total (excluding notes.md). If exceeded, warn: "Seed folder has N markdown files (max 20). Using first 20."

**Empty file handling:** If a file contains only comments, blank lines, or placeholder headers (lines starting with `#` or `[`), treat as empty. A seed folder where ALL files are empty produces the log message: "Seed folder detected but empty, proceeding with automated research only."

### Step 4: Build Seed Summary

Produce a structured summary for downstream phases:

```yaml
seed_detected: true
seed_summary:
  url_count: 5
  keyword_count: 15
  article_count: 2
  has_notes: true
  total_files: 5
  validation_warnings:
    - "1 Reddit URL in urls.txt -- will be skipped (blocked source)"
  empty: false
```

Report to the user: "Detected seed folder: N URLs, N keywords, N articles, notes: yes/no"

### Step 5: Ingest for Phase 2 (Keyword Research)

**Trigger:** SEO Researcher agent running Phase 2 with `seed_detected: true`.

1. Read `seed/keywords.txt`
2. Parse valid keywords (one per line, skip comments and blanks)
3. Pass seed keywords to the Keyword Research skill as high-priority inputs
4. The skill queries Ahrefs for metrics on each seed keyword (volume, difficulty, traffic potential)
5. Merge: seed keywords marked `source: seed`, Ahrefs-discovered keywords marked `source: ahrefs`
6. De-duplicate by exact keyword match -- seed wins
7. Note in Phase 2 output: "Merged N seed keywords with M Ahrefs keywords"

**Ahrefs budget impact:** ~2-4 units per seed keyword for metrics lookup. A 50-keyword seed list adds ~100-200 units.

### Step 6: Ingest for Phase 4 (Content Research)

**Trigger:** Content Researcher agent running Phase 4 with `seed_detected: true`.

Run BEFORE automated research (Step 0.5 in the Content Research skill):

**6a: Fetch seed URLs**
1. Read `seed/urls.txt`
2. For each valid URL:
   - Skip known-blocked domains (reddit.com) with note: "Blocked source, check for .md paste in seed folder"
   - YouTube URLs: attempt transcript tool (MCP > npm > WebSearch metadata fallback)
   - All other URLs: WebFetch and extract key insights
   - Failed fetches: log error, continue (never fail pipeline on a single URL)
3. Tag each fetched source as `source_type: seed` in Phase 4 output

**6b: Parse seed articles**
1. Read all `.md` files in `seed/` (except `notes.md`)
2. For each file:
   - Extract title (first `#` heading or filename)
   - Extract source attribution (look for `**Source:**` line, fall back to filename)
   - Parse as research content
   - Weight as high-priority in synthesis matrix
3. Tag each as `source_type: seed` in Phase 4 output

**6c: Parse seed notes**
1. Read `seed/notes.md` if it exists and is not empty
2. Use as "author perspective" context during synthesis
3. Feed into unique value proposition formulation
4. Tag as `source_type: seed_notes` in Phase 4 output

**6d: Merge into synthesis**
1. Seed sources appear in the synthesis matrix as "Seed: [filename]" columns
2. Content gaps analysis considers what seed content already covers
3. Unique value proposition informed by seed notes
4. Note in Phase 4 output: "Ingested N seed URLs + M seed articles + notes"

### Step 7: De-duplication

When automated research discovers a URL that was already fetched from seed:

1. Match by normalized URL (strip trailing slash, `www.` prefix, and query parameters)
2. Skip the automated fetch -- seed version already captured
3. Use the seed version in synthesis (seed wins on duplicates)

## Design Decisions

1. **AI drafts are research, not drafts.** Files like `airops-draft.md` or `surfer-draft.md` are treated as research sources, not starting drafts for Phase 6. The Blog Writer agent always writes fresh in the target voice. AI drafts inform structure and coverage but the voice is always original.

2. **Read-once at Phase 1.** Seed content is read and validated at pipeline start. Mid-execution edits to seed files are not re-ingested. This avoids race conditions and ensures consistent state across phases.

3. **Seed keywords get Ahrefs metrics.** Phase 2 queries Ahrefs for seed keywords to get volume/difficulty scores. This counts toward the ~2k unit budget. Keywords without metrics cannot be properly prioritized.

4. **De-duplication: seed wins.** If the same URL appears in seed and automated research, the seed version takes priority. The user explicitly curated it.

5. **Trending mode respects seed.** Seed URLs and keywords are ingested even in trending mode, regardless of which automated sources are skipped. The user already has the data.

6. **Empty files equal no seed.** If all seed files are empty (only comments/headers), log "Seed folder detected but empty" and proceed with automated research only.

## Output Schema Additions

Seed content adds these fields to existing phase YAML files:

**In `phases/01-topic-validation.yaml`:**
```yaml
seed_detected: true
seed_summary:
  url_count: 5
  keyword_count: 15
  article_count: 2
  has_notes: true
  total_files: 5
  validation_warnings: []
  empty: false
```

**In `phases/02-keyword-research.yaml`:**
```yaml
seed_keywords_merged: 15
seed_keywords_with_metrics: 12
seed_keywords_unscored: 3  # no Ahrefs data found
```

**In `phases/04-content-research.yaml`:**
```yaml
seed_sources:
  urls_fetched: 4
  urls_failed: 1
  urls_blocked: 1
  articles_parsed: 2
  notes_ingested: true
```

## Examples

### Example 1: Full Seed Folder

**Seed folder contents:**
```
seed/
├── urls.txt          # 5 URLs (1 Reddit, 4 blog posts)
├── keywords.txt      # 15 keywords from SurferSEO
├── notes.md          # Author's observations and angle
├── x-thread.md       # Pasted X/Twitter thread
└── airops-draft.md   # AI-generated draft from AirOps
```

**Validation output:**
- urls.txt: 5 URLs (1 warning: reddit.com blocked, using 4)
- keywords.txt: 15 keywords (valid)
- notes.md: has content
- 2 additional .md files (x-thread.md, airops-draft.md)

**Phase 1 summary:** "Detected seed folder: 4 fetchable URLs (1 blocked), 15 keywords, 2 articles, notes: yes"

**Phase 2 merge:** 15 seed keywords merged with 22 Ahrefs keywords = 33 unique keywords (4 duplicates removed, seed wins)

**Phase 4 ingestion:** 4 URLs fetched (1 failed: 404), 2 .md articles parsed, notes ingested as author perspective. Full automated research runs on top. Synthesis matrix includes "Seed: x-thread.md" and "Seed: airops-draft.md" columns alongside HN, X, YouTube, etc.

### Example 2: Keywords-Only Seed

**Seed folder contents:**
```
seed/
└── keywords.txt      # 30 keywords from SurferSEO
```

**Phase 1 summary:** "Detected seed folder: 0 URLs, 30 keywords, 0 articles, notes: no"

**Phase 2 merge:** 30 seed keywords merged with Ahrefs results. Seed keywords get Ahrefs metrics. 8 duplicates found -- seed versions kept.

**Phase 4:** No seed URLs or articles. Full automated research runs as normal.

### Example 3: Empty Seed Folder

**Seed folder contents:**
```
seed/
├── urls.txt          # Only comment lines (# Add URLs here...)
├── keywords.txt      # Empty file
└── notes.md          # Only placeholder headers
```

**Phase 1 summary:** "Seed folder detected but empty, proceeding with automated research only."

**Phase 2 and 4:** Standard automated pipeline. No seed merge.

## Guidelines

- Seed content is a supplement, never a replacement. Full automated research always runs.
- Never fail the pipeline due to seed content issues. Validate, warn, skip problematic items, and continue.
- Source attribution matters. Tag every seed source so downstream phases and the final metadata can trace which insights came from seed vs automated research.
- Respect the user's curation. Seed sources get high-priority weighting in synthesis because the user explicitly chose them.
- See [placeholder-templates.md](./references/placeholder-templates.md) for the template content used by the `/content-seed` orchestrator skill when creating placeholder files.
