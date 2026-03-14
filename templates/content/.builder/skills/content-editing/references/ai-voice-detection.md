# AI-Voice Detection Reference

Flag and rewrite phrases that signal AI-generated content. Organized by detection priority: Category A patterns are near-certain AI tells; Category E patterns are structural habits that accumulate into an AI "feel."

## Category A: Dead-Giveaway Words

Highest detection signal. These phrases appear 10-180x more often in AI text than human text. Replace or cut on sight.

| AI Phrase                            | Frequency Multiplier | Rewrite                                                        |
| ------------------------------------ | -------------------- | -------------------------------------------------------------- |
| "play a significant role in shaping" | 182x                 | Name the specific effect                                       |
| "today's fast-paced world"           | 107x                 | Cut entirely                                                   |
| "aims to explore"                    | 50x                  | Cut the preamble, start exploring                              |
| "showcasing"                         | 20x                  | "showing" or just describe what it shows                       |
| "aligns"                             | 16x                  | "matches", "fits", or rephrase                                 |
| "surpassing"                         | 12x                  | "beating", "faster than", or use the actual number             |
| "underscores"                        | 10x                  | "shows", "proves", or cut                                      |
| "navigating"                         | 10x                  | Name what you're actually doing                                |
| "landscape"                          | 8x                   | Name the specific area (e.g., "React ecosystem", "CMS market") |
| "paradigm"                           | 8x                   | "approach", "model", or name the specific thing                |
| "tapestry"                           | 30x                  | Cut entirely                                                   |
| "multifaceted"                       | 15x                  | Name the specific facets, or "complex"                         |
| "ever-evolving"                      | 12x                  | Cut entirely, or name what changed                             |

## Category B: Overused AI Vocabulary

Always-replace list. These words aren't wrong, but their density in AI text is a reliable signal.

| AI Word                | Replacement                                                  |
| ---------------------- | ------------------------------------------------------------ |
| "delve" / "delve into" | "look at", "dig into", or just start explaining              |
| "robust"               | "strong", "reliable", or describe what makes it robust       |
| "comprehensive"        | Describe what it actually covers                             |
| "utilize"              | "use"                                                        |
| "leverage"             | "use"                                                        |
| "seamless"             | Describe the actual UX ("no page reload", "one command")     |
| "holistic"             | Name what's included                                         |
| "facilitate"           | "enable", "let", or "help"                                   |
| "endeavor"             | "effort", "project", or "work"                               |
| "pivotal"              | "important", "key", or explain why it matters                |
| "intricate"            | "complex", or describe the specific complexity               |
| "nuanced"              | Name the actual nuances                                      |
| "streamline"           | "simplify", "speed up", or describe the specific improvement |
| "empower"              | "let", "enable", or describe the specific capability         |
| "foster"               | "encourage", "build", or "create"                            |
| "cutting-edge"         | Name the specific advancement                                |
| "game-changer"         | Describe the specific impact                                 |
| "best practices"       | Name the specific practices                                  |

### Category B-2: Academic-Register Defaults

These verbs and qualifiers aren't overtly AI but signal academic register when used as defaults in conversational blog posts. They pass Category A-D scans because they're individually innocuous.

| Academic Default       | Conversational Alternative                  |
| ---------------------- | ------------------------------------------- |
| "examines"             | "asks", "looks at", "checks"                |
| "explores"             | "digs into", "looks at", "covers"           |
| "demonstrates"         | "shows"                                     |
| "illustrates"          | "shows"                                     |
| "elucidates"           | "explains", "breaks down"                   |
| "concrete" (qualifier) | Drop it -- "concrete examples" → "examples" |
| "actual" (qualifier)   | Drop it -- "actual codebase" → "codebase"   |

Flag during Sub-Pass 5 (Read-Aloud Test): these sound fine in writing but feel stiff when spoken aloud.

### Model-Specific Tells

| Model   | Favored Patterns                                                                               |
| ------- | ---------------------------------------------------------------------------------------------- |
| ChatGPT | "Certainly!", "Absolutely!", "Great question!", "Overall,...", starting lists with "Here's..." |
| Claude  | "I'd be happy to...", "It appears that...", "Based on the...", "It's worth noting..."          |
| Gemini  | "In essence,...", "Here are some key..."                                                       |

## Category C: Hedging and Qualification

AI text hedges constantly because models are trained to avoid definitive claims. Cut these preambles entirely -- either commit to the claim or provide the specific exception.

### Cut on sight

- "It's important to note that..."
- "It's worth mentioning that..."
- "It's worth noting that..."
- "Generally speaking,..."
- "From a broader perspective,..."
- "It should be noted that..."
- "As a matter of fact,..."
- "In many cases,..."
- "To a certain extent,..."
- "Needless to say,..."

### Rewrite pattern

**Before:** "It's important to note that React Server Components can significantly reduce bundle size in many cases."

**After:** "Server Components cut bundle size. In our test app, the JavaScript payload dropped from 245KB to 89KB."

The fix is always the same: replace the hedge with a specific claim, number, or example.

## Category D: Formulaic Openers and Closers

### Openers to kill

- "In today's digital age,..."
- "In an era of..."
- "In the ever-evolving world of..."
- "Have you ever wondered...?"
- "In this comprehensive guide,..."
- "In this article, we will explore..."
- "Welcome to this guide on..."
- "Whether you're a beginner or an expert,..."

