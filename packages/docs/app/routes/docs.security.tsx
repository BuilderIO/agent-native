import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "data-scoping", label: "Data Scoping" },
  { id: "per-user-scoping", label: "Per-User Scoping" },
  { id: "per-org-scoping", label: "Per-Org Scoping" },
  { id: "how-scoping-works", label: "How Scoping Works" },
  { id: "insert-auto-injection", label: "INSERT Auto-Injection" },
  { id: "a2a-identity", label: "A2A Identity Verification" },
  { id: "validation", label: "Schema Validation" },
  { id: "production-checklist", label: "Production Checklist" },
];

export default function SecurityDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Security &amp; Data Scoping
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        In production, the framework automatically restricts agent SQL queries
        to the current user's data. This is enforced at the SQL level &mdash;
        agents cannot bypass it.
      </p>

      <h2 id="data-scoping">Data Scoping</h2>
      <p>
        Data scoping ensures each user only sees their own data. It works by
        creating temporary SQL views that filter tables before the agent's query
        runs. Two scoping dimensions are supported:
      </p>
      <ul>
        <li>
          <strong>
            <code>owner_email</code>
          </strong>{" "}
          &mdash; per-user data isolation (required for all user-facing tables)
        </li>
        <li>
          <strong>
            <code>org_id</code>
          </strong>{" "}
          &mdash; per-organization data isolation (for multi-user/team apps)
        </li>
      </ul>

      <h2 id="per-user-scoping">Per-User Scoping</h2>
      <p>
        Every table with user-specific data <strong>must</strong> have an{" "}
        <code>owner_email</code> text column:
      </p>
      <CodeBlock
        code={`import { table, text, integer } from "@agent-native/core/db/schema";

export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  owner_email: text("owner_email").notNull(), // REQUIRED
});`}
        lang="typescript"
      />
      <p>
        The current user's email comes from <code>AGENT_USER_EMAIL</code>, which
        is automatically set from the auth session before any agent script runs.
      </p>

      <h2 id="per-org-scoping">Per-Org Scoping</h2>
      <p>
        For apps where teams share data within an organization, add an{" "}
        <code>org_id</code> column:
      </p>
      <CodeBlock
        code={`export const projects = table("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  owner_email: text("owner_email").notNull(),
  org_id: text("org_id").notNull(),
});`}
        lang="typescript"
      />
      <p>
        When both columns are present, queries are scoped by{" "}
        <strong>both</strong>: <code>WHERE owner_email = ? AND org_id = ?</code>
        .
      </p>
      <p>
        The <code>org_id</code> is automatically resolved from the user's active
        organization in Better Auth. Templates can override this with a custom{" "}
        <code>resolveOrgId</code> callback in{" "}
        <code>createAgentChatPlugin()</code>.
      </p>

      <h2 id="how-scoping-works">How Scoping Works</h2>
      <p>
        When an agent runs <code>db-query</code> or <code>db-exec</code> in
        production mode:
      </p>
      <ol>
        <li>
          The framework discovers all tables and their columns via schema
          introspection
        </li>
        <li>
          For each table with <code>owner_email</code> and/or{" "}
          <code>org_id</code>, a temporary view is created:
          <CodeBlock
            code={`-- Temporary view replaces the real table name
CREATE TEMPORARY VIEW "notes" AS
  SELECT * FROM main."notes"
  WHERE "owner_email" = 'alice@example.com'
  AND "org_id" = 'org-123';`}
            lang="sql"
          />
        </li>
        <li>The agent's query runs against the views (not the real tables)</li>
        <li>Views are dropped after the query completes</li>
      </ol>
      <p>
        This means agents write normal SQL &mdash; no WHERE clauses needed for
        ownership. The framework handles it transparently.
      </p>

      <h2 id="insert-auto-injection">INSERT Auto-Injection</h2>
      <p>
        When an agent runs an INSERT via <code>db-exec</code>, the framework
        automatically injects ownership columns:
      </p>
      <CodeBlock
        code={`-- Agent writes:
INSERT INTO notes (title, content) VALUES ('My Note', 'Hello')

-- Framework transforms to:
INSERT INTO notes (title, content, owner_email, org_id)
  VALUES ('My Note', 'Hello', 'alice@example.com', 'org-123')`}
        lang="sql"
      />
      <p>
        This only happens when the columns aren't already present in the INSERT
        statement.
      </p>

      <h2 id="a2a-identity">A2A Identity Verification</h2>
      <p>
        When apps call each other via the A2A protocol, they can verify the
        caller's identity using JWT tokens signed with a shared secret:
      </p>
      <CodeBlock
        code={`# Set the same secret on all apps that need to trust each other
A2A_SECRET=your-shared-secret-at-least-32-chars`}
        lang="bash"
      />
      <p>How it works:</p>
      <ol>
        <li>
          App A signs a JWT with <code>A2A_SECRET</code> containing{" "}
          <code>sub: "steve@example.com"</code>
        </li>
        <li>
          App B receives the call and verifies the JWT signature with the same
          secret
        </li>
        <li>
          App B sets <code>AGENT_USER_EMAIL</code> from the verified{" "}
          <code>sub</code> claim
        </li>
        <li>Data scoping applies &mdash; App B only shows Steve's data</li>
      </ol>
      <p>
        Without <code>A2A_SECRET</code>, A2A calls are unauthenticated. This is
        fine for local development but should not be used in production.
      </p>

      <h2 id="validation">Schema Validation</h2>
      <p>
        Run the scoping check to verify all tables have proper ownership
        columns:
      </p>
      <CodeBlock
        code={`# Check all tables have owner_email
pnpm action db-check-scoping

# Also require org_id for multi-org apps
pnpm action db-check-scoping --require-org`}
        lang="bash"
      />
      <p>
        Tables without scoping columns are flagged. Core framework tables (
        <code>settings</code>, <code>application_state</code>,{" "}
        <code>sessions</code>) use their own scoping mechanisms and are excluded
        from the check.
      </p>

      <h2 id="production-checklist">Production Checklist</h2>
      <ul>
        <li>
          Every user-facing table has <code>owner_email</code>
        </li>
        <li>
          Multi-user tables also have <code>org_id</code>
        </li>
        <li>
          <code>BETTER_AUTH_SECRET</code> is set to a random 32+ character
          string
        </li>
        <li>
          <code>A2A_SECRET</code> is set on all apps that call each other
        </li>
        <li>
          <code>AUTH_MODE</code> is <strong>not</strong> set to{" "}
          <code>local</code> in production
        </li>
        <li>
          Run <code>pnpm action db-check-scoping</code> to validate schema
        </li>
        <li>Test with two user accounts to verify data isolation</li>
      </ul>
    </DocsLayout>
  );
}
