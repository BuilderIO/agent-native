# Heading Transformation Patterns

Patterns for converting declarative headings into question-based headings optimized for AI/LLM citation. Use during outline creation (Phase 5) and verify during AEO optimization (Phase 9).

## 7 Transformation Patterns

| #   | Pattern                 | Before                     | After                                                      |
| --- | ----------------------- | -------------------------- | ---------------------------------------------------------- |
| 1   | "What is/are..."        | Server Components Overview | What Are React Server Components?                          |
| 2   | "How do/does..."        | Data Fetching Mechanism    | How Do Server Components Fetch Data?                       |
| 3   | "What are the..."       | Benefits of RSC            | What Are the Benefits of Server Components?                |
| 4   | "Which/What is best..." | RSC vs SSR Comparison      | Which Approach Is Better: RSC or Traditional SSR?          |
| 5   | "When do/should you..." | Adoption Timing            | When Should You Migrate to Server Components?              |
| 6   | "Why is/does..."        | RSC Performance            | Why Are Server Components Faster Than Client Components?   |
| 7   | "How can/do I..."       | Getting Started            | How Do I Add Server Components to an Existing Next.js App? |

### Pattern Selection Guide

| Topic Angle           | Best Patterns                                | Reason                                                |
| --------------------- | -------------------------------------------- | ----------------------------------------------------- |
| Concept introduction  | #1 "What is..."                              | Matches definitional queries AI assistants field most |
| Implementation guide  | #2 "How do..." or #7 "How can I..."          | Matches how-to queries                                |
| Evaluation / decision | #4 "Which is best..." or #5 "When should..." | Matches comparison and decision queries               |
| Deep dive / reasoning | #6 "Why is/does..."                          | Matches explanatory queries                           |
| Benefits / trade-offs | #3 "What are the..."                         | Matches list-oriented queries                         |

### Variety Rule

Do not use the same pattern for more than 2 headings in a single post. Mix patterns to match natural query diversity. A typical 5-section post should use at least 3 different patterns.

**Bad (repetitive):**

- How Do Server Components Work?
- How Do You Fetch Data in Server Components?
- How Do You Handle Client Interactivity?

**Good (varied):**

- What Are React Server Components?
- How Do Server Components Fetch Data?
- When Should You Use Client Components Instead?

## 3 Specificity Enhancers

Generic question headings compete with every other article on the topic. Specificity enhancers narrow the heading to match the exact query an AI assistant receives.

### 1. Target User/Team Type

Add the audience to narrow the question.

| Generic                           | Enhanced                                                  |
| --------------------------------- | --------------------------------------------------------- |
| What is a headless CMS?           | What Is a Headless CMS for Marketing Teams?               |
| How do you test React components? | How Do Frontend Engineers Test React Components at Scale? |
| When should you use TypeScript?   | When Should Solo Developers Switch to TypeScript?         |

### 2. Tool/Integration Context

Add the specific tool, version, or framework.

| Generic                        | Enhanced                                           |
| ------------------------------ | -------------------------------------------------- |
| How do you implement RSC?      | How Do You Implement RSC in Next.js 15?            |
| What is server-side rendering? | What Is Server-Side Rendering in Astro vs Next.js? |
| How do you set up a CMS?       | How Do You Set Up Builder.io with a React App?     |

### 3. Use Case/Scenario

Add the specific problem or scenario.

| Generic                                | Enhanced                                                           |
| -------------------------------------- | ------------------------------------------------------------------ |
| When should you use RSC?               | When Should You Use RSC for E-Commerce Pages?                      |
| What are the benefits of headless CMS? | What Are the Benefits of Headless CMS for Multi-Brand Sites?       |
| How do you handle authentication?      | How Do You Handle Authentication in a Micro-Frontend Architecture? |

### Combining Enhancers

Use at most 1-2 enhancers per heading. More than 2 makes headings too long (violates the 80-char max).

**Good (1 enhancer):** How Do You Implement RSC in Next.js 15? (tool context)
**Good (2 enhancers):** When Should React Teams Migrate to Server Components for Data-Heavy Apps? (user type + use case)
**Bad (3 enhancers, too long):** How Do Enterprise Frontend Teams Implement Server Components in Next.js 15 for E-Commerce? (94 chars)

## Headings to Keep As-Is

Do NOT transform these into questions. They serve structural or navigational purposes and question form makes them awkward.

| Heading         | Reason                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Prerequisites   | Setup section, not a query                                                                               |
| Requirements    | Setup section, not a query                                                                               |
| TL;DR           | Summary anchor, recognized format                                                                        |
| FAQ             | Section label, individual questions inside are already questions                                         |
| References      | Bibliography, not a query                                                                                |
| Acknowledgments | Credits, not a query                                                                                     |
| Getting Started | Acceptable as-is for introductory sections; can optionally transform to "How Do I Get Started with [X]?" |
| Conclusion      | Wrap-up, not a query                                                                                     |

## Character Limits

| Range          | Guidance                                                                     |
| -------------- | ---------------------------------------------------------------------------- |
| 40-70 chars    | Ideal. Concise enough for AI extraction, specific enough for query matching. |
| 71-80 chars    | Acceptable. Review for tightening opportunities.                             |
| 81+ chars      | Too long. Shorten by removing filler words or reducing enhancer count.       |
| Under 40 chars | May be too vague. Consider adding a specificity enhancer.                    |

### Tightening Techniques

