# Writing Patterns Reference

Hook formulas, CTA templates, anti-patterns, paragraph rhythm rules, Builder.io integration patterns, and power words for blog drafting.

## Hook Formulas

Six hook types with DevRel examples. Match the hook type selected in the outline (Phase 5).

### Bold Claim

Open with a surprising, research-backed statement that challenges assumptions.

**Pattern:** `[Surprising fact or strong opinion about the topic.]`

**Examples:**

- "React Server Components make 90% of your client-side state management unnecessary."
- "Most performance optimization guides skip the one thing that actually matters: your bundler configuration."

**Best for:** Topics with strong research backing, surprising benchmarks, counterintuitive findings.

### Story Start

Open with a brief personal experience that the reader recognizes.

**Pattern:** `[Specific moment of frustration or discovery. 1-2 sentences max.]`

**Examples:**

- "Last week, I spent 3 hours debugging a hydration error that shouldn't have existed."
- "I shipped a 2MB JavaScript bundle to production. On purpose. Here's why."

**Best for:** Debugging topics, migration stories, "lessons learned" angles.

### Contrarian

Open by going against popular opinion, backed by evidence from research.

**Pattern:** `[Everyone thinks X. But Y.]`

**Examples:**

- "Everyone's excited about Server Components, but most tutorials are teaching them wrong."
- "The best React state management library in 2026 is the one you don't install."

**Best for:** Topics with strong community consensus that research challenges.

### Question

Open with a question the reader has actually asked (sourced from PAA, HN, or Stack Overflow).

**Pattern:** `[What if / What happens when / Have you noticed + specific scenario?]`

**Examples:**

- "What if your React components could fetch their own data without useEffect?"
- "What happens to your app's performance when you remove 60% of your client-side JavaScript?"

**Best for:** Explainer posts, topics where the reader is evaluating options.

### Statistic

Open with hard data -- a benchmark, adoption number, or performance metric.

**Pattern:** `[Specific number + what it means for the reader.]`

**Examples:**

- "Pages using Server Components load 40% faster on average -- but only if you avoid three common mistakes."
- "72% of developers say they've considered switching to a headless CMS. Most haven't because of one concern."

**Best for:** Performance topics, adoption/trend topics, comparison posts.

### Problem

Open with a universal pain point the reader immediately recognizes.

**Pattern:** `[Describe the problem in concrete terms. No setup needed -- the reader already lives this.]`

**Examples:**

- "Every React app eventually hits the waterfall problem -- fetch parent, wait, fetch child, wait."
- "Your marketing team wants to update a headline. That change sits in a Jira ticket for two weeks."

**Best for:** How-to posts, tool/framework introductions, before/after narratives.

---

## Anti-Patterns

### Openings to Avoid

These patterns signal AI-generated or generic content. Never use them.

| Pattern                                                 | Why It Fails                                                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "In this article, we will explore..."                   | Tells instead of showing. No hook.                                                                                                                                                |
| "Have you ever wondered...?"                            | Rhetorical filler. The reader didn't come to wonder.                                                                                                                              |
| "In today's digital age..."                             | Generic. Could open any article from 2015 to 2026.                                                                                                                                |
| "When it comes to [topic]..."                           | Throat-clearing. Delete and start with the next sentence.                                                                                                                         |
| "In today's rapidly evolving landscape..."              | AI giveaway. Means nothing.                                                                                                                                                       |
| "[Topic] has become increasingly important..."          | Vague. Say why and for whom.                                                                                                                                                      |
| "Let's dive into..."                                    | Filler. Just start explaining.                                                                                                                                                    |
| "Whether you're a beginner or experienced developer..." | Trying to please everyone. Pick an audience.                                                                                                                                      |
| "The best developers use both X and Y"                  | Reveals the conclusion in the intro. The author's recommendation is the payoff -- tease the decision, save the answer for the conclusion. Especially deadly for comparison posts. |

### Endings to Avoid

| Pattern                                | Why It Fails                                            |
| -------------------------------------- | ------------------------------------------------------- |
| "In conclusion..."                     | The reader knows it's the conclusion.                   |
| "By understanding [X], you can [Y]..." | Generic summary. Restate the specific takeaway instead. |
| "The future of [X] is exciting..."     | Empty optimism. Say what's actually changing.           |
| "Only time will tell..."               | Non-committal. Take a position.                         |
| "Happy coding!"                        | Filler sign-off. End with a specific next step.         |
| "I hope this article was helpful..."   | Breaks confidence. End with action.                     |

