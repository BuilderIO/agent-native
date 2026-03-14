---
name: content-seed
description: "Creates a seed research folder with placeholder files for user-provided resources. Use when the user has existing materials (articles, URLs, docs, videos) they want to incorporate into research."
---

# Seed Research Setup

Create a seed research folder where pre-existing resources can be placed before running the automated pipeline. Drop blog posts, X/Twitter threads, keyword lists, AI-generated drafts, and notes into the folder, then run `/content-research` or `/content-blog` to merge them with automated research.

## Arguments

<args> $ARGUMENTS </args>

### Argument Disambiguation

```
IF args resolve to an existing directory on disk:
    IF directory contains hub-context.yaml:
        → Hub mode. Create seed/ inside that folder. Skip slug generation.
    ELSE:
        → Pre-existing output folder. Create seed/ inside it.
ELSE IF args are empty:
    → Ask the user for a topic
ELSE:
    → Standalone mode. Treat args as a topic string.
```

**Directory check:** Use filesystem existence check. Do NOT use a `/` heuristic.

**If args are empty, ask the user:** "What topic do you want to seed research for? Describe the subject."

Do not proceed until you have a topic or a valid folder path from the user.

## Folder Setup

### Hub Mode

When pointed at a hub page folder (contains `hub-context.yaml`):

1. Use the existing folder as the target -- do not create a new folder or generate a slug
2. Announce: "Hub page folder detected. Creating seed/ inside [folder path]."
3. Skip directly to Step 2 (existing folder check) using the hub page folder path

### Step 1: Generate Topic Slug (Standalone Only)

Apply the same slug rules as `/content-blog`:
- Lowercase, replace spaces with hyphens, remove special characters
- Max 50 characters
- Date prefix: today's date (YYYY-MM-DD format)

Result: `output/posts/YYYY-MM-DD-<slug>/`

### Step 2: Check for Existing Folder

Scan for a matching folder (standalone: `output/posts/`, hub mode: the provided folder):

**If `output/posts/*-<slug>/seed/` already exists:**

Stop with message:
```
Seed folder already exists at output/posts/[path]/seed/

To add more files, place them directly in the seed folder.
To start fresh, delete the seed/ subfolder and re-run this command.
```

**If `output/posts/*-<slug>/` exists WITHOUT a `seed/` subfolder:**

Create `seed/` inside the existing folder. This is resume-compatible -- the user may have already run `/content-research` and wants to add seed content before continuing.

Announce: "Found existing output folder. Creating seed/ subfolder inside it."

**If no matching folder exists:**

Create the full path: `output/posts/YYYY-MM-DD-<slug>/seed/`

Also create the `phases/` subdirectory for pipeline compatibility.

### Step 3: Select Placeholder Files

Use **AskUserQuestion** to ask which placeholder files to create:

**Question:** "Which seed files should I create? Select all that apply."

**Options (multiSelect: true):**
1. **urls.txt** -- "URLs to blog posts, docs, articles to fetch during research"
2. **keywords.txt** -- "Keyword list from SurferSEO or manual research"
3. **serp-intents.txt** -- "SERP intent clusters from Ahrefs 'Identify intents' button"
4. **notes.md** -- "Personal notes, observations, angles, things to cover"
5. **article.md** -- "Template for pasting a full article (X thread, blog post, AI draft)"

### Step 4: Create Selected Files

For each selected file, write the placeholder content from the Seed Research skill's [placeholder-templates.md](.builder/skills/seed-research/references/placeholder-templates.md).

Use Bash `mkdir -p` for the seed directory, then Write tool for each file.

### Step 5: Confirmation

Display the result:

```
Seed folder ready at output/posts/YYYY-MM-DD-<slug>/seed/

Created files:
- seed/urls.txt (add one URL per line)
- seed/keywords.txt (add one keyword per line)
- seed/notes.md (add your observations)
- seed/article.md (paste a full article)

Next steps:
1. Fill the files above with your research
2. Add any additional .md files (more articles, AI drafts, etc.)
3. Run /content-research or /content-blog to start the pipeline

Tip: For X/Twitter posts or Reddit threads you can't link to,
paste the full text as a .md file in the seed folder.
```

Adjust the file list based on what was actually created.

## Error Handling

### Output Directory Missing

If `output/` or `output/posts/` does not exist, create it. The `/content-seed` orchestrator skill may be the first command a user runs.

### Permission Errors

If folder creation fails due to permissions, display the error and suggest checking file system permissions.

## Important Notes

- This command only creates the folder and placeholder files. It does not run any pipeline phases.
- Users fill the seed files at their own pace -- there is no time pressure.
- The pipeline detects seed content automatically when `/content-blog`, `/content-research`, or `/content-lfg` runs.
- Additional `.md` files can be added beyond the placeholders. The pipeline reads all `.md` and `.txt` files in the seed folder.
- The `article.md` template can be duplicated with different names (e.g., `x-thread-rsc.md`, `competitor-analysis.md`, `airops-draft.md`).
- **Hub mode:** When pointed at a hub page folder, creates `seed/` inside that folder without slug generation. The hub-context.yaml file is not modified.
