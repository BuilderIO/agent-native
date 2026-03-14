# Outline Templates

Post-type-specific structural templates. Load the matching template and adapt to the topic. These are starting points, not rigid formats -- merge, split, or reorder sections as the research demands.

## Tutorial Template

Best for step-by-step implementation posts. The reader wants to build something.

```markdown
# [How to X with Y] OR [N Ways to Achieve X]

**Post type:** tutorial
**Copywriting framework:** Before-After-Bridge (recommended) or PAS
**Hook types that work well:** Problem, Story Start, Statistic

## Introduction (~200 words)

- Hook: relatable developer frustration or clear outcome promise
- Context: what the reader will build/achieve
- Prerequisites: tools, versions, prior knowledge needed

## [What Is X and Why Does It Matter for Y?] (~300 words)

- Brief conceptual grounding (not a deep explainer -- link out for that)
- Answer-first block: 40-60 word definition + why it matters
- Featured snippet target: definition
- Keep short -- tutorial readers want to get to the code

## [How to Set Up X: Prerequisites and Configuration] (~300 words)

- Environment setup, installation, config
- Code block: starter command or config file
- Common setup pitfalls from Stack Overflow research

## [How to Build/Implement the Core Feature] (~500 words)

- Step-by-step implementation with code blocks
- Explain the WHY behind each step, not just the HOW
- Mermaid diagram: yes (architecture or data flow)
- This is the longest section -- the core tutorial value

## [What Are the Common Gotchas When Working with X?] (~300 words)

- Edge cases from research (SO, HN, official docs)
- Answer-first block: top 3 gotchas as a quick list
- Featured snippet target: list
- Code examples showing the wrong way vs right way

## [How to Take X to Production] (~300 words)

- Performance considerations
- Testing strategies
- Deployment notes
- Optional: advanced patterns for experienced readers

## FAQ (~200 words)

- 3-4 questions from PAA or community research
- Direct answers (40-60 words each)

## Conclusion (~150 words)

- What the reader built/learned
- Specific next step CTA (not generic "subscribe")
```

**Word count:** ~2250 total

---

## Comparison Template

Best for evaluating alternatives. The reader is deciding between options.

```markdown
# [X vs Y: Specific Angle] OR [Which X Should You Choose?]

**Post type:** comparison
**Copywriting framework:** AIDA (recommended)
**Hook types that work well:** Question, Contrarian, Statistic

## Introduction (~200 words)

- Hook: acknowledge the reader's decision fatigue
- Context: what criteria actually matter (not feature checklists)
- Promise: honest comparison, not sponsored content

## [What Are X and Y? Quick Context for Each] (~250 words)

- Brief description of each option (not exhaustive -- readers likely know the basics)
- Answer-first block: 1-sentence positioning of each
- Featured snippet target: definition

## [What Features Does X Offer?] (~300 words)

- Key features of X with 1-sentence descriptions
- Group by category (editing, navigation, AI, collaboration, etc.)
- Note which features are unique to X vs shared with Y
- Table format preferred for scannability
- NOT an exhaustive feature dump -- focus on features that matter for the comparison angle

## [What Features Does Y Offer?] (~300 words)

- Same structure as above for Y
- Explicitly note feature parity with X where it exists
- Highlight unique capabilities

## [How Do X and Y Compare on Developer Experience?] (~400 words)

- Side-by-side code examples showing the same task in each
- Table comparing DX dimensions (setup time, learning curve, docs quality, community)
- Featured snippet target: table
- Let the code speak -- readers trust code over prose
- IMPORTANT: Do not frame shared capabilities as differentiators. If both tools can do multi-file edits, say so -- then explain how the experience differs. Focus on product + AI model integration quality, not just feature presence.

## [Which Handles [Key Use Case] Better?] (~400 words)

- Deep dive on the most important differentiator
- Real-world scenario, not abstract feature comparison
- Answer-first block: clear recommendation for this use case
- Mermaid diagram: yes (architecture comparison or decision flow)

## [What Are the Real Costs Beyond the Pricing Page?] (~300 words)

- Pricing tiers, hidden costs, scaling implications
- Developer time cost (DX overhead)
- Migration cost if switching later

## [When Should You Choose X Over Y?] (~250 words)

- Decision framework: "Choose X when..., Choose Y when..."
- Answer-first block: concise decision criteria
- Featured snippet target: list

## FAQ (~200 words)

- 3-4 questions from PAA
- Direct answers addressing common decision anxieties

## Conclusion (~150 words)

- Recommendation based on reader profile
- Specific CTA related to the recommended option
```

**Word count:** ~2750 total

---

## Explainer Template

Best for conceptual understanding. The reader wants to know what something is and why it matters.

