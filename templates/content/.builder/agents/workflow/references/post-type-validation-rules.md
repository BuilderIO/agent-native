# Post-Type Validation Rules

Lookup table for the Content Spec Analyzer agent. Each post type defines domain-specific checks that complement the universal checks (structural feasibility, artifact alignment, risk assessment) in the agent file.

## Tutorial / How-to

| Check                   | What to Validate                                                                                                                                                 | Severity if Failed | Example Issue                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| Step Sequence           | Prerequisites appear before use. Every tool, package, or concept mentioned in a step must be introduced in an earlier step (or listed in outline prerequisites). | Critical           | Step 3 uses `next/image` but the package import is in Step 5               |
| Code Example Adequacy   | Implementation sections plan at least one code example. Sections explaining configuration, setup, or behavior without planned code are flagged.                  | Important          | "Configure caching" section has no code example planned                    |
| Prerequisite Mapping    | Outline lists what readers need before starting (language version, framework, tools, prior knowledge).                                                           | Important          | Tutorial titled "beginner" but outline assumes React Router knowledge      |
| Reproducibility         | Steps form a complete chain from start to finish. No "then configure X" without specifying how.                                                                  | Important          | Step 4 says "set up your database" with no sub-steps or code planned       |
| Environment Assumptions | Outline specifies or implies a single environment (e.g., Node 20, Next.js 15). Conflicting version references across sections are flagged.                       | Minor              | Section 2 references Next.js 14 APIs, Section 5 references Next.js 15 APIs |

## Comparison

| Check                         | What to Validate                                                                                                                                                          | Severity if Failed | Example Issue                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Fairness Balance              | Each compared subject gets at least 70% of the word count allocated to the most-covered subject. Measure by counting planned sections and their word budgets per subject. | Critical           | Tool A gets 4 dedicated sections (1,200 words), Tool B gets 1 section (300 words)                                                             |
| Comparison Dimension Coverage | All decision factors relevant to the audience are addressed: at minimum, DX/API, performance, pricing, ecosystem/community, and learning curve.                           | Important          | Outline compares features and pricing but omits community size and learning curve                                                             |
| Feature Parity                | Comparing the same (current) versions. Outline should reference specific versions.                                                                                        | Important          | Comparing Tool A v3 (current) against Tool B v1 (deprecated, v2 is current)                                                                   |
| Factual Claims Inventory      | Every feature capability claim about a compared tool is tagged for verification. Claims flow to the verification checklist.                                               | Important          | "Tool A supports streaming SSR" -- needs verification against current docs                                                                    |
| Contrastive Pattern Risk      | Comparison posts naturally produce "but", "however", "unlike", "lacks" patterns that trigger AI-voice detection. Flag as an advisory (not blocking).                      | Minor              | Advisory: comparison structure will produce contrastive patterns; prime editor to distinguish real comparison language from AI-voice patterns |

## Explainer

| Check               | What to Validate                                                                                                                                            | Severity if Failed | Example Issue                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| Definition Clarity  | Answer-first blocks under definition headings can stand alone as complete answers (40-60 words, no forward references to later sections).                   | Important          | Answer-first block for "What is SSR?" says "as we'll see in the next section"             |
| Example Sufficiency | At least 3 concrete examples planned across the outline (code snippets, real-world scenarios, analogies). Pure abstract theory without examples is flagged. | Important          | 6-section explainer with only 1 code example planned                                      |
| Depth Consistency   | Sections should be at roughly the same conceptual level. Mixing ELI5 explanations with PhD-level detail in adjacent sections is flagged.                    | Minor              | Section 2 explains "what a function is" while Section 4 dives into compiler optimizations |
| Analogy Freshness   | If the outline uses common/overused analogies (e.g., "like a recipe"), flag as minor.                                                                       | Minor              | "Think of React components like Lego blocks" -- overused analogy                          |

## Thought Leadership

| Check                     | What to Validate                                                                                                                                                   | Severity if Failed | Example Issue                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------- |
| Claim Support             | Every major assertion or opinion in the outline has a corresponding research finding or data point in the research artifacts. Unsupported predictions are flagged. | Critical           | Outline claims "monorepos will replace polyrepos by 2027" with no supporting research |
| Prediction Grounding      | Forecasts or trend predictions reference at least one data point (benchmark, survey, adoption metric).                                                             | Important          | "AI will replace 80% of frontend development" with no evidence cited                  |
| Author Credibility Signal | Outline includes at least one section drawing on first-person experience or specific project examples. Pure punditry without lived experience is weaker.           | Minor              | All 5 sections are abstract opinions with no personal experience references           |

## Universal Checks (All Post Types)

These checks apply regardless of post type. They are defined in the agent file but documented here for completeness.

| Check                              | What to Validate                                                                                                                                                      | Severity if Failed        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Outline-to-Research Alignment      | Each outline section references at least one research finding. Sections with no research backing are flagged.                                                         | Important                 |
| Word Budget Feasibility            | Section scope (number of sub-topics, key points) is achievable within the allocated word count. 3+ sub-topics in <200 words is infeasible.                            | Important                 |
| Competitive Word Count Feasibility | Total word count target aligns with SERP competitive range and seed keyword density requirements.                                                                     | Important (cross-cutting) |
| Content Goal Compliance            | Builder.io integration placement matches the content goal (none for awareness, section/integrated for acquisition, CTA-only for hybrid).                              | Critical                  |
| AEO Heading-to-PAA Mapping         | Question-form headings semantically match the PAA questions they claim to address (not just keyword overlap).                                                         | Important                 |
| Audience Alignment                 | Outline depth matches stated skill level. "Beginner" content shouldn't assume framework-specific knowledge.                                                           | Important                 |
| Seed File Coverage                 | High-priority keywords from `seed/keywords.txt` appear in headings or section key points. AI search queries from `seed/ai-search.txt` map to headings or FAQ entries. | Important                 |
| Heading-to-Keyword Cross-Reference | H2/H3 headings include high-priority seed keywords (not just question-form AEO variants).                                                                             | Minor                     |
