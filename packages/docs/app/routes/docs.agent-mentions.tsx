import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "mentioning-agents", label: "Mentioning Agents" },
  { id: "how-it-works", label: "How It Works" },
  { id: "adding-agents", label: "Adding Agents" },
  { id: "custom-mention-providers", label: "Custom Mention Providers" },
  { id: "referencing-files", label: "Referencing Files" },
];

export const meta = () => [
  { title: "Agent Mentions — Agent-Native" },
  {
    name: "description",
    content:
      "Tag other agents and files in chat with @-mentions for cross-agent collaboration.",
  },
];

export default function AgentMentionsDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Agent Mentions
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Type <code>@</code> in the chat composer to mention agents, files, and
        resources. Mentioning an agent triggers an A2A call and weaves the
        response into your conversation.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        The <code>@</code>-mention system connects the chat composer to the
        broader agent ecosystem. When you type <code>@</code>, a popover appears
        listing available agents, codebase files, and resources. Selecting an
        agent sends a cross-agent request via the{" "}
        <a href="/docs/a2a-protocol">A2A protocol</a>, and the response is
        embedded directly in the conversation for your main agent to use.
      </p>
      <p>
        This is how you orchestrate multi-agent workflows from a single chat.
        Ask your mail agent to draft an email, <code>@analytics</code> to pull
        in the latest numbers, and the mail agent incorporates those numbers
        into the draft — all in one conversation.
      </p>

      <h2 id="mentioning-agents">Mentioning agents</h2>
      <p>To mention an agent in the chat composer:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Type <code>@</code> to open the mention popover
        </li>
        <li>Browse or search the list of available agents</li>
        <li>Select an agent — it appears as a tag in your message</li>
        <li>
          Send the message — the server calls the mentioned agent via A2A and
          includes its response in the conversation context
        </li>
      </ol>
      <p>
        The mentioned agent receives the relevant portion of your message, runs
        its tools and actions, and returns a response. Your main agent sees the
        response and can reference or build on it.
      </p>

      <h2 id="how-it-works">How it works</h2>
      <p>
        When a message containing an <code>@</code>-mention is sent, the
        following happens on the server:
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>The server extracts mention references from the message</li>
        <li>
          For each mentioned agent, an A2A call is made to that agent's endpoint
        </li>
        <li>
          The agent's response is wrapped in an{" "}
          <code>&lt;agent-response&gt;</code> XML block and injected into the
          conversation context
        </li>
        <li>
          The main agent processes the enriched message, seeing both the user's
          text and the mentioned agent's response
        </li>
      </ol>
      <CodeBlock
        code={`// What the main agent sees in its context:
User: Draft an email with the latest signup numbers. @analytics

<agent-response agent="analytics">
Last week's signups: 1,247 total
  - Organic: 623
  - Paid: 412
  - Referral: 212
</agent-response>`}
        lang="text"
      />
      <p>
        The main agent can then use this data naturally in its response — for
        example, incorporating the numbers into an email draft.
      </p>

      <h2 id="adding-agents">Adding agents</h2>
      <p>Agents become available for mentioning through several mechanisms:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Auto-discovery</strong> — the framework automatically
          discovers agents running on known ports or configured URLs
        </li>
        <li>
          <strong>Resources panel</strong> — add agent manifests as{" "}
          <code>agents/*.json</code> files in the resources panel
        </li>
        <li>
          <strong>Environment variables</strong> — configure agent URLs and API
          keys via env vars
        </li>
      </ul>
      <p>An agent manifest looks like this:</p>
      <CodeBlock
        code={`// agents/analytics.json
{
  "name": "Analytics Agent",
  "url": "https://analytics.example.com",
  "apiKey": "env:ANALYTICS_A2A_KEY",
  "description": "Runs analytics queries and returns data",
  "skills": ["run-query", "generate-chart"]
}`}
        lang="json"
      />
      <p>
        The <code>"apiKey": "env:ANALYTICS_A2A_KEY"</code> syntax reads the
        value from the environment variable at runtime, keeping secrets out of
        the manifest file.
      </p>

      <h2 id="custom-mention-providers">Custom mention providers</h2>
      <p>
        Templates can register custom mention providers to add domain-specific
        mentionable items beyond agents and files. A mention provider implements
        the <code>MentionProvider</code> interface:
      </p>
      <CodeBlock
        code={`import type { MentionProvider } from "@agent-native/core/server";

const contactsProvider: MentionProvider = {
  id: "contacts",
  label: "Contacts",

  // Search for mentionable items
  async search(query: string) {
    const contacts = await db.query.contacts.findMany({
      where: like(contacts.name, \`%\${query}%\`),
      limit: 10,
    });
    return contacts.map((c) => ({
      id: c.id,
      label: c.name,
      description: c.email,
      type: "contact",
    }));
  },

  // Resolve a mention into context for the agent
  async resolve(id: string) {
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, id),
    });
    return {
      type: "context",
      text: \`Contact: \${contact.name} (\${contact.email})\`,
    };
  },
};`}
      />
      <p>Register providers in the agent-chat plugin configuration:</p>
      <CodeBlock
        code={`// server/plugins/agent-chat.ts
import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  mentionProviders: [contactsProvider],
});`}
      />
      <p>
        Custom mention providers appear alongside the built-in agent and file
        providers in the mention popover.
      </p>

      <h2 id="referencing-files">Referencing files</h2>
      <p>
        The <code>@</code> popover is not limited to agents. You can also
        reference:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Codebase files</strong> — type <code>@</code> and search for a
          filename. The file contents are included in the agent's context so it
          can read, analyze, or modify the file.
        </li>
        <li>
          <strong>Resources</strong> — reference resources defined in the
          resources panel. These can be data files, configuration, or any other
          structured content.
        </li>
        <li>
          <strong>Skills</strong> — type <code>/</code> to reference a skill.
          Skills provide structured instructions that guide how the agent
          approaches a task.
        </li>
      </ul>
      <p>
        All reference types follow the same pattern: select from the popover,
        and the referenced content is resolved and injected into the agent's
        context when the message is sent.
      </p>
    </DocsLayout>
  );
}
