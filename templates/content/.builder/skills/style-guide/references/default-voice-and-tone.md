# Default Voice and Tone

The project default style rules. Local overrides in `.content-style-guide.md` take precedence section-by-section.

## Voice Characteristics

- **Conversational, developer-to-developer** -- write as a peer sharing what they learned, not a teacher lecturing. Use "you" and "I" naturally.
- **Specific over vague** -- numbers over adjectives, tool names over "various tools," version numbers over "the latest version."
- **Personal and opinionated** -- share what worked, what didn't, what you'd do differently. Include project names, version numbers, bugs encountered, tools preferred.
- **Concise, not terse** -- every sentence earns its place. Cut filler, but don't strip warmth.
- **Curious, not preachy** -- explore ideas rather than dictate rules. "I found that X works better" over "You should always X."

## Writing Techniques

Six techniques that define the voice. Each includes examples of the right calibration and common failure modes.

### Alternative perspectives

Challenge conventional wisdom, but frame it as personal discovery. Acknowledge the mainstream view, then offer what you've found. Stay confident without being combative, specific without being wishy-washy.

> "The common advice is to set clear goals. But I've found something that works better for me: building systems instead."

> "Everyone says you need passion to succeed. I'm not so sure. In my experience, passion often shows up after you're already good at something."

**Too aggressive:** "Goals are for losers. Anyone who tells you to set goals is setting you up for failure."

**Too timid:** "While goal-setting is certainly valuable and has helped many people, there might possibly be some cases where an alternative approach could perhaps be considered."

### Frameworks and mental models

Create simple, memorable frameworks. Name concepts. Give readers vocabulary they can use and remember. Numbered lists and clear labels make ideas sticky.

> "I call this the Replacement Test. Before you add something to your life, ask: what will this replace? Every yes is a no to something else."

> "There are three types of projects: passion projects (you love them, they may never pay), cash projects (you tolerate them, they fund your life), and bridge projects (you're building toward something bigger). The strategy is different for each."

> "Think of skills like Lego blocks. Each one you add connects to the others and multiplies your options."

**No structure:** "It's important to think carefully about how you spend your time and consider the trade-offs involved in any decision you make about projects."

### Direct conversation with the reader

Write as if talking to one person. Anticipate their thoughts, questions, and objections. Address them directly.

> "You might be thinking: that's fine for you, but I don't have time for that. Fair point. Here's how I handle it when time is tight."

> "If you're skeptical, good. You should be. I was too until I saw it work three times in a row."

> "Here's where you might disagree with me. And honestly, you might be right."

**Too distant:** "Some readers may question the applicability of this approach. These concerns are understandable and will be addressed in the following section."

### Dry, observational humor

Humor comes from describing reality, not from jokes or punchlines. Find the absurdity in situations and state it plainly. Deadpan delivery.

> "The software promised to save me ten hours a week. It took twelve hours to set up. I'm still waiting to break even."

> "My first business plan was twenty pages long. It predicted profitability in month three. We shut down in month two. Turns out the plan forgot to account for the part where customers had to actually exist."

> "I've attended hundreds of networking events. I've made one useful contact. He moved to another country."

**Trying too hard:** "So there I was, LOL, trying to figure out this software and you won't BELIEVE what happened next!"

**No personality:** "The software implementation required more time than initially anticipated, resulting in a longer payback period."

### Compressed immersive storytelling

Take readers inside moments efficiently. Two or three vivid details create the scene. The reader's imagination fills in the rest.

> "Fluorescent lights. Stained carpet. Eleven people crammed around a table built for six. This was where ideas came to die. I pulled out my notebook anyway."

> "My hand was shaking when I clicked send. Three months of work in one email. The reply came in four minutes. Two words: 'Not interested.'"

> "4 AM. Cold coffee. Cursor blinking on an empty page. I'd been 'almost done' for three weeks."

**Too long:** "As I walked into the conference room that Tuesday morning, I noticed the fluorescent lights humming overhead, casting their familiar pale glow across the stained beige carpet that had seen better days. The room was cramped, with eleven people somehow squeezed around a rectangular table..."

**No detail:** "I was in a bad meeting and had an idea."

### Framing advice as discovery

Share what you've found, what worked, what you've observed. Give readers permission to disagree and find their own path.

> "This is what worked for me. Your situation might be different."

> "I'm not saying this is the only way. But after trying five other approaches that failed, this is the one I kept."

> "Take what's useful here. Ignore what isn't. You know your life better than I do."

