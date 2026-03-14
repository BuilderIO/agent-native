# Platform Research Guide

Platform-specific extraction techniques and access methods for each research source. Includes exact API calls, search queries, and what to extract from each platform.

## Hacker News

**Access:** Full access. Three methods available.

### Search for Threads (Algolia Search API)

```
WebFetch: https://hn.algolia.com/api/v1/search?query=<topic>&tags=story&hitsPerPage=10
```

Response includes: `hits[]` with `title`, `url`, `points`, `num_comments`, `objectID`, `created_at`.

Filter for quality: prioritize threads with `points > 50` and `num_comments > 20`.

### Read Full Comment Tree

```
WebFetch: https://hn.algolia.com/api/v1/items/<objectID>
```

Response includes the full nested comment tree: `children[]` with `author`, `text`, `points`, `created_at`, and nested `children[]`.

### Search by Date Range (Trending Topics)

```
WebFetch: https://hn.algolia.com/api/v1/search_by_date?query=<topic>&tags=story&numericFilters=created_at_i>UNIX_TIMESTAMP
```

Use this for trending topics to find threads from the last 48-72 hours. Calculate the UNIX timestamp for "3 days ago."

### What to Extract

| Category           | What to Look For                      | Example                                                 |
| ------------------ | ------------------------------------- | ------------------------------------------------------- |
| Pain points        | Frustration, complaints, "I wish..."  | "I wish RSC had better error messages"                  |
| Expert opinions    | Long comments with technical depth    | "I've been using RSC in production for 6 months and..." |
| Contrarian takes   | Disagreements with mainstream view    | "Actually, RSC is solving the wrong problem..."         |
| Common questions   | Repeated questions across threads     | "How do I handle auth in server components?"            |
| Misconceptions     | Corrections and "well actually..."    | "RSC is NOT the same as SSR..."                         |
| Authentic language | How devs naturally describe the topic | "the mental model is just weird at first"               |

---

## X/Twitter

**Access:** Partial. WebSearch `site:x.com` returns tweet snippets in result titles.

### Finding Tweets

```
WebSearch: site:x.com <topic>
WebSearch: site:x.com <topic> opinion OR think OR problem OR love OR hate
WebSearch: site:x.com <topic> from:<known_expert>
```

Tweet text appears in the search result `title` field. The URL points to the tweet.

### What to Extract

| Category            | What to Look For                                      |
| ------------------- | ----------------------------------------------------- |
| Influencer opinions | What are recognized developers saying?                |
| Sentiment           | Is the overall reaction positive, negative, or mixed? |
| Hot takes           | Controversial or surprising opinions                  |
| Questions           | What are developers publicly asking?                  |
| Comparisons         | "X is like Y but..." patterns                         |

### Limitations

- Only tweet snippets visible (often truncated)
- No engagement metrics (likes, retweets)
- No full thread reading
- No image/video content from tweets
- Cannot filter by date range

---

## YouTube

**Access:** Requires external tool for transcripts. WebSearch for metadata only.

### Check Tool Availability

1. **MCP server:** Check if a YouTube transcript MCP tool is available in the current session
2. **npm CLI:** Run `npx youtube-transcript --help` to check if the package is accessible
3. **Fallback:** WebSearch only (metadata, no transcripts)

### Finding Videos (WebSearch)

```
WebSearch: <topic> tutorial site:youtube.com
WebSearch: <topic> explained site:youtube.com
WebSearch: <topic> 2026 site:youtube.com
```

Results include video title, channel name, and description snippet.

### Getting Transcripts (when tool available)

**Via MCP server:**
Use the YouTube transcript MCP tool with the video URL or ID.

**Via npm CLI:**

```bash
npx youtube-transcript "<video_url>"
```

### What to Extract

