# Source Authority Tiers

Evaluate the authority of each source before including it in research findings. Higher-tier sources require less cross-referencing; lower-tier sources need corroboration.

## Tier 1: Highest Authority

**Trust level:** Accept as fact. Cross-reference only for currency (is this still accurate for the latest version?).

| Source Type | Examples | Notes |
|-------------|---------|-------|
| Official documentation | React docs, MDN, Node.js docs | The canonical source of truth |
| RFCs and specifications | TC39 proposals, W3C specs | Definitive for standards |
| Source code | GitHub repos, official SDKs | The ultimate arbiter of behavior |
| Official changelogs | Release notes, migration guides | Version-specific authority |

## Tier 2: High Authority

**Trust level:** Generally reliable. Cross-reference against Tier 1 for technical claims.

| Source Type | Examples | Notes |
|-------------|---------|-------|
| Core team blog posts | Dan Abramov on React, Guillermo Rauch on Next.js | Written by the people who built it |
| Conference talks | React Conf, Google I/O, JSConf | Peer-reviewed by the ecosystem |
| Official company engineering blogs | Vercel blog, Cloudflare blog, Netflix tech blog | Vetted by engineering teams |
| Peer-reviewed research | Academic papers, formal benchmarks | Methodology is transparent |

## Tier 3: Medium Authority

**Trust level:** Useful for perspectives, real-world experience, and developer sentiment. Cross-reference technical claims against Tier 1-2.

| Source Type | Examples | Notes |
|-------------|---------|-------|
| Established tech blogs | Smashing Magazine, CSS-Tricks, LogRocket | Editorial oversight exists |
| Hacker News threads (50+ points) | Top comments from experienced developers | Strong signal for sentiment and real-world issues |
| Reddit threads (100+ upvotes) | Subreddit discussions with high engagement | Heavily cited by LLMs, broad developer reach. Access may be limited -- always attempt. |
| Recognized YouTubers | Fireship, Theo Browne, Jack Herrington, Traversy Media | Large audience validates quality over time |
| Stack Overflow (100+ upvotes) | Accepted answers with high votes | Community-validated solutions |
| Dev.to (if in-depth) | Well-researched articles with code examples | Quality varies -- evaluate individually |

## Tier 4: Low Authority

**Trust level:** Use for signal and sentiment only. Never cite as a factual source. Always cross-reference.

| Source Type | Examples | Notes |
|-------------|---------|-------|
| Individual blog posts | Personal tech blogs, Medium articles | No editorial oversight, may be outdated |
| X/Twitter hot takes | Tweet snippets, threads | Opinions, not facts. Useful for sentiment only |
| AI-generated summaries | ChatGPT responses, Perplexity summaries | Never cite as a source. AI can hallucinate facts |
| Unverified benchmarks | Blog post benchmarks without methodology | Methodology may be flawed or cherry-picked |

## Usage Rules

1. **Factual claims** must trace to Tier 1 or Tier 2 sources
2. **Opinions and sentiment** can come from any tier but should be attributed ("HN commenters noted that...")
3. **Code examples** should come from Tier 1 (official docs) or be original. Never copy code from Tier 3-4 without attribution
4. **When tiers conflict**, higher tier wins for facts. For sentiment, note the disagreement
5. **Absence from Tier 1** is itself a signal -- if official docs don't cover a topic, that's a content gap

## Access Method by Source

| Source | Access Method | Reliability |
|--------|:---:|:---:|
| Official docs | WebFetch | High -- most doc sites work |
| Hacker News | WebFetch + Algolia API (free) | High -- full access |
| Stack Overflow | WebFetch | High -- full access |
| Dev.to | WebFetch | High -- full access |
| Tech blogs | WebFetch | Medium -- most work, some JS-heavy sites don't |
| X/Twitter | WebSearch `site:x.com` | Low -- snippets only |
| Reddit | WebSearch `site:reddit.com` + JSON API + indirect | Variable -- always attempt, access may be limited |
| YouTube | External tool (MCP/npm) | Medium -- requires setup |
| Medium | WebSearch (titles only) | Low -- body blocked (403) |
