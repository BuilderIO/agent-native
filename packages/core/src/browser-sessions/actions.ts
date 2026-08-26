import type { ActionEntry } from "../agent/production-agent.js";
import {
  callBrowserSession,
  getBrowserSession,
  listBrowserSessions,
} from "./store.js";

export interface CreateBrowserSessionActionEntriesOptions {
  getOwnerEmail: () => string | null | undefined;
  getDefaultTimeoutMs?: () => number | undefined;
}

function requireOwner(
  options: CreateBrowserSessionActionEntriesOptions,
): string {
  const owner = options.getOwnerEmail()?.trim();
  if (!owner) {
    throw new Error("No authenticated user is available for browser sessions");
  }
  return owner;
}

function readString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTimeoutMs(
  args: Record<string, unknown>,
  options: CreateBrowserSessionActionEntriesOptions,
): number | undefined {
  const raw = args.timeoutMs;
  if (typeof raw === "number" && raw > 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return options.getDefaultTimeoutMs?.();
}

async function resolveSessionId(
  ownerEmail: string,
  requestedSessionId: string | undefined,
): Promise<string> {
  if (requestedSessionId) return requestedSessionId;
  const sessions = await listBrowserSessions(ownerEmail, { limit: 5 });
  if (sessions.length === 0) {
    throw new Error(
      "No active browser sessions are connected. Open the embedded Agent-Native sidecar in the host app first.",
    );
  }
  return sessions[0].sessionId;
}

async function resolveWebMcpTool(
  ownerEmail: string,
  sessionId: string,
  name: string,
  origin?: string,
): Promise<import("../client/webmcp.js").AgentNativeWebMcpTool | undefined> {
  const session = await getBrowserSession(ownerEmail, sessionId);
  const matches = (session?.webmcpTools ?? []).filter(
    (tool) => tool.name === name && (!origin || tool.origin === origin),
  );
  if (matches.length > 1 && !origin) {
    throw new Error(
      `WebMCP tool "${name}" is exposed by multiple origins; origin is required`,
    );
  }
  return matches[0];
}

async function requireWebMcpTool(
  ownerEmail: string,
  sessionId: string,
  name: string,
  origin?: string,
) {
  const tool = await resolveWebMcpTool(ownerEmail, sessionId, name, origin);
  if (!tool) {
    throw new Error(
      `WebMCP tool "${name}" is not available in browser session "${sessionId}"`,
    );
  }
  return tool;
}

function compactSession(
  session: Awaited<ReturnType<typeof getBrowserSession>>,
) {
  if (!session) return null;
  const route =
    session.context &&
    typeof session.context.route === "object" &&
    session.context.route
      ? session.context.route
      : undefined;
  const resource =
    session.context &&
    typeof session.context.resource === "object" &&
    session.context.resource
      ? session.context.resource
      : undefined;
  return {
    sessionId: session.sessionId,
    label: session.label,
    url: session.url,
    active: session.active,
    connectedAt: session.connectedAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    route,
    resource,
    actionCount: session.actions.length,
    actions: session.actions.map((action) => ({
      name: action.name,
      description: action.description,
      source: action.source,
      availability: action.availability,
      destructive: action.destructive,
      requiresApproval: action.requiresApproval,
      schema: action.schema ?? action.parameters,
    })),
    webmcpToolCount: session.webmcpTools?.length ?? 0,
    webmcpTools: session.webmcpTools ?? [],
  };
}

export function createBrowserSessionActionEntries(
  options: CreateBrowserSessionActionEntriesOptions,
): Record<string, ActionEntry> {
  return {
    "list-browser-sessions": {
      readOnly: true,
      tool: {
        description:
          "List active browser tabs connected through the Agent-Native embedding SDK. Use this when you need to choose which live host page to inspect or operate.",
        parameters: {
          type: "object",
          properties: {
            includeExpired: {
              type: "boolean",
              description:
                "Include recently expired sessions for debugging. Defaults to false.",
            },
          },
        },
      },
      run: async (args: Record<string, unknown>) => {
        const ownerEmail = requireOwner(options);
        const sessions = await listBrowserSessions(ownerEmail, {
          includeExpired:
            args.includeExpired === true || args.includeExpired === "true",
        });
        return {
          ok: true,
          sessions: sessions.map(compactSession),
        };
      },
    },

    "view-browser-session": {
      readOnly: true,
      tool: {
        description:
          "Read the current page context and screen snapshot from a connected browser session. Omit sessionId to use the most recently active tab.",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description:
                "Browser session id from list-browser-sessions. Optional when only one tab is active.",
            },
            timeoutMs: {
              type: "number",
              description: "How long to wait for the live tab to respond.",
            },
          },
        },
      },
      run: async (args: Record<string, unknown>) => {
        const ownerEmail = requireOwner(options);
        const sessionId = await resolveSessionId(
          ownerEmail,
          readString(args, "sessionId"),
        );
        const context = await callBrowserSession(
          ownerEmail,
          sessionId,
          { type: "get-context", timeoutMs: readTimeoutMs(args, options) },
          { timeoutMs: readTimeoutMs(args, options) },
        );
        return { ok: true, sessionId, context };
      },
    },

    "list-browser-session-actions": {
      readOnly: true,
      tool: {
        description:
          "List live client actions currently exposed by a connected browser session. These actions can change after navigation or selection changes.",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description:
                "Browser session id from list-browser-sessions. Optional when only one tab is active.",
            },
            timeoutMs: {
              type: "number",
              description: "How long to wait for the live tab to respond.",
            },
          },
        },
      },
      run: async (args: Record<string, unknown>) => {
        const ownerEmail = requireOwner(options);
        const sessionId = await resolveSessionId(
          ownerEmail,
          readString(args, "sessionId"),
        );
        const actions = await callBrowserSession(
          ownerEmail,
          sessionId,
          { type: "list-actions", timeoutMs: readTimeoutMs(args, options) },
          { timeoutMs: readTimeoutMs(args, options) },
        );
        return { ok: true, sessionId, actions };
      },
    },

    "list-browser-session-webmcp-tools": {
      readOnly: true,
      tool: {
        description:
          "List WebMCP tools exposed by a connected browser page. Use this before running one because names, schemas, origins, and read-only hints are page-local and can change after navigation.",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description:
                "Browser session id from list-browser-sessions. Optional when only one tab is active.",
            },
            timeoutMs: {
              type: "number",
              description: "How long to wait for the live tab to respond.",
            },
          },
        },
      },
      run: async (args: Record<string, unknown>) => {
        const ownerEmail = requireOwner(options);
        const sessionId = await resolveSessionId(
          ownerEmail,
          readString(args, "sessionId"),
        );
        const tools = await callBrowserSession(
          ownerEmail,
          sessionId,
          {
            type: "list-webmcp-tools",
            timeoutMs: readTimeoutMs(args, options),
          },
          { timeoutMs: readTimeoutMs(args, options) },
        );
        return { ok: true, sessionId, tools };
      },
    },

    "run-browser-session-webmcp-tool": {
      needsApproval: async (args: Record<string, unknown>) => {
        const ownerEmail = requireOwner(options);
        const name = readString(args, "name");
        if (!name) return true;
        const sessionId = await resolveSessionId(
          ownerEmail,
          readString(args, "sessionId"),
        );
        const tool = await resolveWebMcpTool(
          ownerEmail,
          sessionId,
          name,
          readString(args, "origin"),
        );
        return tool?.annotations?.readOnlyHint !== true;
      },
      tool: {
        description:
          "Run a WebMCP tool exposed by a connected browser page. Use list-browser-session-webmcp-tools first, preserve its origin for duplicate names, and expect human approval unless readOnlyHint is true.",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description:
                "Browser session id from list-browser-sessions. Optional when only one tab is active.",
            },
            name: {
              type: "string",
              description: "The WebMCP tool name to run.",
            },
            origin: {
              type: "string",
              description:
                "The registered tool origin when the same name is exposed by multiple origins.",
            },
            args: {
              type: "object",
              description:
                "JSON-serializable arguments matching the discovered WebMCP input schema.",
            },
            timeoutMs: {
              type: "number",
              description: "How long to wait for the live tab to respond.",
            },
          },
          required: ["name"],
        },
      },
      run: async (args: Record<string, unknown>) => {
        const ownerEmail = requireOwner(options);
        const name = readString(args, "name");
        if (!name) throw new Error("name is required");
        const timeoutMs = readTimeoutMs(args, options);
        const sessionId = await resolveSessionId(
          ownerEmail,
          readString(args, "sessionId"),
        );
        const origin = readString(args, "origin");
        await requireWebMcpTool(ownerEmail, sessionId, name, origin);
        const result = await callBrowserSession(
          ownerEmail,
          sessionId,
          {
            type: "run-webmcp-tool",
            name,
            origin,
            args: args.args,
            timeoutMs,
          },
          { timeoutMs },
        );
        return { ok: true, sessionId, name, result };
      },
    },

    "run-browser-session-action": {
      tool: {
        description:
          "Run a live client action in a connected browser tab. Use list-browser-session-actions first to discover the current action names and schemas. Omit sessionId to use the most recently active tab.",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description:
                "Browser session id from list-browser-sessions. Optional when only one tab is active.",
            },
            name: {
              type: "string",
              description: "The live client action name to run.",
            },
            args: {
              type: "object",
              description:
                "JSON-serializable arguments for the client action. Match the schema returned by list-browser-session-actions.",
            },
            timeoutMs: {
              type: "number",
              description: "How long to wait for the live tab to respond.",
            },
          },
          required: ["name"],
        },
      },
      run: async (args: Record<string, unknown>) => {
        const ownerEmail = requireOwner(options);
        const name = readString(args, "name");
        if (!name) throw new Error("name is required");
        const timeoutMs = readTimeoutMs(args, options);
        const sessionId = await resolveSessionId(
          ownerEmail,
          readString(args, "sessionId"),
        );
        const result = await callBrowserSession(
          ownerEmail,
          sessionId,
          { type: "run-action", name, args: args.args, timeoutMs },
          { timeoutMs },
        );
        return { ok: true, sessionId, name, result };
      },
    },

    "send-browser-session-command": {
      tool: {
        description:
          "Send a command to a connected host app, such as refreshData, navigate, remountView, hardReload, openResource, or requestApproval. Omit command to ask the host to refresh visible data.",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description:
                "Browser session id from list-browser-sessions. Optional when only one tab is active.",
            },
            command: {
              type: "string",
              description:
                "Built-in or custom host command. Defaults to refreshData.",
            },
            payload: {
              type: "object",
              description:
                "JSON-serializable payload for the command, such as a route target or refresh query key.",
            },
            timeoutMs: {
              type: "number",
              description: "How long to wait for the live tab to respond.",
            },
          },
        },
      },
      run: async (args: Record<string, unknown>) => {
        const ownerEmail = requireOwner(options);
        const timeoutMs = readTimeoutMs(args, options);
        const sessionId = await resolveSessionId(
          ownerEmail,
          readString(args, "sessionId"),
        );
        const command = readString(args, "command") ?? "refreshData";
        const result = await callBrowserSession(
          ownerEmail,
          sessionId,
          {
            type: "command",
            command,
            payload: args.payload,
            timeoutMs,
          },
          { timeoutMs },
        );
        return { ok: true, sessionId, command, result };
      },
    },
  };
}