| Category                | What to Look For                                                |
| ----------------------- | --------------------------------------------------------------- |
| Expert explanations     | How do experts teach this concept? What analogies do they use?  |
| Mental models           | "Think of it as..." or visual diagrams described in words       |
| Implementation patterns | Code-along approaches, architecture decisions                   |
| Gaps                    | What do videos NOT cover? What questions remain after watching? |
| Audience questions      | Common comments asking follow-up questions                      |

### Key Rule

Adapt explanations, never copy. The value is understanding HOW experts teach, not reproducing their scripts.

---

## Stack Overflow

**Access:** Full access via WebFetch.

### Finding Questions

```
WebSearch: site:stackoverflow.com <topic>
WebSearch: site:stackoverflow.com <topic> [specific error message]
```

### Reading Questions

```
WebFetch: https://stackoverflow.com/questions/<question_id>
```

Full page content is accessible including question body, all answers, comments, and vote counts.

### What to Extract

| Category       | What to Look For                             |
| -------------- | -------------------------------------------- |
| Common errors  | Most-viewed questions about error messages   |
| Gotchas        | Edge cases that trip people up               |
| Debugging tips | Accepted answers with step-by-step debugging |
| Version issues | Answers that are outdated vs. current        |
| Misconceptions | Questions based on wrong assumptions         |

### When to Skip

- Trending topics (no SO content exists yet)
- Topics too new for SO to have quality answers
- Topics where SO answers are all outdated (pre-current-version)

---

## Reddit

**Access:** Limited but always attempt. Reddit is heavily cited by LLMs and has massive developer communities (r/reactjs, r/nextjs, r/webdev, r/programming, etc.). Equal priority with Hacker News.

### Access Methods (try in order)

**Method 1: WebSearch `site:reddit.com`**

```
WebSearch: site:reddit.com <topic>
WebSearch: site:reddit.com r/<subreddit> <topic>
```

May return Reddit thread URLs with title/snippet text.

**Method 2: Reddit JSON API**

```
WebFetch: https://www.reddit.com/r/<subreddit>/search.json?q=<topic>&sort=relevance&t=year&limit=10
WebFetch: https://www.reddit.com/r/<subreddit>/comments/<post_id>.json
```

Attempt even if expected to fail -- access may work for some endpoints.

**Method 3: Indirect (fallback)**

```
WebSearch: <topic> reddit discussion
WebSearch: <topic> reddit developers opinion
WebSearch: "<topic>" "reddit.com" summary
```

These find blog posts and articles that reference or summarize Reddit discussions.

### Key Subreddits for Dev Content

| Subreddit     | Best For                  |
| ------------- | ------------------------- |
| r/reactjs     | React ecosystem topics    |
| r/nextjs      | Next.js specific          |
| r/webdev      | General web development   |
| r/programming | Language/tool comparisons |
| r/javascript  | JS ecosystem              |
| r/typescript  | TypeScript patterns       |
| r/node        | Node.js backend           |
| r/Frontend    | Frontend architecture     |

### What to Extract

| Category           | What to Look For                                           |
| ------------------ | ---------------------------------------------------------- |
| Pain points        | Frustration, complaints, "I wish..."                       |
| Workarounds        | Highly-upvoted practical solutions                         |
| Authentic language | How devs naturally describe the problem                    |
| Common questions   | Questions appearing in 3+ phrasings (signals unmet demand) |
| Misconceptions     | Top corrections in comment threads                         |

### If All Methods Fail

Note in output: "Reddit: all access methods failed. Relying on HN + X for community signal."
Mark Reddit column as `[N/A]` in synthesis matrix. Do not silently skip.

---

## Dev.to

**Access:** Full access via WebFetch.

### Finding Articles

```
WebSearch: site:dev.to <topic>
WebFetch: https://dev.to/search?q=<topic>
```

### Quality Filter

Only include Dev.to articles that meet these criteria:

- In-depth (1000+ words, not just a "Getting Started" snippet)
- Includes code examples or original analysis
- Has engagement (reactions/comments visible on page)
- Published within the last 12 months

