/**
 * Shared copy and templates for connecting external MCP clients.
 *
 * Keep this module free of React and server-only imports so the server-rendered
 * connect page and the client Agent MCP tab use the same instructions.
 */

export type McpConnectGuideId =
  | "claude"
  | "chatgpt"
  | "cursor"
  | "claude-code"
  | "codex"
  | "other";

export interface McpConnectTemplateValues {
  appName: string;
  appUrl: string;
  mcpUrl: string;
  serverId: string;
}

export interface McpConnectGuide {
  id: McpConnectGuideId;
  label: string;
  steps?: readonly string[];
  intro?: string;
  commandTemplate?: string;
  configTemplate?: string;
  action?: {
    kind: "link" | "copy";
    label: string;
    href?: string;
  };
  note?: string;
}

export const MCP_CONNECT_MCP_URL_TEMPLATE = "{appUrl}/mcp";

export const MCP_CONNECT_GUIDES: readonly McpConnectGuide[] = [
  {
    id: "claude",
    label: "Claude",
    steps: [
      "Open Customize → Connectors in Claude.",
      "Click the + button → Add custom connector.",
      "Paste the MCP URL above, name it {appName}, click Connect.",
      "On the consent page, click Authorize to approve mcp:read, mcp:write, mcp:apps.",
    ],
    action: {
      kind: "link",
      label: "Open Claude → Connectors",
      href: "https://claude.ai/customize/connectors",
    },
    note: "Works in Claude web and Claude Desktop. Inline MCP Apps (charts, dashboards, drafts) render automatically inside the chat.",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    steps: [
      "In ChatGPT web, open Settings → Apps → Advanced settings and enable developer mode if your workspace requires it.",
      "Choose Create app, paste the MCP URL above, select OAuth, and scan the tools.",
      "Sign in with your Agent-Native account, approve the requested scopes, and enable the app in a chat.",
    ],
    action: {
      kind: "link",
      label: "Open ChatGPT",
      href: "https://chatgpt.com/",
    },
    note: "Custom MCP apps are available on supported ChatGPT web workspaces. Business, Enterprise, and Edu workspaces support full MCP, including write actions; Pro supports read and fetch in developer mode. If Apps or Create app is missing, your plan or workspace policy does not allow this setup. Workspace admins may need to enable developer mode or publish the app.",
  },
  {
    id: "cursor",
    label: "Cursor",
    steps: [
      "Open Cursor → Settings → MCP.",
      "Click Add MCP Server, paste the MCP URL above, save.",
      "When prompted, sign in with your Agent-Native account and approve the MCP scopes.",
    ],
    note: "Cursor supports remote-OAuth MCP servers, same paste-URL flow as Claude — no terminal needed.",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    intro: "In your terminal, run:",
    commandTemplate: "claude mcp add --transport http {serverId} {mcpUrl}",
    action: { kind: "copy", label: "Copy command" },
    note: "Then inside Claude Code type /mcp, choose {serverId}, and click Authenticate. Claude completes the OAuth flow itself — no static token needed.",
  },
  {
    id: "codex",
    label: "Codex",
    intro: "In your terminal, run:",
    commandTemplate: "npx @agent-native/core@latest connect {appUrl}",
    action: { kind: "copy", label: "Copy command" },
    note: "Opens this page in your browser and writes Codex's ~/.codex/config.toml automatically. The same command works for Claude Cowork and Goose.",
  },
  {
    id: "other",
    label: "Other",
    intro:
      "Any MCP-compatible client with remote-OAuth support: paste the MCP URL above. For clients without OAuth, paste this .mcp.json snippet and generate a static bearer below:",
    configTemplate: `{
  "mcpServers": {
    "{serverId}": {
      "type": "http",
      "url": "{mcpUrl}"
    }
  }
}`,
    action: { kind: "copy", label: "Copy config" },
  },
] as const;

export const MCP_STATIC_TOKEN_FALLBACK = {
  title: "Generate a static token",
  state: "Advanced — clients without OAuth",
  resultTitle: "Connection token created",
  resultCopy:
    "Paste this into your agent's MCP config. The token is shown only once.",
} as const;

export function interpolateMcpConnectTemplate(
  template: string,
  values: McpConnectTemplateValues,
): string {
  return template.replace(/\{(appName|appUrl|mcpUrl|serverId)\}/g, (_, key) => {
    return values[key as keyof McpConnectTemplateValues];
  });
}