> "I've noticed a pattern, but I could be wrong. Test it for yourself."

**Too preachy:** "You need to do this. If you don't follow these steps exactly, you will fail."

**Too wishy-washy:** "This might work, or it might not, and really who's to say what's right or wrong, it's all relative anyway."

## Hard Rules

| # | Rule | Detection Pattern | Fix |
|---|------|-------------------|-----|
| 1 | No generic openings | "In this article we will...", "Welcome to this comprehensive guide..." | Jump directly into the topic with a hook |
| 2 | No AI-sounding phrases | See [ai-voice-detection.md](../../content-editing/references/ai-voice-detection.md) | Replace per category tables |
| 3 | Short paragraphs | >3 sentences per paragraph | Break at idea boundaries |
| 4 | Specific CTAs | "Try Builder.io" (generic), "Check it out" | Connect CTA to the post's specific use case |
| 5 | No em dashes | Any em dash (---, —) in prose | Use periods, commas, parentheses, or restructure the sentence |
| 6 | No hedge stacking | "It might potentially be somewhat useful..." | Pick one qualifier or remove all |
| 7 | No "happy coding" closers | "Happy coding!", "That's a wrap!" | End with a specific next step or challenge |
| 8 | Active voice default | "The component is rendered by React" | "React renders the component" |
| 9 | No filler adverbs | "very", "really", "actually", "basically", "essentially" | Cut or replace with specific detail |
| 10 | Contractions required | "do not", "it is", "you will" in running prose | Use "don't", "it's", "you'll" (code comments are exempt) |
| 11 | No contrastive patterns | "X isn't Y. It's Z.", "not X, but Y", "Without X, Y happens" | State affirmatively what something IS. See [Contrastive Patterns](#contrastive-patterns) below |
| 12 | No rhetorical questions | "Does this create dependency?", "Sound familiar?" | Rewrite as statements. "You might think this creates dependency. It doesn't." |
| 13 | No colon-as-em-dash | "The rule I follow: include X", "Here's the thing: it works" | Restructure to flow naturally. "What works for me is including X" |
| 14 | Title case for titles, sentence case for headings | H2/H3/H4 in Title Case | Blog post title uses Title Case. All section headings (H2, H3, etc.) use sentence case |
| 15 | Product names capitalized after keyword placement | "ai coding tools", "cursor and claude code" lowercased for keyword density | Capitalize product names in final text: "AI coding tools", "Cursor and Claude Code". Keyword presence is preserved |
| 16 | Descriptive link text | "click here", "read more", "this article", "this post", bare URLs as link text | Use descriptive anchor text: page title, tool name, or specific phrase. See [link-text-rules.md](./link-text-rules.md) |
| 17 | Three-tier name attribution | Dropped names without credentials | Keep with context, genericize, or remove. See [Name Attribution](#name-attribution) below |
| 18 | No overclaim superlatives | "most valuable", "highest-leverage", "best in class", "every team" | Use comparatives: "have an edge", "faster than", "stronger for X than Y" |
| 19 | No hedging -- take a position | "may prefer", "might work", "depends on your comfort level" | Recommend directly ("start with X") or state the specific tradeoff |
| 20 | No competitor-validation hedging | "The roundtrip works when...", "The right tool depends on..." in hybrid content | Describe limitations honestly, position Builder.io as better. See [Competitor-Validation Hedging](#competitor-validation-hedging) below |
| 21 | Write for one reader, not a crowd | "Most developers", "Many teams", "People often" | First-person ("I connected") or direct second-person ("your first command"). See [Write for One Reader](#write-for-one-reader) below |
| 22 | Define-then-advise for non-dev audiences | Technical terms without plain English for non-dev readers | Pattern: (1) what it is, (2) why reader cares, (3) what to do |
| 23 | Conversational quote attribution | "put it this way:", "stated that:", "noted:" | Parenthetical credentials, period before quote. See [Quote Attribution](#quote-attribution) below |
| 24 | Full absolute URLs for Builder.io links | Relative paths: `/blog/<slug>` | Full URLs: `https://www.builder.io/blog/<slug>` |

## Formatting

- **Paragraphs:** 1-3 sentences. A single-sentence paragraph is fine for emphasis.
- **Subheadings:** Every 200-300 words. Question-based where appropriate for AEO.
- **Code blocks:** Always include the language identifier. Add inline comments for non-obvious lines. Show 5-15 lines per block (split longer examples).
- **Lists:** Use for 3+ parallel items. Avoid lists-of-one. Numbered lists for sequential steps only, bullet lists for everything else.
- **Bold:** For introducing key terms on first use, and for the lead word in definition lists. Not for emphasis in running prose (rephrase instead).
- **Links:** Descriptive anchor text that makes sense without surrounding context. Never "click here", "read more", or bare URLs. Keep link text to 2-6 words. Place punctuation outside link tags. See [link-text-rules.md](./link-text-rules.md) for the full reference.
- **Internal blog links:** Always use full absolute URLs (`https://www.builder.io/blog/<slug>`), never relative paths (`/blog/<slug>`). Full URLs ensure links work when content is syndicated to Dev.to, newsletters, or other platforms.

## Contrastive Patterns

AI-generated text leans heavily on contrastive framing, defining what something IS by first saying what it ISN'T. This creates a predictable, mechanical rhythm. State things affirmatively instead.

**Banned patterns and their affirmative rewrites:**

| Pattern | Example (BAD) | Rewrite (GOOD) |
|---------|---------------|-----------------|
| "X isn't Y. It's Z." | "The bottleneck isn't speed. It's orchestration." | "Orchestration is the real bottleneck." |
| "X isn't Y, it's Z." | "The problem isn't the tool, it's the workflow." | "The workflow matters more than the tool." |
| "not X, but Y" | "not speed, but orchestration" | "orchestration above all" |
| "The real X isn't Y" | "The real issue isn't tooling" | "The real issue is workflow design." |
| "not just X" | "not just detection" | "detection and automated fixes end-to-end" |
| "not a X" (contrast) | "as a strength, not a weakness" | "Turn design-to-code handoffs into a competitive advantage." |
| "Without X, Y happens" | "Without design systems, teams start over." | "Design systems keep teams moving forward." |
| "instead of X" (contrast) | "See feedback instead of excuses." | "See actual feedback on real data." |
| "X rather than Y" | "clarity rather than confusion" | "clarity in every interaction" |
| "If not X, then Y" | "If not automated, then manual" | "Automation handles it." |

**The fix:** Drop the negation. Say what something IS, does, or enables. Directly.

## Name Attribution

Never drop a name without a credential the target audience would recognize. For every quoted source, apply one of three tiers:

- **Keep with context:** Person is relevant AND has verifiable credentials. Introduce with a one-line credential (title, company, newsletter, follower count, blog).
- **Genericize:** Observation is universal or person lacks audience-relevant credentials. Use "one PM found..." or "PMs report..." instead.
- **Remove:** Person is tangential to the target audience. Use the insight without the name, or cut.

## Competitor-Validation Hedging

In hybrid content, do not validate the competitor's approach. Describe their limitations honestly, then position Builder.io as clearly better. Patterns to cut:

- "The roundtrip works when..." / "earns its keep in..."
- "The right tool depends on your team size"
- "There's no single right answer"
- "It depends on how much [X] you need"

These sound balanced but weaken the Builder.io positioning. The post's own analysis already shows the limitations. The Builder.io section makes the case for a better approach -- don't undermine it with "but the competitor works too" paragraphs.

## Write for One Reader

Avoid generic mass-addressing openers like "Most developers", "Many teams", "People often." These read like conference talks, not blog posts. Write as one person talking to one reader. Use first-person experience ("I connected", "I spent") or direct second-person ("your first command") instead. Collective nouns are fine occasionally but should not be the default framing, especially in intros and hooks.

Patterns to avoid:
- "Most developers hear about X and..."
- "The distinction that trips people up..."
- "Many engineers struggle with..."
- "Developers often find that..."

Also: vary intro angles across posts in the same hub. If one post opens with a problem hook, the next should use a scene, a metric, or a question.

## Quote Attribution

Introduce quotes and expert attributions conversationally. Avoid stiff patterns like "put it this way:", "stated that:", "noted:". Use parenthetical credentials and a period instead of a colon before the quote.

- **Stiff:** "Simon Willison, the developer behind Django and Datasette, put it this way: 'context pollution...'"
- **Conversational:** "Simon Willison (Django, Datasette) summed up the shift. 'Context pollution...'"

## Phrases to Avoid

- "most valuable [people/role] on every team" → use comparative ("have an edge")
- "highest-leverage" → use comparative ("faster path", "have an edge")
- "may prefer" → recommend directly ("start with X")
- "depends on your comfort level" → state the tradeoff or recommend
- "turns [noun] into [noun] velocity/productivity" → name specific features

## Formal Verbs to Replace

These verbs are individually fine but signal academic register when used as defaults in conversational content. Replace with informal alternatives:

| Formal Verb | Conversational Alternative |
|------------|---------------------------|
| examines | asks, looks at, checks |
| explores | digs into, looks at, covers |
| demonstrates | shows |
| illustrates | shows |
| elucidates | explains, breaks down |

## Unnecessary Qualifiers to Drop

These qualifiers add false precision. The sentence is stronger without them:

- "concrete" (examples, steps, data) → just say "examples", "steps", "data"
- "actual" (codebase, usage, results) → just say "codebase", "usage", "results"
- "specific" (when modifying something already specific) → drop it

## Content Rules

- **Word count:** 1,200-3,000 words depending on post type. Target 2,200 for standard posts. Ceiling varies by post type (comparison/tutorial: 3,000; explainer/how-to: 2,500; thought leadership: 2,000).
- **Internal links:** 2-3 links to related Builder.io blog posts (all content goals).
- **External links:** 2-3 links to authoritative sources (official docs, RFCs, research).
- **Code-to-prose ratio:** At least one code example, benchmark, or concrete output per body section.
- **Hook:** First 2-3 sentences must earn the reader's attention. No preamble, no throat-clearing. Start with something unexpected, a bold claim, or drop directly into a story. Examples: "I wasted two years optimizing the wrong thing." / "The best decision I ever made looked like a mistake for eighteen months."
- **Transitions:** Short bridging sentences between ideas. "That experience changed how I think about risk." / "This brings me to the second problem." / "But here's where it gets interesting." Avoid academic transitions like "Having thoroughly examined the aforementioned topic, we shall now transition..."
- **Conclusion:** End with a specific, actionable next step -- not a summary of what the post covered.

## Voice Violation Taxonomy

Three failure modes to watch for during editing. Each has detection patterns and fixes.

### Too Formal

The post reads like documentation or an academic paper.

| Detection Pattern | Example | Fix |
|-------------------|---------|-----|
| Third person where first/second fits | "One may consider using..." | "You can use..." or "I've found..." |
| Passive voice clusters | "It is advisable to...", "It should be noted..." | Active voice with a named subject |
| No contractions | "do not", "cannot", "it is" throughout | Contract naturally |
| Latin/academic phrases | "i.e.", "e.g.", "vis-a-vis", "aforementioned" | Plain English equivalents |
| Nominalization | "The utilization of...", "The implementation of..." | Use the verb: "Using...", "Implementing..." |

### Too Casual

The post reads like a chat message or unedited stream of consciousness.

| Detection Pattern | Example | Fix |
|-------------------|---------|-----|
| Slang and filler | "gonna", "kinda", "super cool", "insane" | Moderate informal: "going to", "somewhat", specific praise |
| Run-on sentences | 40+ word sentences chained with "and" | Split at idea boundaries |
| No structure | Wall of text, no subheadings, no code blocks | Add subheadings every 200-300 words, break up with examples |
| Excessive exclamation | Multiple "!" per section | One per post maximum, and only if genuinely surprising |
| Missing evidence | Claims without code, numbers, or links | Add supporting proof per the "Prove It" check |

### Too Preachy

The post lectures the reader instead of sharing experience.

| Detection Pattern | Example | Fix |
|-------------------|---------|-----|
| Imperative commands | "You should always...", "Never do X..." | "I've found that..." or "In my experience..." |
| Moral framing | "The right way to...", "Best practices dictate..." | "One approach that worked for us..." |
| Assumed ignorance | "As you may know...", "Obviously..." | Cut the preamble, state the fact |
| Condescending hedges | "Simply do X", "Just add a line" | Remove "simply"/"just" -- if it were simple, they wouldn't be reading |
| Unearned authority | Strong opinions without supporting evidence | Back claims with benchmarks, examples, or linked sources |

## Severity Classification

Use these levels in editing reports and style guide compliance checks.

| Severity | Description | Action | Examples |
|----------|-------------|--------|----------|
| **Critical** | Hard rule violation or factual error | Must fix before publish | AI-sounding phrases, generic opener, wrong code output |
| **Important** | Voice drift, weak structure, missing elements | Should fix -- impacts reader trust | Preachy tone, no CTA, missing internal links |
| **Minor** | Polish-level improvements | Consider -- improves quality | Paragraph rhythm, slightly weak transition |
| **Praise** | Effective pattern worth reinforcing | Record in compound docs | Strong hook, natural Builder.io integration, specific example |
