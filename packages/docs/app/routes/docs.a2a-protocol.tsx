import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "server-setup", label: "Server Setup" },
  { id: "agent-card", label: "Agent Card" },
  { id: "json-rpc-methods", label: "JSON-RPC Methods" },
  { id: "client", label: "Client" },
  { id: "convenience-helper", label: "Convenience Helper" },
  { id: "task-lifecycle", label: "Task Lifecycle" },
  { id: "security", label: "Security" },
  { id: "example", label: "Example" },
];

export const meta = () => [
  { title: "A2A Protocol — Agent-Native" },
  {
    name: "description",
    content:
      "Agent-to-agent communication via JSON-RPC: discovery, messaging, streaming, and task management.",
  },
];

export default function A2AProtocolDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        A2A Protocol
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Agent-to-agent communication over HTTP. Agents discover each other, send
        messages, and receive structured results.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        A2A (agent-to-agent) is a JSON-RPC protocol for inter-agent
        communication. A mail agent can ask an analytics agent to run a query. A
        calendar agent can search issues in a project management agent. Each
        agent exposes its capabilities via an agent card and accepts work via a
        standard JSON-RPC endpoint.
      </p>
      <p>Key concepts:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Agent card</strong> — public metadata at{" "}
          <code>/.well-known/agent-card.json</code> describing skills and
          capabilities
        </li>
        <li>
          <strong>JSON-RPC</strong> — all communication goes through{" "}
          <code>POST /a2a</code> with standard JSON-RPC 2.0
        </li>
        <li>
          <strong>Tasks</strong> — each message creates a task with a lifecycle
          (submitted, working, completed, failed, canceled)
        </li>
        <li>
          <strong>Bearer auth</strong> — optional API key authentication via
          environment variable
        </li>
      </ul>

      <h2 id="server-setup">Server setup</h2>
      <p>
        Call <code>mountA2A()</code> in a server plugin to expose the A2A
        endpoints:
      </p>
      <CodeBlock
        code={`// server/plugins/a2a.ts
import { mountA2A } from "@agent-native/core/a2a";

export default defineNitroPlugin((nitro) => {
  mountA2A(nitro.h3App, {
    name: "Analytics Agent",
    description: "Runs analytics queries and returns chart data",
    skills: [
      {
        id: "run-query",
        name: "Run Query",
        description: "Execute a SQL query against the analytics database",
        tags: ["analytics", "sql"],
        examples: ["Show me signups by source this month"],
      },
    ],
    apiKeyEnv: "A2A_API_KEY", // env var name for bearer token
    streaming: true,           // enable message/stream
  });
});`}
      />
      <p>
        This mounts two endpoints: <code>GET /.well-known/agent-card.json</code>{" "}
        (public, no auth) and <code>POST /a2a</code> (authenticated JSON-RPC).
      </p>

      <h2 id="agent-card">Agent card</h2>
      <p>
        The agent card is auto-generated from your config and served at{" "}
        <code>/.well-known/agent-card.json</code>. Other agents fetch it to
        discover your agent's skills.
      </p>
      <CodeBlock
        code={`// Auto-generated agent card
{
  "name": "Analytics Agent",
  "description": "Runs analytics queries and returns chart data",
  "url": "https://analytics.example.com",
  "version": "1.0.0",
  "protocolVersion": "0.3",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "skills": [
    {
      "id": "run-query",
      "name": "Run Query",
      "description": "Execute a SQL query against the analytics database",
      "tags": ["analytics", "sql"],
      "examples": ["Show me signups by source this month"]
    }
  ],
  "securitySchemes": {
    "apiKey": { "type": "http", "scheme": "bearer" }
  },
  "security": [{ "apiKey": [] }]
}`}
        lang="json"
      />

      <h2 id="json-rpc-methods">JSON-RPC methods</h2>
      <p>
        All methods are called via <code>POST /a2a</code> with JSON-RPC 2.0
        format:
      </p>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Description</th>
            <th>Key params</th>
          </tr>
        </thead>
        <tbody>
          {[
            [
              "message/send",
              "Send a message, get a completed task back",
              "message, contextId?",
            ],
            [
              "message/stream",
              "Send a message, receive SSE task updates",
              "message, contextId?",
            ],
            ["tasks/get", "Fetch a task by ID", "id"],
            ["tasks/cancel", "Cancel a running task", "id"],
          ].map(([method, desc, params]) => (
            <tr key={method}>
              <td>
                <code>{method}</code>
              </td>
              <td>{desc}</td>
              <td>
                <code>{params}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Messages contain typed parts:</p>
      <CodeBlock
        code={`// Message structure
{
  "role": "user",  // or "agent"
  "parts": [
    { "type": "text", "text": "Show signups by source" },
    { "type": "data", "data": { "dateRange": "last-30d" } },
    { "type": "file", "file": { "name": "report.csv", "mimeType": "text/csv", "bytes": "..." } }
  ]
}`}
        lang="json"
      />

      <h2 id="client">Client</h2>
      <p>
        The <code>A2AClient</code> class handles discovery, messaging, and
        streaming:
      </p>
      <CodeBlock
        code={`import { A2AClient } from "@agent-native/core/a2a";

const client = new A2AClient("https://analytics.example.com", "my-api-key");

// Discover agent capabilities
const card = await client.getAgentCard();
console.log(card.skills);

// Send a message and get a completed task
const task = await client.send({
  role: "user",
  parts: [{ type: "text", text: "Show signups by source this month" }],
});
console.log(task.status.state); // "completed"
console.log(task.status.message); // agent's response

// Stream responses for long-running work
for await (const update of client.stream({
  role: "user",
  parts: [{ type: "text", text: "Generate a full quarterly report" }],
})) {
  console.log(update.status.state, update.status.message);
}`}
      />

      <h2 id="convenience-helper">Convenience helper</h2>
      <p>
        For simple text-in/text-out calls, use <code>callAgent()</code>:
      </p>
      <CodeBlock
        code={`import { callAgent } from "@agent-native/core/a2a";

// One-shot: send text, get text back
const response = await callAgent(
  "https://analytics.example.com",
  "How many signups last week?",
  { apiKey: process.env.ANALYTICS_API_KEY }
);
console.log(response); // "There were 1,247 signups last week..."`}
      />

      <h2 id="task-lifecycle">Task lifecycle</h2>
      <p>Each message creates a task that moves through these states:</p>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="p-5">
          <code className="text-sm">
            submitted &rarr; working &rarr; completed | failed | canceled
          </code>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>State</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["submitted", "Task created, queued for processing"],
            ["working", "Handler is processing the message"],
            ["completed", "Handler finished successfully"],
            ["failed", "Handler threw an error"],
            ["canceled", "Task was canceled via tasks/cancel"],
            [
              "input-required",
              "Handler needs more information from the caller",
            ],
          ].map(([state, desc]) => (
            <tr key={state}>
              <td>
                <code>{state}</code>
              </td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Tasks persist in the <code>a2a_tasks</code> SQL table and can be
        retrieved later via <code>tasks/get</code>.
      </p>

      <h2 id="security">Security</h2>
      <p>
        Set <code>apiKeyEnv</code> in your config to the name of an environment
        variable containing the expected bearer token:
      </p>
      <CodeBlock
        code={`// Config
mountA2A(app, {
  // ...
  apiKeyEnv: "A2A_API_KEY",  // reads process.env.A2A_API_KEY
});

// Client calls with the matching key
const client = new A2AClient(url, process.env.A2A_API_KEY);`}
      />
      <p>
        The agent card endpoint is always public (no auth) so other agents can
        discover capabilities. The <code>/a2a</code> JSON-RPC endpoint requires
        a valid bearer token when <code>apiKeyEnv</code> is set. In dev mode (no
        env var configured), auth is skipped.
      </p>

      <h2 id="example">Example: cross-agent query</h2>
      <p>
        A mail agent needs analytics data. The analytics agent exposes a
        "run-query" skill via A2A:
      </p>
      <CodeBlock
        code={`// In the mail agent's actions/get-analytics.ts
import { callAgent } from "@agent-native/core/a2a";

export default async function(args: string[]) {
  const response = await callAgent(
    "https://analytics.example.com",
    "How many emails were sent last week by category?",
    { apiKey: process.env.ANALYTICS_API_KEY }
  );

  console.log(response);
  // The mail agent can now use this data in its response
}`}
      />
      <p>
        The analytics agent receives the message, runs the query via its
        handler, and returns the result. The mail agent's script gets the text
        response back. No shared database, no direct API calls — just
        agent-to-agent communication.
      </p>
    </DocsLayout>
  );
}