Skip shallow "My First Experience with X" posts unless they contain genuine insights.

### What to Extract

| Category              | What to Look For                                   |
| --------------------- | -------------------------------------------------- |
| Community tutorials   | Alternative approaches to official docs            |
| Real-world experience | "I used X in production and here's what happened"  |
| Comments              | Dev.to comments sometimes add valuable corrections |

---

## Official Documentation

**Access:** Full access via WebFetch for most documentation sites.

### Common Doc Patterns

```
WebFetch: https://docs.example.com/<feature>
WebFetch: https://developer.example.com/reference/<api>
WebFetch: https://github.com/<org>/<repo>/blob/main/docs/<file>.md
```

### What to Extract

| Category          | What to Look For                                            |
| ----------------- | ----------------------------------------------------------- |
| Core definitions  | Canonical terminology and concepts                          |
| API reference     | Function signatures, parameters, return types               |
| Code examples     | Official code snippets (can be reproduced with attribution) |
| Migration guides  | Version upgrade paths and breaking changes                  |
| Known limitations | Caveats, known issues, workarounds                          |
| Changelog         | What changed in recent versions                             |

### Verification Rule

Official docs are Tier 1 authority. All technical claims from other sources should be verified against official docs before inclusion in the post.

---

## Comparison Query Patterns

When `post_type == "comparison"`, run three query sets per platform instead of one. Individual product queries surface deeper content — reviews, feature deep-dives, workflow breakdowns — that comparison posts only summarize.

Read `comparison_subjects` from `phases/01-topic-validation.yaml`. Use `comparison_disambiguators` if a subject name is generic.

### Hacker News

```
# Comparison query (what you do today)
WebFetch: https://hn.algolia.com/api/v1/search?query=claude+code+vs+cursor&tags=story&hitsPerPage=10

# Subject A (individual product depth)
WebFetch: https://hn.algolia.com/api/v1/search?query=claude+code&tags=story&hitsPerPage=10

# Subject B (individual product depth)
WebFetch: https://hn.algolia.com/api/v1/search?query=cursor+ai&tags=story&hitsPerPage=10
```

Individual HN threads go deeper on product-specific pain points, workflow philosophy, and real-world usage reports.

### X/Twitter

```
# Comparison query
WebSearch: site:x.com "claude code vs cursor"

# Subject A (reviews and experiences)
WebSearch: site:x.com "claude code" review OR experience OR workflow OR love OR hate

# Subject B (reviews and experiences)
WebSearch: site:x.com "cursor" review OR experience OR workflow OR switched OR "moved to"
```

Individual product tweets reveal why developers choose or leave each product — switching stories are especially valuable.

### YouTube

```
# Comparison query
WebSearch: "claude code vs cursor" site:youtube.com

# Subject A (deep dives)
WebSearch: "claude code" review OR tutorial OR "deep dive" site:youtube.com

# Subject B (deep dives)
WebSearch: "cursor" review OR tutorial OR "deep dive" site:youtube.com
```

Individual product videos go deeper on features, workflows, and limitations than comparison videos that split time between products.

### Stack Overflow

```
# Comparison query (often low-quality on SO)
WebSearch: site:stackoverflow.com "claude code" OR "cursor"

# Subject A (real implementation problems)
WebSearch: site:stackoverflow.com "claude code"

# Subject B (real implementation problems)
WebSearch: site:stackoverflow.com "cursor ai" OR "cursor editor"
```

### Reddit

```
# Comparison query
WebSearch: site:reddit.com "claude code vs cursor"

# Subject A
WebSearch: site:reddit.com "claude code" opinion OR review OR experience

# Subject B
WebSearch: site:reddit.com "cursor" review OR experience r/programming OR r/webdev
```

### Dev.to

```
# Comparison query
WebSearch: site:dev.to "claude code vs cursor"

# Subject A
WebSearch: site:dev.to "claude code" OR "claude-code"

# Subject B
WebSearch: site:dev.to "cursor" review OR tutorial
```