---

## CTA Templates by Content Goal

### Awareness CTAs

The CTA connects to the topic, not to Builder.io. Point the reader to the next logical step.

**Patterns:**

- "Clone the starter repo and try [specific thing from the post] yourself: [link]"
- "The [framework] docs cover [related advanced topic] in depth: [link]"
- "Star the repo if [specific feature discussed] solves a problem you've hit: [link]"

**Rules:**

- Must reference something specific from the post
- Must point to an external resource (repo, docs, tool)
- No product pitch

### Acquisition CTAs

The CTA connects the post's topic to a specific Builder.io capability.

**Patterns:**

- "If you're building [specific thing from post], Builder.io's [specific feature] handles [specific problem discussed]. Try it: [link]"
- "The [workflow/problem] we walked through gets simpler with Builder.io's [feature]. Here's a 5-minute setup: [link]"
- "See the [specific code/workflow from post] running with Builder.io: [link]"

**Rules:**

- Must connect to the specific topic -- not a generic Builder.io pitch
- Reference the `builder_capability` from Phase 1 output
- Link to a specific feature page or quickstart, not the homepage
- One CTA. Not three.

### Hybrid CTAs

The post is educational first. The CTA is a natural bridge at the end.

**Patterns:**

- "Start with the approach above. If you need [specific capability discussed], Builder.io's [feature] handles it: [link]"
- "For teams where [problem from post] keeps coming up, Builder.io's [feature] is worth a look: [link]"

**Rules:**

- Placed at the very end of the conclusion
- One sentence. Two max.
- The post must read as complete without the CTA

---

## Builder.io Integration Patterns

Ranked by authenticity (most natural first). The `integration_pattern` from Phase 1 output determines which pattern to use.

### 1. Product Showcase (`product-showcase`)

The content naturally demonstrates Builder.io as the tool being used. Product mention is organic because Builder.io IS the subject.

**When:** The topic directly involves Builder.io functionality.
**How:** Builder.io capabilities, setup steps, and workflows appear as the main content.
**Risk:** Low -- the product mention is inherently organic.

### 2. Before/After (`before-after`)

Show the developer/marketer workflow problem, then the improved workflow with Builder.io.

**When:** Topics about content workflows, dev-marketer handoffs, CMS evaluation.
**How:** Dedicated section showing the pain point workflow and the Builder.io workflow side by side.
**Risk:** Medium -- make the "before" genuinely painful and the "after" genuinely better. Do not exaggerate.

### 3. Honest Comparison (`honest-comparison`)

Acknowledge competitor strengths while showing Builder.io's differentiators.

**When:** Comparison posts, "which tool should I use" topics.
**How:** Feature comparison table with honest assessments. Builder.io wins some, loses some. Highlight the specific differentiators (visual editing, framework support).
**Risk:** Medium -- must not read as a biased comparison. Acknowledge where competitors are stronger.

### 4. Problem-Solution (`problem-solution`)

Lead with the audience's pain point, then show how Builder.io solves it specifically. Not generic -- the solution must connect to the problem discussed.

**When:** Topics where the reader has a clear pain point that Builder.io addresses directly.
**How:** Open the section with the problem (concrete, recognizable). Follow with how Builder.io solves it (specific mechanism, not marketing). Include evidence.
**Risk:** Medium -- the problem must be real and the solution must be specific. Generic "Builder.io solves this" reads as an ad.

### 5. Light CTA Only (`light-cta-only`)

One specific line at the end connecting the post's topic to Builder.io. Placed at the end or in a sidebar.

**When:** Content has only tangential Builder.io relevance. Default for educational or hybrid content.
**How:** Single sentence in the conclusion. See Hybrid CTA templates above.
**Risk:** Low -- minimal and specific.

---

## Paragraph Rhythm

### Rules

