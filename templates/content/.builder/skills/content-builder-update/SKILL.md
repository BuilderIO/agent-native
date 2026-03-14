---
name: content-builder-update
description: "Updates Builder.io product knowledge, persona, messaging, or competitive intelligence skills from new information. Use when the user mentions new Builder.io features, updated positioning, competitive changes, or wants to refresh product knowledge."
---

# Update Builder.io Knowledge

Update any of the 4 builder knowledge skills when new features ship, positioning changes, personas evolve, competitive landscape shifts, or a blog post reveals a gap. This keeps acquisition and hybrid posts accurate and current.

**Skills this command can update:**

- `builder-product-knowledge` -- capabilities, topic mapping, CTAs, integration patterns, positioning playbook
- `builder-persona-knowledge` -- buyer personas, recognition signals, objection handling
- `builder-messaging` -- messaging pillars, strategic narrative, category definition
- `builder-competitor-knowledge` -- competitive positioning, competitor profiles, proof points

## Input

<input> $ARGUMENTS </input>

**If the input above is empty, ask the user:** "What Builder.io knowledge do you want to update? You can provide:

1. Free text describing a product update, persona insight, messaging change, or competitive intelligence
2. A URL to a Builder.io blog post, changelog, or docs page
3. `--from-post output/posts/YYYY-MM-DD-topic-slug/` to extract knowledge from a successful post"

Do not proceed until you have input from the user.

## Input Validation

Determine the input type and extract information:

### Free text

The input describes knowledge directly. Proceed to Step 1.

### URL

1. **WebFetch** the URL
2. Extract relevant information: feature names, persona insights, competitive positioning, messaging changes
3. Present extracted findings to the user for confirmation: "I found these updates in the page: [list]. Correct?"
4. If the user corrects or adds detail, update before proceeding

### --from-post [path]

1. Read `post.md` and `metadata.yaml` from the output folder
2. Read `phases/01-topic-validation.yaml` for `positioning_context`, `builder_capability`, `integration_pattern`, `messaging_pillar`
3. Extract knowledge from the post:
   - **Product**: How Builder.io was positioned, which capability was highlighted → `topic-positioning-playbook.md`
   - **Persona**: Reader persona signals and how they responded to the positioning → relevant persona reference file
   - **Competitive**: Any competitive comparisons made and their effectiveness → relevant competitor reference file
4. Present all extracted knowledge to the user. Not every post produces insights for all skills.

---

## Step 1: Classify and Load

Classify the update type from the input, then load ONLY the target skill and file. Do not load all 4 skills upfront.

| Update Type                                                            | Target Skill                 | Target File                                                            |
| ---------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| New/updated capability                                                 | builder-product-knowledge    | `references/builder-capabilities.md`                                   |
| New topic category                                                     | builder-product-knowledge    | `SKILL.md` (Topic-to-Capability Mapping)                               |
| New CTA template                                                       | builder-product-knowledge    | `SKILL.md` (CTA Templates)                                             |
| Positioning example                                                    | builder-product-knowledge    | `references/topic-positioning-playbook.md`                             |
| Persona update (signals, objections, discovery questions)              | builder-persona-knowledge    | Relevant persona reference file                                        |
| Messaging update (pillar, narrative, category)                         | builder-messaging            | `references/messaging-house.md` or `references/strategic-narrative.md` |
| Competitor intelligence (new competitor, updated profile, proof point) | builder-competitor-knowledge | Relevant category reference file                                       |

For `--from-post` input, multiple update types may apply. Classify each extracted insight independently and load each target file as needed.

**Load the target skill's SKILL.md** to understand the current structure, then **read only the target file** for the specific update.

## Step 2: Branding Check

Every update must pass branding rules before proceeding:

- Reject any update that refers to "Fusion" as the external product name (internal codename only)
- Reject any update that positions Builder.io primarily as a "headless CMS" (legacy product Publish)
- Reject any update that uses "Visual Copilot" as a standalone product (absorbed into Builder.io)
- Reject any update that uses "AI Product Development" as the category (use "Agentic Development Platform")
- Flag language inconsistent with branding rules

**If branding violation detected:** Inform the user and suggest corrected language. Do not proceed until corrected.

## Step 3: Conflict Detection

Check for conflicts with existing knowledge:

**Capability conflict:** If a capability already exists but the description differs:

- Present old vs. new description
- Ask: "The description for [capability] differs from what's currently documented. Which version is correct?"
- Options: Keep existing, Use new, Merge both