### Closers to kill

- "In conclusion,..."
- "To sum up,..."
- "By understanding [X], you can [Y]"
- "The future of [X] is [promising/exciting/bright]"
- "As we've seen,..."
- "Happy coding!"
- "I hope you found this helpful"
- "Remember, the key takeaway is..."

### Developer blog-specific openers to kill

- "Let's dive into..."
- "Let's explore how..."
- "Let's take a closer look at..."
- "Simply run the following command:" (replace with "Run:")
- "First, we need to install..." (replace with "Install [package]:")

## Category E: Structural Giveaways

These aren't individual phrases but patterns in how content is organized. They create the "AI feel" even when individual sentences pass detection.

### The Rule of Three

AI defaults to triadic structures in nearly every list, example set, and enumeration. Three benefits. Three steps. Three considerations. Vary list lengths: use two items, four items, one item, or five.

**Before:** "Server Components offer three key benefits: faster page loads, smaller bundles, and better SEO."

**After:** "Server Components cut your JavaScript bundle. Pages load faster because the browser downloads less code, and search engines can crawl the server-rendered HTML directly."

### Triadic Negation

AI defaults to "No X, no Y, no Z" patterns that feel like marketing copy. This is a variant of Rule of Three using negative framing.

**Before:** "No export, no re-translation, no context loss between tools."

**After:** "Everything happens in a single environment."

The fix: replace the triadic negation with an affirmative statement. One positive claim is stronger than three negatives.

### Trailing Present Participle

AI appends "-ing" clauses to pad sentence length. Cut the trailing clause entirely.

**Before:** "React 19 introduces the `use` hook, simplifying data fetching and enabling better composition patterns."

**After:** "React 19 introduces the `use` hook. Data fetching gets simpler."

### Synonym Carousel

Instead of repeating a proper noun, AI cycles through synonyms: "the framework," "the library," "this tool," "the platform." Humans repeat the actual name.

**Before:** "Next.js handles routing. The framework also provides API routes. This popular tool includes..."

**After:** "Next.js handles routing. Next.js also provides API routes. Next.js includes..."

### Rigid Paragraph Structure

Every AI paragraph follows topic sentence → evidence → summary. Break this pattern:

- Start some paragraphs with an example
- Start some with a question
- Start some with a code reference
- Vary paragraph length (1 sentence, then 3, then 2)

### Uniform Depth

AI gives equal depth to every topic. Humans spend more time on what interests them or what's harder to explain. If every H2 section is exactly the same length, that's an AI signal.

### No Opinions or Trade-offs

AI avoids taking sides. Human developers have preferences, frustrations, and opinions. If the post never says "I prefer X over Y because..." or "The documentation for X is terrible," it reads as AI.

## The 5-Pass AI-Voice Sub-Workflow

Run these passes in order within the AI-Voice Detection editing pass (Pass 3 of the main 4-pass edit).

### Sub-Pass 1: Vocabulary Scan (Mechanical)

Flag all Category A-D instances in the draft. For each:

- Category A: Replace with specific language or cut
- Category B: Swap from the replacement table
- Category C: Cut the preamble, keep only the claim
- Category D: Rewrite the opener/closer from scratch

### Sub-Pass 2: Structure Analysis

- Measure sentence length variation per section. Flag sections where 3+ consecutive sentences are similar length.
- Count list items. Flag every list of exactly 3 items. Vary at least half of them.
- Flag trailing present participles ("-ing" clauses at end of sentences). Cut or split into new sentence.
- Check for synonym carousel. Flag instances where the subject name is avoided in favor of pronouns or generic nouns within the same section.

### Sub-Pass 3: Voice Injection

For each H2 section, verify at least one of these is present:

- An opinion or preference ("I prefer X because...", "This API design is frustrating")
- A moment of informality (a short sentence, a mild aside, a direct address to the reader)

If a section has none, add one. Keep it brief -- one sentence is enough.

### Sub-Pass 4: Introduction and Conclusion Review

Re-read the first 2-3 sentences and the final paragraph specifically for AI patterns:

- Does the introduction start with any Category D opener? Rewrite.
- Does the conclusion use any Category D closer? Rewrite.
- Does the introduction feel like it could open any article on this general topic, or is it specific to this post? Make it specific.

### Sub-Pass 5: Read-Aloud Test

Read each paragraph as if speaking it aloud. Flag any sentence where:

- The cadence goes flat (monotone rhythm, no variation)
- The sentence sounds like a textbook rather than a person talking
- You'd never say this sentence in a conversation with a colleague

For flagged sentences: simplify, shorten, or inject conversational phrasing.

## Quick-Reference: Top 10 Most Common AI Tells in Developer Blogs

1. "Let's dive into..." -- just start explaining
2. "In this comprehensive guide..." -- cut the preamble
3. Lists of exactly 3 items -- vary the count
4. "It's worth noting that..." -- cut, state the thing directly
5. Every paragraph same length -- vary between 1-4 sentences
6. No opinions anywhere -- add at least one per section
7. "Robust" / "seamless" / "leverage" -- use plain English
8. "Simply run the following command:" -- "Run:"
9. Trailing "-ing" clauses on every other sentence -- cut or split
10. "In conclusion,..." -- just start concluding
