import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "what-are-skills", label: "What Are Skills" },
  { id: "framework-skills", label: "Framework Skills" },
  { id: "domain-skills", label: "Domain Skills" },
  { id: "creating-skills", label: "Creating Custom Skills" },
  { id: "skill-format", label: "Skill Format" },
  { id: "skills-vs-agents-md", label: "Skills vs AGENTS.md" },
];

export const meta = () => [
  { title: "Skills Guide — Agent-Native" },
  {
    name: "description",
    content:
      "How skills work in agent-native: framework skills, domain skills, and creating custom skills.",
  },
];

export default function SkillsGuideDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Skills Guide
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Skills are Markdown files that give the agent deep knowledge about
        specific patterns and workflows.
      </p>

      <h2 id="what-are-skills">What are skills</h2>
      <p>
        Skills live at <code>.agents/skills/&lt;name&gt;/SKILL.md</code> and
        contain detailed guidance for the agent. Each skill focuses on one
        concern — how to store data, how to sync state, how to delegate work to
        the agent chat.
      </p>
      <p>
        The agent reads skills when it needs to follow a specific pattern.
        Skills are referenced in <code>AGENTS.md</code> and triggered by the
        agent's tool system when relevant.
      </p>

      <h2 id="framework-skills">Framework skills</h2>
      <p>
        These skills ship with the framework and apply to all agent-native apps:
      </p>
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th>When to use</th>
          </tr>
        </thead>
        <tbody>
          {[
            [
              "storing-data",
              "Adding data models, reading/writing config or state",
            ],
            [
              "real-time-sync",
              "Wiring polling sync, debugging UI not updating",
            ],
            [
              "delegate-to-agent",
              "Delegating AI work from UI or scripts to the agent",
            ],
            ["scripts", "Creating or running agent scripts"],
            [
              "self-modifying-code",
              "Editing app source, components, or styles",
            ],
            ["create-skill", "Adding new skills for the agent"],
            ["capture-learnings", "Recording corrections and patterns"],
            [
              "frontend-design",
              "Building or styling any web UI, components, or pages",
            ],
            [
              "adding-a-feature",
              "The four-area checklist: UI, script, skills, app-state",
            ],
            [
              "context-awareness",
              "Exposing UI state to the agent, view-screen, navigate",
            ],
            ["a2a-protocol", "Inter-agent communication via JSON-RPC"],
          ].map(([skill, desc]) => (
            <tr key={skill}>
              <td>
                <code>{skill}</code>
              </td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="domain-skills">Domain skills</h2>
      <p>
        Templates include skills specific to their domain. These live in the
        same <code>.agents/skills/</code> directory but cover template-specific
        patterns:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Mail template</strong> — email-drafts, thread-management,
          label-system
        </li>
        <li>
          <strong>Forms template</strong> — form-building, field-types,
          submission-handling
        </li>
        <li>
          <strong>Analytics template</strong> — chart-types, data-connectors,
          query-patterns
        </li>
        <li>
          <strong>Slides template</strong> — deck-management, slide-layouts,
          theme-system
        </li>
      </ul>
      <p>
        Domain skills follow the same format as framework skills. They encode
        patterns specific to the template that the agent needs to follow.
      </p>

      <h2 id="creating-skills">Creating custom skills</h2>
      <p>Create a skill when:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>There's a pattern the agent should follow repeatedly</li>
        <li>A workflow needs step-by-step guidance</li>
        <li>You want to scaffold files from a template</li>
      </ul>
      <p>Don't create a skill when:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          The guidance already exists in another skill — extend it instead
        </li>
        <li>
          The guidance is a one-off — put it in <code>AGENTS.md</code> or{" "}
          <code>learnings.md</code> instead
        </li>
      </ul>

      <h2 id="skill-format">Skill format</h2>
      <p>Each skill is a Markdown file with YAML frontmatter:</p>
      <CodeBlock
        code={`---
name: my-skill
description: >-
  One-line description of what this skill covers and when
  the agent should use it.
---

# Skill Title

## Rule

The core invariant — what must always be true.

## Why

Why this rule exists. Motivates the agent to follow it.

## How

Step-by-step instructions with code examples.

## Do

- Concrete actions the agent should take

## Don't

- Anti-patterns to avoid

## Related Skills

- **other-skill** — How it relates`}
        lang="markdown"
      />
      <p>
        The frontmatter <code>name</code> and <code>description</code> are used
        by the agent's tool system for skill discovery. The description should
        state when the skill triggers — be specific about the situations.
      </p>
      <p>
        Save the file at <code>.agents/skills/my-skill/SKILL.md</code>. The
        directory name should match the <code>name</code> in frontmatter.
      </p>

      <h2 id="skills-vs-agents-md">Skills vs AGENTS.md</h2>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid grid-cols-2 divide-x divide-[var(--border)]">
          <div className="p-5">
            <div className="mb-2 text-sm font-semibold">AGENTS.md</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              The overview. Lists all scripts, describes the data model,
              explains the app architecture. The agent reads this first to
              understand the app.
            </p>
          </div>
          <div className="p-5">
            <div className="mb-2 text-sm font-semibold">Skills</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Deep dives. Each skill focuses on one pattern with detailed rules,
              code examples, and do/don't lists. The agent reads these when it
              needs to follow a specific pattern.
            </p>
          </div>
        </div>
      </div>
      <p>
        <code>AGENTS.md</code> tells the agent <em>what</em> the app does.
        Skills tell the agent <em>how</em> to do specific things correctly. Both
        are needed — <code>AGENTS.md</code> for orientation, skills for
        execution.
      </p>
    </DocsLayout>
  );
}