### What Individual Queries Surface

| Query Type   | Surfaces                                                          | Why It Matters                                              |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Comparison   | Side-by-side opinions, switching stories, "which should I use"    | The obvious research — everyone does this                   |
| Individual A | Deep feature reviews, workflow breakdowns, pain points, tutorials | The depth — reviewers spend 100% of the post on one product |
| Individual B | Same depth for the other product                                  | Balanced perspective — avoids strawman weaknesses           |

### Disambiguation

If a subject name is generic (e.g., "Cursor" could mean database cursor), append the disambiguator from `comparison_disambiguators` in Phase 1 output:

- "cursor" → use "cursor ai code editor" or "cursor ai" for searches
- "builder" → use "builder.io" for searches

---

## Seed Content

**Access:** Local files in the `seed/` subfolder. User-provided.

Seed content is pre-existing research the user has collected before running the pipeline. It is ingested BEFORE automated research (Step 0.5 in the Content Research skill).

### File Types

| File               | How to Process                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `urls.txt`         | Parse URLs, fetch with WebFetch. Skip blocked domains. Tag as `source_type: seed`.                                                              |
| `keywords.txt`     | Handled by Keyword Research skill (Phase 2), not by Content Research.                                                                           |
| `notes.md`         | Read as "author perspective". Use to inform unique value proposition and angle. Tag as `source_type: seed_notes`.                               |
| Other `.md` files  | Parse as research articles. Extract title (first `#` heading or filename) and source (look for `**Source:**` line). Tag as `source_type: seed`. |
| Other `.txt` files | Parse as plain text research content. Tag as `source_type: seed`.                                                                               |

### URL Processing

For each URL in `seed/urls.txt`:

1. Normalize the URL (strip trailing slash, `www.` prefix)
2. Check against known-blocked domains:
   - `reddit.com` → skip with note "Blocked source, check for .md paste in seed folder"
   - `youtube.com` → attempt transcript tool (MCP > npm > metadata fallback)
3. WebFetch the URL. Extract key insights.
4. On failure: log the error, note the URL as failed, continue to next URL

### Article Processing

For each `.md` file (except `notes.md` and `keywords.txt`):

1. Read the full file content
2. Extract title: first `#` heading, or filename without extension
3. Extract source: look for `**Source:**` metadata line, fall back to filename
4. Extract author: look for `**Author:**` metadata line
5. Parse the content for key insights, facts, opinions, code examples
6. Weight as high-priority in the synthesis matrix

### Synthesis Matrix Integration

Seed sources appear as named columns in the synthesis matrix:

- "Seed: x-thread.md"
- "Seed: airops-draft.md"
- "Seed: Author Notes"

They are placed alongside platform columns (HN, X, YouTube, etc.) and participate in theme mapping, gap analysis, and unique value proposition formulation.

### De-duplication

If automated research discovers a URL that was already fetched from seed:

- Match by normalized URL (strip trailing slash, `www.` prefix, query parameters)
- Skip the automated fetch -- seed version already captured
- Seed wins on duplicates

---

## LLM Query Patterns

**Access:** Via WebSearch. Evergreen topics only.

### Discovery Method

```
WebSearch: <topic> tutorial
WebSearch: <topic> explained
WebSearch: <topic> best practices 2026
WebSearch: how to <topic>
```

Examine what content appears consistently across results. These are the "must-cover" topics that any comprehensive resource should address.

### What to Extract

| Category              | What to Look For                                     |
| --------------------- | ---------------------------------------------------- |
| Must-cover topics     | Subtopics that appear in 7+ of top 10 results        |
| Coverage gaps         | Subtopics that appear in 0-2 results                 |
| Incorrect information | Where top results get facts wrong                    |
| Stale content         | Results that reference outdated versions or patterns |

### When to Skip

- Trending topics (LLMs have not indexed the topic yet)
- Topics where the query is too specific for general LLM training data
