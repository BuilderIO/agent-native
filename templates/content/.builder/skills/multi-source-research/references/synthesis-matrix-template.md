# Research Synthesis Matrix Template

The synthesis matrix maps research themes against sources. It makes gaps visible at a glance and ensures the post covers every important angle.

## How to Use

1. Identify 4-6 themes from the research (rows)
2. Fill in what each source says about each theme (cells)
3. Empty cells = content gaps = differentiation opportunities
4. Conflicting cells = interesting angles to explore in the post

## Template

| Theme | Official Docs | Hacker News | Reddit | X/Twitter | YouTube | Stack Overflow | SERP Top 10 | LLM Patterns |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Core concept | | | | | | | | |
| Implementation | | | | | | | | |
| Edge cases | | | | | | | | |
| Performance | | | | | | | | |
| Migration / adoption | | | | | | | | |
| Common mistakes | | | | | | | | |

## Column Guide

| Column | What to Record |
|--------|----------------|
| **Official Docs** | Factual definitions, API signatures, official code examples |
| **Hacker News** | Developer opinions, pain points, expert explanations, contrarian takes |
| **Reddit** | Subreddit pain points, upvoted workarounds, authentic language, community questions. Mark `[N/A]` if access failed. |
| **X/Twitter** | Sentiment snippets, who's talking about it, hot takes |
| **YouTube** | How experts explain it (analogies, mental models), tutorial approaches |
| **Stack Overflow** | Common errors, gotchas, debugging tips, accepted workarounds |
| **SERP Top 10** | What angles existing articles take, what they cover/miss |
| **LLM Patterns** | What AI consistently covers vs. misses, where AI is wrong |

## Cell Notation

Use short phrases with signal indicators:

- `[COVERED]` -- well-covered, nothing new to add
- `[SHALLOW]` -- covered but not deeply. Opportunity for depth
- `[GAP]` -- not covered at all. Strong content opportunity
- `[WRONG]` -- source gets this wrong. Correction opportunity
- `[DEBATE]` -- conflicting opinions exist. Interesting angle
- `[N/A]` -- source not available or not applicable

## Filled Example

**Topic:** "React Server Components"

| Theme | Official Docs | Hacker News | Reddit | X/Twitter | YouTube | Stack Overflow | SERP Top 10 | LLM Patterns |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Core concept | Comprehensive definition | [DEBATE] on necessity | [COVERED] r/reactjs | Mixed sentiment | Visual demos | [GAP] | [COVERED] | [SHALLOW] mental model |
| Implementation | Next.js App Router patterns | [SHALLOW] few examples | Workarounds shared | Tips & tricks | Step-by-step tutorials | `use client` placement | [COVERED] tutorials | Procedural steps |
| Edge cases | Sparse, mostly caveats | [COVERED] real-world issues | Real-world gotchas | Complaints | Troubleshooting | [COVERED] error patterns | [GAP] | [WRONG] on streaming |
| Performance | Benchmarks exist | [DEBATE] real-world gains | Anecdotal reports | Skepticism | Comparisons | [GAP] | [SHALLOW] | Estimated numbers |
| Migration | Minimal guidance | [GAP] Pages→App Router | [COVERED] migration pain | Frustration | [GAP] | Migration errors | [GAP] | [WRONG] on steps |
| Common mistakes | [GAP] | Rich detail | Upvoted pitfalls | [COVERED] | [SHALLOW] | Top 5 errors | [SHALLOW] | Common patterns |

**Gaps identified from this matrix:**
1. Migration from Pages Router to App Router -- [GAP] in 3 sources (official docs, HN, YouTube)
2. Edge cases with streaming SSR -- [WRONG] in LLM patterns, [GAP] in SERP
3. Common mistakes are rich in HN/Reddit/SO but missing from official docs

## Trending Topic Matrix

For trending topics, some columns will be mostly `[N/A]`. This is expected.

| Theme | Official Docs | Hacker News | Reddit | X/Twitter | YouTube | Stack Overflow | SERP Top 10 | LLM Patterns |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Core concept | Announcement post | Early reactions | Early threads | First impressions | [N/A] or early video | [N/A] | [N/A] | [N/A] |
| Key features | Release notes | What excites devs | Questions asked | Highlight reels | [N/A] | [N/A] | [N/A] | [N/A] |
| Limitations | Changelog caveats | Skepticism | Complaints | Complaints | [N/A] | [N/A] | [N/A] | [N/A] |
| vs. alternatives | [GAP] usually | Active comparison | vs. threads | Hot debates | [N/A] | [N/A] | [N/A] | [N/A] |

The fewer populated columns, the more the post relies on original analysis and official sources. This is fine -- for trending topics, being first with accurate information is the differentiator.
