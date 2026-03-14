# Placeholder Templates

Template content for each seed file type. The `/content-seed` orchestrator skill uses these templates when creating placeholder files. Each template includes format rules, examples, and tips.

## urls.txt

```
# Seed URLs -- one per line
# The pipeline will fetch and analyze these during research
#
# Supported: blog posts, documentation, dev.to articles, tech blogs
# Partial:   X/Twitter (better to paste as .md), YouTube (needs transcript tool)
# Blocked:   Reddit (paste as .md instead)
#
# Example:
# https://react.dev/reference/rsc/server-components
# https://vercel.com/blog/understanding-react-server-components
```

## keywords.txt

```
# Seed Keywords -- one per line
# These will be merged with Ahrefs keyword research
# Ahrefs metrics (volume, difficulty) will be fetched for each keyword
#
# Tip: Paste your SurferSEO keyword list here, one keyword per line
#
# Example:
# react server components
# rsc nextjs
# server components vs client components
```

## notes.md

```markdown
# Seed Notes

Write observations, angles, and insights about this topic.
These notes will be used as high-priority context during research.

## Key observations

## Unique angle or perspective

## Target audience pain points

## Things to make sure we cover
```

## article.md

Template for pasting a full article (X thread, blog post, AI-generated draft, etc.):

```markdown
# [Article Title]

**Source:** [URL or "X/Twitter" or "Pasted from..."]
**Author:** [Author name if known]
**Date:** [Publication date if known]

---

[Paste the full article text below this line]
```

## serp-intents.txt

```
# SERP Intent Clusters -- paste from Ahrefs "Identify intents" button
# This data enriches Phase 3 SERP analysis with clustered intent groups
#
# Format: paste the raw output from Ahrefs exactly as shown.
# Each intent group has: name, description, percentage, then URL entries
# (title, URL, position number). Groups are separated by blank lines.
#
# Example:
# Understanding React Server Components
# Users are seeking tutorials and documentation about RSC implementation
# 62%
# React Server Components Guide
# https://react.dev/reference/rsc/server-components
# 1
# How to Use Server Components in Next.js
# https://vercel.com/blog/server-components
# 3
#
# Official React Resources
# Users looking for the official React documentation and project pages
# 25%
# React
# https://react.dev/
# 2
```

## Usage Notes

- The `/content-seed` orchestrator skill offers these as options via AskUserQuestion (multiSelect)
- Users can add any additional `.md` or `.txt` files beyond the placeholders
- The article.md template can be duplicated with different names (e.g., `x-thread-rsc.md`, `airops-draft.md`)
- Placeholder content is instructional only -- it does not affect pipeline behavior. Empty files (containing only comments or placeholder headers) are treated as "no seed content" for that file type.
