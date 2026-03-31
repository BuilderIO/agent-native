import type { ScriptEntry } from "@agent-native/core/server";

function tool(
  name: string,
  description: string,
  parameters: Record<string, any>,
) {
  return {
    name,
    description,
    parameters: {
      type: "object" as const,
      properties: parameters,
    },
  };
}

async function load(name: string) {
  const mod = await import(/* @vite-ignore */ `./${name}.js`);
  return mod.default;
}

export const scriptRegistry: Record<string, ScriptEntry> = {
  "view-screen": {
    tool: tool(
      "view-screen",
      "See what the user is currently looking at in the UI",
      {
        full: { type: "boolean", description: "Include full issue details" },
      },
    ),
    run: async (args) => (await load("view-screen"))(args),
  },
  navigate: {
    tool: tool("navigate", "Navigate the UI to a specific view or issue", {
      view: {
        type: "string",
        description:
          "Target view: my-issues, projects, board, sprint, settings",
      },
      issueKey: { type: "string", description: "Issue key to open" },
      projectKey: { type: "string", description: "Project key" },
      boardId: { type: "string", description: "Board ID" },
    }),
    run: async (args) => (await load("navigate"))(args),
  },
  "list-issues": {
    tool: tool("list-issues", "List Jira issues for a view", {
      view: {
        type: "string",
        description: "View: my-issues (default), project, recent",
      },
      projectKey: {
        type: "string",
        description: "Project key (for project view)",
      },
      jql: { type: "string", description: "Custom JQL query" },
      q: { type: "string", description: "Text search" },
      compact: { type: "boolean", description: "Compact output" },
      maxResults: {
        type: "number",
        description: "Max results (default 25)",
      },
    }),
    run: async (args) => (await load("list-issues"))(args),
  },
  "get-issue": {
    tool: tool("get-issue", "Get full details of a Jira issue", {
      key: { type: "string", description: "Issue key (e.g. PROJ-123)" },
    }),
    run: async (args) => (await load("get-issue"))(args),
  },
  "create-issue": {
    tool: tool("create-issue", "Create a new Jira issue", {
      project: { type: "string", description: "Project key" },
      type: {
        type: "string",
        description: "Issue type: Task, Bug, Story, Epic",
      },
      summary: { type: "string", description: "Issue summary/title" },
      description: { type: "string", description: "Issue description" },
      priority: {
        type: "string",
        description: "Priority: Highest, High, Medium, Low, Lowest",
      },
      assignee: { type: "string", description: "Assignee account ID" },
    }),
    run: async (args) => (await load("create-issue"))(args),
  },
  "update-issue": {
    tool: tool("update-issue", "Update fields on a Jira issue", {
      key: { type: "string", description: "Issue key" },
      summary: { type: "string", description: "New summary" },
      description: { type: "string", description: "New description" },
      priority: { type: "string", description: "New priority" },
      assignee: { type: "string", description: "New assignee account ID" },
      labels: { type: "string", description: "Comma-separated labels" },
    }),
    run: async (args) => (await load("update-issue"))(args),
  },
  "transition-issue": {
    tool: tool("transition-issue", "Change the status of a Jira issue", {
      key: { type: "string", description: "Issue key" },
      status: {
        type: "string",
        description: "Target status name (e.g. 'In Progress', 'Done')",
      },
    }),
    run: async (args) => (await load("transition-issue"))(args),
  },
  "add-comment": {
    tool: tool("add-comment", "Add a comment to a Jira issue", {
      key: { type: "string", description: "Issue key" },
      body: { type: "string", description: "Comment text" },
    }),
    run: async (args) => (await load("add-comment"))(args),
  },
  "search-issues": {
    tool: tool("search-issues", "Search Jira issues via JQL or text", {
      jql: { type: "string", description: "JQL query" },
      q: { type: "string", description: "Free-text search" },
      compact: { type: "boolean", description: "Compact output" },
      maxResults: { type: "number", description: "Max results" },
    }),
    run: async (args) => (await load("search-issues"))(args),
  },
  "list-projects": {
    tool: tool("list-projects", "List accessible Jira projects", {
      compact: { type: "boolean", description: "Compact output" },
    }),
    run: async (args) => (await load("list-projects"))(args),
  },
  "list-sprints": {
    tool: tool("list-sprints", "List sprints for a board", {
      boardId: { type: "string", description: "Board ID" },
    }),
    run: async (args) => (await load("list-sprints"))(args),
  },
  "refresh-list": {
    tool: tool("refresh-list", "Trigger the UI to refresh data", {}),
    run: async (args) => (await load("refresh-list"))(args),
  },
};

export const systemPrompt = `You are an AI assistant for a Jira project management app. You can read, search, create, update, and manage Jira issues, projects, and sprints.

**Always run \`pnpm script view-screen\` first** to see what the user is looking at before taking action.

**Use scripts for all Jira operations** — never use curl or raw HTTP requests.

## Common Operations

| Task | Script |
|------|--------|
| See current view | \`pnpm script view-screen\` |
| List my issues | \`pnpm script list-issues\` |
| Search issues | \`pnpm script search-issues --q="search term"\` |
| Get issue details | \`pnpm script get-issue --key=PROJ-123\` |
| Create issue | \`pnpm script create-issue --project=PROJ --summary="Title"\` |
| Update issue | \`pnpm script update-issue --key=PROJ-123 --summary="New title"\` |
| Change status | \`pnpm script transition-issue --key=PROJ-123 --status="In Progress"\` |
| Add comment | \`pnpm script add-comment --key=PROJ-123 --body="Comment text"\` |
| List projects | \`pnpm script list-projects\` |
| List sprints | \`pnpm script list-sprints --boardId=1\` |
| Navigate UI | \`pnpm script navigate --view=my-issues\` |
| Refresh UI | \`pnpm script refresh-list\` |

After any write operation (create, update, transition, comment), run \`pnpm script refresh-list\` to update the UI.
`;