| Technique                           | Before (82 chars)                        | After (62 chars)                |
| ----------------------------------- | ---------------------------------------- | ------------------------------- |
| Remove "really", "actually", "just" | How Do You Actually Handle State in RSC? | How Do You Handle State in RSC? |
| Use abbreviations readers know      | How Do You Use React Server Components?  | How Do You Use RSC in Next.js?  |
| Drop implied words                  | What Are the Main Benefits of Using RSC? | What Are the Benefits of RSC?   |
| Shorten question opener             | What Is It That Makes RSC Fast?          | Why Are RSC Fast?               |

## Common Mistakes

### 1. Transforming Every Heading

Not every heading needs to be a question. Structural headings (Prerequisites, TL;DR), code-heavy sections, and very short transitional sections are fine as declarative headings. Target 60-80% question headings in the body, not 100%.

### 2. Repeating the Same Pattern

Starting every heading with "How" is monotonous and signals formulaic content to both readers and AI systems. Use at least 3 different question patterns per post.

### 3. Excessive Length

Headings over 80 characters get truncated in some AI citation formats and lose impact. If a heading needs 2 specificity enhancers, cut filler words first.

### 4. Losing the Primary Keyword

At least 2 H2 headings should contain the primary keyword or a close variation. Do not sacrifice keyword presence for question form. "What Is RSC?" is weaker than "What Are React Server Components?" for the keyword "React Server Components".

### 5. Forced Questions

Some sections are genuinely better as statements. A code walkthrough section titled "Implementation" is fine. Forcing it into "How Do You Implement This Step by Step?" adds no value if the section is already clearly a step-by-step walkthrough.

## Quote-Ready Blocks

Content that AI assistants can extract and cite without needing surrounding context. Each H2 section should produce at least one quote-ready block.

### Block Types

| Type             | Format                                                       | Best For                                 |
| ---------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Definition block | 40-60 word paragraph directly answering the heading question | Concept explanations, "What is" sections |
| Step list        | Numbered list with action-verb items                         | Tutorials, how-to sections               |
| Comparison table | 3+ row table with clear headers                              | Versus sections, feature comparisons     |
| Code snippet     | Complete, runnable code with language identifier             | Implementation sections                  |
| Key insight      | Bold-prefixed single sentence with supporting detail         | Trade-off discussions, "Why" sections    |

### What Makes a Block "Quote-Ready"

1. **Self-contained** -- Reads coherently without the paragraph before or after it
2. **Specific** -- Contains concrete details (numbers, tool names, versions), not vague generalities
3. **Concise** -- Under 80 words for text blocks. AI assistants truncate longer extractions.
4. **Factually complete** -- Does not rely on pronouns referring to earlier content ("this", "it", "the above")
5. **Structured** -- Uses a recognizable format (definition, list, table) that AI systems can parse

### Example: Before and After

**Before (not quote-ready):**

> As mentioned earlier, this approach has several advantages. It's faster and it reduces the bundle size significantly. You should consider using it when building data-heavy applications.

**After (quote-ready):**

> React Server Components reduce client JavaScript bundle size by rendering components on the server. Data-heavy pages load faster because data fetching happens server-side, eliminating client-side waterfalls. Use Server Components for any component that reads from a database or API but does not need browser interactivity.

The "after" version works as a standalone citation. The "before" version requires context to understand what "this approach" and "it" refer to.

## Platform-Specific Citation Patterns

Different AI platforms have different content preferences. Optimize for all three, but understand the differences.

### ChatGPT

- **Favors:** Authoritative, encyclopedic content with context alongside facts
- **Citation style:** Weaves information from multiple sources into a synthesized answer
- **Optimize for:** Comprehensive definitions, balanced analysis, clear structure with H2 question headings
- **Key signal:** Domain authority and content depth

### Perplexity

- **Favors:** Community-driven content, fresh content updated within days, Q&A format, step-by-step guides
- **Citation style:** Shows individual source cards with direct quotes
- **Optimize for:** Specific, recent data points; numbered lists; FAQ sections; update timestamps
- **Key signal:** Recency and specificity. Reddit is 6.6% of Perplexity citations -- community discussion signals matter.

### Google AI Overviews

- **Favors:** Balanced sourcing across platforms, content that matches the featured snippet format
- **Citation style:** Highlights specific passages from top-ranking pages
- **Optimize for:** Featured snippet formatting (definition blocks, ordered lists, tables), E-E-A-T signals, matching the dominant SERP format
- **Key signal:** Traditional SEO ranking factors plus structured content

### Cross-Platform Optimization Checklist

| Element             | ChatGPT                | Perplexity         | Google AI Overviews   |
| ------------------- | ---------------------- | ------------------ | --------------------- |
| Question headings   | High value             | High value         | High value            |
| Answer-first blocks | Essential              | Essential          | Essential             |
| FAQ section         | Moderate               | High (Q&A format)  | High (FAQ schema)     |
| Code examples       | Moderate               | High (specificity) | Moderate              |
| Tables              | High (structured data) | High (comparison)  | High (snippet target) |
| Recency signals     | Low                    | Essential          | Moderate              |
| Author authority    | High                   | Moderate           | High (E-E-A-T)        |

## Business Impact Data

From the Graphite/Webflow AEO case study:

- **58%** AI visits uplift after AEO optimization
- **94%** share of voice growth in AI responses
- **24%** LLM traffic signup conversion rate (vs 4% from non-brand SEO)
- Content structured as quote-ready blocks appears in **34% more** LLM responses

These numbers demonstrate that AEO is not a marginal optimization -- it is a high-ROI activity that directly drives conversions, especially for developer tools content where AI assistants are a primary information source.