```markdown
# [What Is X? Audience-Specific Qualifier]

**Post type:** explainer
**Copywriting framework:** PAS (recommended) or Before-After-Bridge
**Hook types that work well:** Bold Claim, Question, Problem

## Introduction (~200 words)

- Hook: why this concept matters NOW (not a dictionary definition)
- Context: what changes for the reader once they understand this
- Preview: what the post covers

## [What Is X in Plain Terms?] (~350 words)

- Core definition stripped of jargon
- Answer-first block: 40-60 word definition a non-expert could understand
- Featured snippet target: definition
- Analogy from everyday experience (not another tech analogy)

## [How Does X Work Under the Hood?] (~400 words)

- Technical mechanics for developers
- Mermaid diagram: yes (architecture or process flow)
- Code example showing X in action (not just theory)
- Answer-first block: technical summary

## [Why Does X Matter for [Audience]?] (~350 words)

- Practical implications and real-world impact
- Before/after scenario showing the difference X makes
- Data or benchmarks if available from research

## [What Are Common Misconceptions About X?] (~300 words)

- 3-4 myths debunked with evidence from research
- Answer-first block: quick myth-busting list
- Featured snippet target: list
- Source these from HN debates, SO misconceptions, LLM inaccuracies

## [How to Get Started with X] (~300 words)

- Practical first steps (not a full tutorial -- link to one)
- Minimal code example or setup instructions
- Resources for deeper learning

## FAQ (~200 words)

- 3-4 questions from PAA or community
- Direct answers

## Conclusion (~150 words)

- Key mental model to remember
- CTA: next learning step or resource
```

**Word count:** ~2250 total

---

## How-to Template

Best for solving a specific problem. Narrower scope than a tutorial -- one clear outcome.

```markdown
# [How to Solve Specific Problem]

**Post type:** how-to
**Copywriting framework:** PAS (recommended)
**Hook types that work well:** Problem, Story Start, Question

## Introduction (~150 words)

- Hook: the specific pain point (keep it tight -- readers want the answer fast)
- Context: when this problem occurs and why it's frustrating
- Promise: the fix, in under N minutes

## [Why Does This Problem Happen?] (~300 words)

- Root cause explanation (not just symptoms)
- Answer-first block: 40-60 word summary of the cause
- Code showing the problematic pattern if applicable

## [How to Fix X: Step-by-Step Solution] (~500 words)

- The primary solution with full code
- Each step explained
- Before/after code blocks
- Featured snippet target: list (numbered steps)
- This is the core section -- be thorough

## [What If the Standard Fix Doesn't Work?] (~300 words)

- Alternative approaches for edge cases
- Environment-specific variations
- Debugging tips from SO research
- Answer-first block: quick troubleshooting checklist

## [How to Prevent This Problem in the Future] (~250 words)

- Configuration or architectural changes
- Linting rules, testing strategies
- Best practices from official docs

## FAQ (~200 words)

- 2-3 closely related questions
- Direct answers

## Conclusion (~100 words)

- Quick recap of the solution
- CTA: related guide or tool
```

**Word count:** ~1800 total (how-to posts are intentionally shorter and more focused)

---

## Thought Leadership Template

Best for opinion, strategy, or prediction posts. The reader wants a perspective, not instructions.

```markdown
# [Contrarian Claim or Bold Prediction]

**Post type:** thought-leadership
**Copywriting framework:** PAS (recommended) or AIDA
**Hook types that work well:** Contrarian, Bold Claim, Story Start

## Introduction (~250 words)

- Hook: the contrarian or surprising claim upfront
- Context: what the conventional wisdom says and why it's incomplete
- Stakes: what's at risk if the reader follows the crowd

## [What Does Everyone Get Wrong About X?] (~400 words)

- Deconstruct the prevailing narrative
- Evidence from research (HN debates, expert opinions, data)
- Answer-first block: the core misconception in 40-60 words
- Be specific -- name the claim being challenged

## [What Does the Evidence Actually Show?] (~400 words)

- Data, examples, case studies supporting the contrarian view
- Code examples or benchmarks if applicable
- Mermaid diagram: optional (comparison or timeline)
- Featured snippet target: none (thought leadership targets engagement, not snippets)

## [What Should Developers Do Differently?] (~350 words)

- Practical implications of the new perspective
- Concrete action items, not vague advice
- Answer-first block: 3-5 specific recommendations

## [Where Is X Headed?] (~300 words)

- Prediction grounded in current trends
- What to watch for (signals that the prediction is playing out)
- Caveats and conditions under which the prediction fails

## Conclusion (~200 words)

- Restate the core thesis
- Challenge the reader to reconsider their current approach
- CTA: join the discussion, share their experience
```

**Word count:** ~1900 total (thought leadership is tighter -- every sentence must earn its place)

---

## Adapting Templates

These templates are defaults, not constraints. Common adaptations:

- **Merge sections** when two topics are closely related and separating them creates artificial breaks
- **Split sections** when a single section exceeds 500 words and covers distinct subtopics
- **Reorder sections** when the research suggests a different narrative flow (e.g., the "gotchas" section works better early for debugging-focused posts)
- **Drop sections** when the research doesn't support them (a how-to post may not need a "prevention" section if the problem is a one-time setup issue)
- **Add sections** when the research reveals a critical subtopic not covered by the template (e.g., a security section for an authentication tutorial)

Always preserve: Introduction, at least 3 body H2 sections, and Conclusion with CTA. Everything else is flexible.