**Persona conflict:** If a persona insight contradicts an existing recognition signal or objection:

- Present the conflict
- Ask: "This insight conflicts with existing persona knowledge. Which is more current?"

**Competitive conflict:** If competitor positioning has changed:

- Present old vs. new positioning
- Ask: "This competitor intelligence differs from existing data. Update?"

## Step 4: Approval Gate

Present all proposed changes using **AskUserQuestion**:

**Question:** "Here are the proposed updates to Builder.io knowledge. Approve?"

Show each change with:

- Target skill and file
- What will change (add/modify/replace)
- The full text of the change

**Options:**

1. **Approve all** -- Apply all changes
2. **Approve some** -- Select which changes to apply
3. **Edit** -- Modify wording before applying
4. **Cancel** -- Discard all changes

Do not write any files without explicit approval.

## Step 5: Apply Changes

Write the approved changes to the appropriate files, following the format conventions of each target file:

**Product knowledge files:** Follow existing section formats in builder-capabilities.md, Topic-to-Capability Mapping table, CTA template tables, and positioning playbook entry format.

**Persona files:** Follow the existing persona reference format (recognition signals, discovery questions, objection handling sections).

**Messaging files:** Follow the messaging-house.md and strategic-narrative.md formats. Preserve pillar structure.

**Competitor files:** Follow the existing category reference format (competitor profiles, proof points, switching stories).

---

## Completion

After applying changes, present a dynamic summary:

```
Builder.io knowledge updated!

Changes applied:
- [skill]/[file]: [what changed]
- [skill]/[file]: [what changed]

Updated files:
- .builder/skills/[skill-name]/[file-path]
```

### Next Steps

Use **AskUserQuestion**:

**Question:** "Knowledge updated. What's next?"

**Options:**

1. **Add more updates** -- Continue updating knowledge
2. **View changes** -- Read the updated files
3. **Done** -- Finish

If the user selects "Add more updates," loop back to the input step.

---

## Integration with /content-compound

When `/content-compound` captures a learning, it may suggest updates to any of the 4 builder skills:

- `problem_type: keyword_gap` or new `positioning_context` → update product knowledge
- Persona insights from reader engagement → update persona knowledge
- Competitive comparisons that worked well → update competitor knowledge
- Messaging pillar alignment discoveries → update messaging

> "This post required knowledge that wasn't in the builder skills. Run `/content-builder-update` to add it?"

This creates a virtuous cycle: write a post → discover a knowledge gap → update the relevant skill → next post is better informed.

## Examples

### Example 1: New capability from a blog post URL

```
/content-builder-update https://www.builder.io/blog/mcp-custom-servers
```

1. WebFetch the URL
2. Extract: "Builder.io now supports custom MCP servers for enterprise customers"
3. Classify: new capability → target: builder-product-knowledge / builder-capabilities.md
4. Load builder-product-knowledge SKILL.md + builder-capabilities.md
5. Branding check: passes
6. Add to builder-capabilities.md under MCP Server Integrations
7. Present for approval
8. Apply

### Example 2: Persona insight from a successful post

```
/content-builder-update --from-post output/posts/2026-02-15-react-server-components/
```

1. Read post and phase artifacts
2. Extract: topic positioned Builder.io's parallel agents for RSC builds (product), developer persona responded well to "no git worktree hacks" messaging (persona)
3. Classify: positioning example → topic-positioning-playbook.md; persona signal → engineering-leaders.md
4. Load and update each target file
5. Present for approval
6. Apply

### Example 3: Competitive intelligence update

```
/content-builder-update "Cursor just launched multi-agent mode with 3 parallel agents"
```

1. Classify: competitor intelligence → target: builder-competitor-knowledge / ai-ides.md
2. Load builder-competitor-knowledge SKILL.md + ai-ides.md
3. Branding check: passes
4. Update Cursor section with new capability, adjust differentiation messaging
5. Present for approval
6. Apply

## Important Notes

- This command modifies project skill files directly. These changes affect all future content generation sessions.
- Branding enforcement is non-negotiable. The branding check runs before any other processing.
- The classify-then-load pattern keeps context lean. Most updates touch 1 skill and 1 file.
- The `--from-post` input is the most valuable for compounding: it captures what actually worked in a real post.
- Capability descriptions should be factual and current. Remove outdated information rather than keeping "was previously" notes.
- The approval gate is critical because knowledge directly shapes how Builder.io appears in acquisition posts.
