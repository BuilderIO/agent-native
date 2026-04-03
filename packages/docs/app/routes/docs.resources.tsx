import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "resources-panel", label: "Resources Panel" },
  { id: "how-the-agent-uses-resources", label: "How the Agent Uses Resources" },
  { id: "agents-md", label: "AGENTS.md", indent: true },
  { id: "learnings-md", label: "learnings.md", indent: true },
  { id: "skills", label: "Skills" },
  { id: "creating-skills", label: "Creating Skills", indent: true },
  { id: "skill-format", label: "Skill Format", indent: true },
  { id: "at-file-tagging", label: "@ File Tagging" },
  { id: "slash-commands", label: "/ Slash Commands" },
  { id: "dev-vs-prod", label: "Dev vs Production Mode" },
  { id: "resource-api", label: "Resource API" },
  { id: "server-api", label: "Server API", indent: true },
  { id: "script-api", label: "Script API", indent: true },
];

export default function ResourcesDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Resources & Skills
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Resources are persistent files stored in the database — notes, configs,
        skill files, and more. They're available to both the UI and the agent,
        and work the same locally and in production.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        Every agent-native app has a built-in resource system. Resources are
        SQL-backed files that persist across sessions and deployments. Unlike
        code files, resources live in the database — not the filesystem — so
        they work in serverless environments, edge runtimes, and production
        deploys without any filesystem dependency.
      </p>
      <p>Resources have two scopes:</p>
      <ul>
        <li>
          <strong>Personal</strong> — scoped to a single user (their email).
          Good for preferences, notes, and per-user context.
        </li>
        <li>
          <strong>Shared</strong> — visible to all users. Good for team
          instructions, skills, and shared config.
        </li>
      </ul>

      <h2 id="resources-panel">Resources Panel</h2>
      <p>
        The agent panel includes a <strong>Resources</strong> tab alongside Chat
        and CLI. This panel lets users browse, create, edit, and delete
        resources. It displays a tree view of all resources organized by folder
        path.
      </p>
      <p>
        Resources can be any text file — Markdown, JSON, YAML, plain text. The
        panel includes an inline editor for viewing and modifying resource
        content directly.
      </p>

      <h2 id="how-the-agent-uses-resources">How the Agent Uses Resources</h2>
      <p>
        The agent has built-in tools for managing resources:{" "}
        <code>resource-list</code>, <code>resource-read</code>,{" "}
        <code>resource-write</code>, and <code>resource-delete</code>. These are
        available in both dev and production modes.
      </p>
      <p>At the start of every conversation, the agent automatically reads:</p>

      <h3 id="agents-md">AGENTS.md</h3>
      <p>
        A shared resource seeded by default. It contains custom instructions,
        preferences, and skill references. Edit this to change how the agent
        behaves for all users — tone, rules, domain context, and which skills to
        use.
      </p>
      <CodeBlock
        code={`# Agent Instructions

## Tone
Be concise. Lead with the answer.

## Code style
- Use TypeScript, never JavaScript
- Prefer named exports

## Skills
| Skill | Path | Description |
|-------|------|-------------|
| data-analysis | \`skills/data-analysis.md\` | BigQuery and data workflows |`}
        lang="text"
      />

      <h3 id="learnings-md">learnings.md</h3>
      <p>
        A personal resource where the agent records corrections, preferences,
        and patterns it learns from each user. When the agent makes a mistake
        and the user corrects it, the agent updates <code>learnings.md</code> so
        it doesn't repeat the error.
      </p>

      <h2 id="skills">Skills</h2>
      <p>
        Skills are Markdown resource files that give the agent deep domain
        knowledge for specific tasks. They live under the <code>skills/</code>{" "}
        path prefix in resources (e.g. <code>skills/data-analysis.md</code>,{" "}
        <code>skills/code-review.md</code>).
      </p>
      <p>
        When the agent encounters a task that matches a skill, it reads the
        skill file and follows its guidance. Skills referenced in{" "}
        <code>AGENTS.md</code> are discovered automatically.
      </p>

      <h3 id="creating-skills">Creating Skills</h3>
      <p>There are two ways to add skills:</p>
      <ol>
        <li>
          <strong>Via Resources panel</strong> — Create a new resource with a
          path like <code>skills/my-skill.md</code>. This works in both dev and
          production.
        </li>
        <li>
          <strong>Via code (dev only)</strong> — Add a Markdown file to{" "}
          <code>.agents/skills/</code> in your project. These are available when
          the app runs in dev mode.
        </li>
      </ol>

      <h3 id="skill-format">Skill Format</h3>
      <p>
        Skills are Markdown files with optional YAML frontmatter for metadata:
      </p>
      <CodeBlock
        code={`---
name: data-analysis
description: BigQuery queries, data transforms, and visualization
---

# Data Analysis

## When to use
Use this skill when the user asks about data, queries, or analytics.

## Rules
- Always validate SQL before executing
- Prefer CTEs over subqueries
- Include LIMIT on exploratory queries

## Patterns
\`\`\`sql
-- Standard BigQuery date filter
WHERE DATE(created_at) BETWEEN @start_date AND @end_date
\`\`\``}
        lang="text"
      />

      <h2 id="at-file-tagging">@ File Tagging</h2>
      <p>
        Type <code>@</code> in the chat input to reference files. A dropdown
        appears at the cursor showing matching files. Use arrow keys to navigate
        and Enter to select. The selected file appears as an inline chip in the
        input.
      </p>
      <p>
        When you send a message with file references, the agent receives the
        file paths as context and can read them using its tools.
      </p>
      <p>What shows up depends on the mode:</p>
      <ul>
        <li>
          <strong>Dev mode</strong> — Codebase files (from the filesystem) and
          resource files (from the database)
        </li>
        <li>
          <strong>Production mode</strong> — Resource files only
        </li>
      </ul>

      <h2 id="slash-commands">/ Slash Commands</h2>
      <p>
        Type <code>/</code> at the start of a line to invoke a skill. A dropdown
        shows available skills with their names and descriptions. Selecting a
        skill adds it as an inline chip, and its content is included as context
        when the message is sent.
      </p>
      <p>What shows up depends on the mode:</p>
      <ul>
        <li>
          <strong>Dev mode</strong> — Skills from <code>.agents/skills/</code>{" "}
          (codebase) and skills from resources
        </li>
        <li>
          <strong>Production mode</strong> — Skills from resources only
        </li>
      </ul>
      <p>
        If no skills are configured, the dropdown shows a hint with a link to
        these docs.
      </p>

      <h2 id="dev-vs-prod">Dev vs Production Mode</h2>
      <p>
        The resource system works identically in both modes. The difference is
        what additional sources are available for <code>@</code> tagging and{" "}
        <code>/</code> commands:
      </p>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Dev Mode</th>
            <th>Production</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              [
                "@ file tagging",
                "Codebase files + resources",
                "Resources only",
              ],
              [
                "/ slash commands",
                ".agents/skills/ + resource skills",
                "Resource skills only",
              ],
              ["Agent file access", "Filesystem + resources", "Resources only"],
              ["Resources panel", "Full access", "Full access"],
              ["AGENTS.md / learnings.md", "Available", "Available"],
            ] as const
          ).map(([feature, dev, prod]) => (
            <tr key={feature}>
              <td>{feature}</td>
              <td>{dev}</td>
              <td>{prod}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="resource-api">Resource API</h2>
      <p>
        Resources can be managed from server code, actions, or the REST API.
      </p>

      <h3 id="server-api">Server API</h3>
      <p>REST endpoints mounted automatically:</p>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Endpoint</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["GET", "/api/resources?scope=all", "List resources"],
              ["GET", "/api/resources/tree?scope=all", "Get folder tree"],
              ["POST", "/api/resources", "Create a resource"],
              ["GET", "/api/resources/:id", "Get resource with content"],
              ["PUT", "/api/resources/:id", "Update a resource"],
              ["DELETE", "/api/resources/:id", "Delete a resource"],
              ["POST", "/api/resources/upload", "Upload a file as resource"],
            ] as const
          ).map(([method, endpoint, desc]) => (
            <tr key={endpoint}>
              <td>
                <code>{method}</code>
              </td>
              <td>
                <code>{endpoint}</code>
              </td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 id="action-api">Action API</h3>
      <p>
        The agent uses these built-in actions. You can also call them from your
        own actions:
      </p>
      <CodeBlock
        code={`# List all resources
pnpm action resource-list --scope all

# Read a resource
pnpm action resource-read --path "skills/my-skill.md"

# Write a resource
pnpm action resource-write --path "notes/meeting.md" --content "# Meeting Notes..."

# Delete a resource
pnpm action resource-delete --path "notes/old.md"`}
        lang="bash"
      />
    </DocsLayout>
  );
}