1. **1-3 sentences per paragraph.** Four sentences is the hard max. If a paragraph hits 5+, split it.
2. **Vary sentence length.** Mix 5-word punches with 25-30 word explanations. Three sentences of the same length in a row creates monotony.
3. **Use sentence fragments.** Occasionally. For emphasis. (Like this.)
4. **Vary paragraph openers.** Not every paragraph should start with a topic sentence. Start some with:
   - A code snippet
   - A question
   - An example
   - A short declarative statement
   - A transition word ("But", "Here's the thing", "That said")
5. **Break before code blocks.** The paragraph before a code block should set up what the code does. The paragraph after should explain what happened. Never put a code block in the middle of a paragraph's thought.
6. **One idea per paragraph.** If you're explaining two things, that's two paragraphs.

### Rhythm Example

> Server Components run on the server. Only the rendered output ships to the client.
>
> That sounds simple. It isn't.
>
> The tricky part is knowing which components should be server components and which need to stay on the client. Here's the rule of thumb: if a component uses `useState`, `useEffect`, or browser APIs, it's a client component. Everything else can be a server component.
>
> ```jsx
> // This is a server component by default in Next.js 14+
> async function UserProfile({ id }) {
>   const user = await db.users.find(id);
>   return <div>{user.name}</div>;
> }
> ```
>
> No `useEffect`. No loading state. No error boundary for the fetch. The data is already there when the component renders.

---

## Code Example Formatting

### Rules

1. **Every tutorial and how-to must include runnable code.** Explainers should include code when it clarifies the concept.
2. **Show problem, then solution.** When demonstrating a better approach, show the problematic code first (briefly), then the improved version. Label each clearly.
3. **Add comments only where the logic isn't obvious.** Do not comment every line. Comment the "why", not the "what".
4. **Use realistic variable names.** Not `foo`, `bar`, `myComponent`. Use names from the post's domain (`userProfile`, `productCard`, `searchResults`).
5. **Keep examples short.** 5-15 lines ideal. 25 lines max unless the tutorial requires a longer block. If longer, break into multiple blocks with explanation between.
6. **Include the language identifier in fenced code blocks.** Always: ` ```jsx `, ` ```typescript `, ` ```bash `. Never bare ` ``` `.
7. **Show output when helpful.** If the code produces visible output (console log, rendered HTML, terminal output), show it in a separate block.

### Problem-Then-Solution Format

```jsx
// The waterfall problem
function UserDashboard() {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState(null);

  useEffect(() => {
    fetchUser().then((u) => {
      setUser(u);
      fetchPosts(u.id).then(setPosts); // waits for user first
    });
  }, []);
}
```

```jsx
// Server component: both fetches run on the server, no waterfall
async function UserDashboard({ userId }) {
  const [user, posts] = await Promise.all([
    fetchUser(userId),
    fetchPosts(userId),
  ]);

  return <Dashboard user={user} posts={posts} />;
}
```

---

## Specificity Rules

Generic language weakens every element. Apply specificity to titles, hooks, claims, and CTAs.

| Generic               | Specific                                     |
| --------------------- | -------------------------------------------- |
| "improve performance" | "cut bundle size by 40%"                     |
| "a popular framework" | "Next.js 15"                                 |
| "many developers"     | "72% of React developers (State of JS 2025)" |
| "faster load times"   | "1.2s → 0.4s Time to Interactive"            |
| "a headless CMS"      | "Builder.io's Visual Editor"                 |
| "some issues"         | "three hydration errors in production"       |
| "best practices"      | "the preload pattern from React docs"        |
| "recently"            | "since Next.js 15 shipped in October 2025"   |

**Rules:**

- Use exact numbers, not rounded ones. "37% faster" beats "about 40% faster."
- Name specific tools, frameworks, and versions.
- Cite specific sources when making claims.
- Replace "best practices" with the actual practice.

---

## Power Words

Use sparingly. 1-2 per section maximum. Overuse creates the opposite effect.

| Category    | Words                                                       |
| ----------- | ----------------------------------------------------------- |
| Urgency     | now, before, deadline, breaking, immediate                  |
| Exclusivity | only, first, insider, early, limited                        |
| Value       | free, save, essential, proven, guaranteed                   |
| Emotion     | frustrated, painful, finally, relief, breakthrough          |
| Results     | shipped, measured, benchmarked, tested, verified            |
| Specificity | exactly, step-by-step, complete, line-by-line, from scratch |
