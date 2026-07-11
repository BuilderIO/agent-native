import type { AgentEngine } from "../../agent/engine/types.js";
import type { ActionEntry } from "../../agent/production-agent.js";
import {
  areBuiltinMcpCapabilitiesSupported,
  buildMergedConfig,
  setBuiltinMcpCapabilityEnabled,
  type BuiltinMcpCapabilityId,
} from "../../mcp-client/index.js";
import {
  getBuilderBrowserConnectUrlForOwner,
  resolveBuilderBranchProjectId,
} from "../builder-browser.js";
import { getRequestUserEmail } from "../request-context.js";
import { getGlobalMcpManager } from "./mcp-glue.js";

// ---------------------------------------------------------------------------
// Builder.io browser-connect / built-in MCP toggle tools, and the unified
// `agent-teams` sub-agent orchestration tool.
// ---------------------------------------------------------------------------

export function createBuilderBrowserTool(deps: {
  getOrigin: () => string;
  getOwner?: () => string | null | undefined;
  extensionTools?: boolean;
}): Record<string, ActionEntry> {
  const extensionRequestGuidance =
    deps.extensionTools === false
      ? "Do NOT call this for requests to create or edit user-authored extensions/widgets/dashboards/calculators/mini-apps; extension tools are disabled for this app, and Builder is only for source-code changes to the host app. "
      : "Do NOT call this for a self-contained extension/widget/dashboard/calculator/mini-app or an extension that fits an existing named slot; those use create-extension/update-extension instead. If the requested result requires changing the host UI or placing UI where no named slot exists, it IS a source-code change: call this through the normal flow even when the user describes it as an extension. Never stop at saying an extension cannot do it. ";
  const setBuiltinForCurrentUser = async (
    id: BuiltinMcpCapabilityId,
    enabled: boolean,
  ) => {
    const email = getRequestUserEmail();
    if (!email) {
      return {
        ok: false,
        error: "not-signed-in",
        message: "You must be signed in to change built-in MCP tools.",
      };
    }
    const enabledIds = await setBuiltinMcpCapabilityEnabled(
      "user",
      email,
      id,
      enabled,
    );
    const manager = getGlobalMcpManager();
    if (manager) {
      await manager.reconfigure(await buildMergedConfig());
    }
    return { ok: true, enabledIds: enabledIds ?? [] };
  };

  const entries: Record<string, ActionEntry> = {
    "connect-builder": {
      tool: {
        description: `Render a Builder.io card inline in the chat. Call this as the first step (no code exploration or planning needed) when the user asks to modify the APP'S OWN SOURCE CODE: add a feature, change the UI chrome, edit a React component, add a route, add an integration, fix a bug in the app itself, or anything else that requires source-file edits while in hosted/production mode. ${extensionRequestGuidance}Do NOT call this for content the app is meant to produce — creating a video, generating a design, drafting an email, building a slide deck, making a dashboard, etc. — those run through the app's own domain actions, not Builder. Do NOT mention 'click Send to Builder' in your response unless this card is already in the conversation. The tool result includes \`builderEnabled\`; treat \`true\` as "Builder Cloud Agents can take the code-change handoff" and \`false\` as "this still needs a code change, but no Builder Cloud Agent can run here." If Builder is connected and Builder Cloud Agents are available, the card shows a 'Send to Builder' button that hands the work off to Builder's cloud agent and returns a branch URL. If \`builderEnabled\` is false, the card still renders but shows the code-change fallback: "This requires a code change. Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like." Never tell the user to enable Builder Cloud Agents in Builder org settings or beta settings, and do not claim the Builder card has everything, is pre-loaded for handoff, or can run the cloud agent when \`builderEnabled\` is false. When you call this for a code-change request, pass the user's request verbatim as the \`prompt\` arg so the card can forward it to Builder unchanged when cloud agents are available.`,
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "The user's feature / change request, verbatim. Forwarded to Builder's cloud agent when the user clicks Send. Omit only for generic 'connect Builder' requests that aren't tied to a specific code change.",
            },
          },
        },
      },
      run: async (args) => {
        const { getBuilderCredentialAuthFailure, resolveBuilderCredentials } =
          await import("../credential-provider.js");
        const creds = await resolveBuilderCredentials();
        const authFailure = await getBuilderCredentialAuthFailure(creds);
        const configured = !!(
          creds.privateKey &&
          creds.publicKey &&
          !authFailure
        );
        const branchProjectId = await resolveBuilderBranchProjectId();
        const prompt = typeof args?.prompt === "string" ? args.prompt : "";
        const origin = deps.getOrigin();
        const ownerEmail = deps.getOwner?.() ?? getRequestUserEmail();
        return JSON.stringify({
          kind: "connect-builder-card",
          configured,
          builderEnabled: !!branchProjectId,
          connectUrl: getBuilderBrowserConnectUrlForOwner(origin, ownerEmail),
          orgName: creds.orgName || null,
          prompt,
        });
      },
    },
    "set-browser-control": {
      tool: {
        description:
          "Enable or disable built-in browser-control MCP tools for the current user. Call this when the user asks to test, screenshot, inspect, or interact with a web page and browser tools are not available; confirm once before enabling. Prefer the chrome-devtools backend for live logged-in Chrome, and use playwright when an isolated browser is better.",
        parameters: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether browser-control tools should be enabled.",
            },
            backend: {
              type: "string",
              enum: ["chrome-devtools", "playwright"],
              description:
                "Browser backend to enable. Defaults to chrome-devtools.",
            },
          },
          required: ["enabled"],
        },
      },
      run: async (args) => {
        const parsed =
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {};
        const enabled = parsed.enabled !== false;
        const requestedBackend =
          typeof parsed.backend === "string" ? parsed.backend : undefined;
        const backend =
          requestedBackend === "playwright" ? "playwright" : "chrome-devtools";
        const targetId: BuiltinMcpCapabilityId =
          backend === "playwright"
            ? "browser-playwright"
            : "browser-chrome-devtools";

        if (!enabled) {
          const chrome = await setBuiltinForCurrentUser(
            "browser-chrome-devtools",
            false,
          );
          if (!chrome.ok) return JSON.stringify(chrome);
          const playwright = await setBuiltinForCurrentUser(
            "browser-playwright",
            false,
          );
          return JSON.stringify({
            ...playwright,
            enabled: false,
            message: "Browser-control MCP tools are disabled.",
          });
        }

        const result = await setBuiltinForCurrentUser(targetId, true);
        return JSON.stringify({
          ...result,
          enabled: true,
          backend,
          message:
            backend === "chrome-devtools"
              ? "Chrome DevTools MCP is enabled. Browser tools will be available on the next action when Chrome remote debugging is available."
              : "Playwright MCP is enabled. Browser tools will be available on the next action in an isolated Playwright browser.",
        });
      },
    },
    "set-computer-use": {
      tool: {
        description:
          "Enable or disable built-in Computer Use MCP tools for the current user. Call only after the user explicitly asks to let the agent control local desktop apps. macOS may require Screen Recording and Accessibility permissions.",
        parameters: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether Computer Use tools should be enabled.",
            },
          },
          required: ["enabled"],
        },
      },
      run: async (args) => {
        const parsed =
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {};
        const enabled = parsed.enabled !== false;
        if (enabled && process.platform !== "darwin") {
          return JSON.stringify({
            ok: false,
            error: "unsupported-platform",
            message: "Computer Use is currently available only on macOS.",
          });
        }
        const result = await setBuiltinForCurrentUser("computer-use", enabled);
        return JSON.stringify({
          ...result,
          enabled,
          message: enabled
            ? "Computer Use MCP is enabled. If macOS prompts, grant Screen Recording and Accessibility permission in System Settings > Privacy & Security."
            : "Computer Use MCP is disabled.",
        });
      },
    },
    "activate-browser": {
      tool: {
        description:
          "Activate browser automation tools. Call this when you need to interact with a real browser — e.g. to extract design tokens from a rendered page, take screenshots, read computed styles from JS-heavy sites, or test a live URL. After activation, chrome-devtools MCP tools (navigate, click, evaluate_script, take_screenshot, etc.) become available on your next action. Requires Builder.io connection.",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description:
                "Optional session identifier for the browser connection. Auto-generated if omitted.",
            },
          },
        },
      },
      run: async (args) => {
        const { resolveBuilderCredentials } =
          await import("../credential-provider.js");
        const creds = await resolveBuilderCredentials();
        if (!creds.privateKey || !creds.publicKey) {
          return JSON.stringify({
            error: "builder-not-connected",
            message:
              "Builder.io is not connected. Call `connect-builder` first to enable browser automation.",
          });
        }

        const { requestBuilderBrowserConnection } =
          await import("../builder-browser.js");
        const sessionId =
          (typeof args?.sessionId === "string" && args.sessionId) ||
          `an-browser-${Date.now()}`;

        let connection: Record<string, unknown>;
        try {
          connection = await requestBuilderBrowserConnection({ sessionId });
        } catch (err: any) {
          return JSON.stringify({
            error: "browser-connection-failed",
            message: `Failed to get browser connection: ${err?.message ?? err}`,
          });
        }

        const wsUrl = connection.wsUrl as string;
        if (!wsUrl) {
          return JSON.stringify({
            error: "no-ws-url",
            message: "Browser connection did not return a WebSocket URL.",
          });
        }

        const manager = getGlobalMcpManager();
        if (!manager) {
          return JSON.stringify({
            error: "no-mcp-manager",
            message: "MCP manager is not available.",
          });
        }

        // Add chrome-devtools-mcp server pointing at the provisioned browser
        const currentConfig = manager.getConfig();
        const servers = { ...(currentConfig?.servers ?? {}) };
        servers["chrome-devtools"] = {
          command: "npx",
          args: [
            "-y",
            "chrome-devtools-mcp@0.26.0",
            "--wsEndpoint",
            wsUrl,
            "--categoryEmulation=false",
          ],
          type: "stdio",
        } as any;

        await manager.reconfigure({
          servers,
          source: currentConfig?.source ?? "runtime",
        });

        return JSON.stringify({
          success: true,
          message:
            "Browser activated. Chrome DevTools MCP tools (mcp__chrome-devtools__*) are now available. Use them on your next action to navigate pages, read DOM, take screenshots, evaluate JavaScript, etc.",
          wsUrl,
          sessionId,
        });
      },
    },
  };

  if (!areBuiltinMcpCapabilitiesSupported()) {
    delete entries["set-browser-control"];
    delete entries["set-computer-use"];
  }

  return entries;
}

/**
 * Creates the unified `agent-teams` tool that consolidates all sub-agent
 * orchestration behind a single tool with an `action` parameter.
 */
export function createTeamTools(deps: {
  getOwner: () => string;
  getSystemPrompt: () => string;
  getActions: () => Record<string, ActionEntry>;
  getEngine: () => AgentEngine;
  getModel: () => string;
  getParentThreadId: () => string;
  getSend: () =>
    | ((event: import("../../agent/types.js").AgentChatEvent) => void)
    | null;
}): Record<string, ActionEntry> {
  return {
    "agent-teams": {
      tool: {
        description:
          "Manage background sub-agent tasks. Use action 'spawn' to start a new sub-agent, 'status' to check progress, 'read-result' to get a finished task's output, 'send' to message a running sub-agent, or 'list' to see all tasks. A successful spawn only means the task started and is running; do not report it as finished until status/read-result shows a terminal status.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["spawn", "status", "read-result", "send", "list"],
              description: "The operation to perform",
            },
            task: {
              type: "string",
              description:
                "(spawn) Clear description of what the sub-agent should accomplish",
            },
            instructions: {
              type: "string",
              description:
                "(spawn) Optional additional instructions or context for the sub-agent",
            },
            name: {
              type: "string",
              description:
                "(spawn) Short name for the sub-agent tab (e.g. 'Research', 'Draft email'). If omitted, derived from the task.",
            },
            agent: {
              type: "string",
              description:
                "(spawn) Optional custom agent profile from agents/*.md to use for this task.",
            },
            taskId: {
              type: "string",
              description:
                "(status, read-result, send) The task ID returned by a previous spawn",
            },
            message: {
              type: "string",
              description: "(send) Message to send to the sub-agent",
            },
          },
          required: ["action"],
        },
      },
      run: async (args: Record<string, string>) => {
        const action = args.action;

        // ── spawn ──────────────────────────────────────────────
        if (action === "spawn") {
          if (!args.task) throw new Error("'task' is required for spawn");
          // Capture the send function NOW (at spawn time) so that
          // concurrent runs don't clobber each other's send reference.
          const capturedSend = deps.getSend();
          const { spawnTask } = await import("../agent-teams.js");
          // Filter out the team tool so sub-agents can't spawn sub-agents
          const subAgentActions = Object.fromEntries(
            Object.entries(deps.getActions()).filter(
              ([name]) => name !== "agent-teams",
            ),
          );
          let instructions = args.instructions;
          let selectedModel = deps.getModel();
          let selectedName = args.name || "";
          if (args.agent) {
            const { findAccessibleCustomAgent } =
              await import("../../resources/agents.js");
            const profile = await findAccessibleCustomAgent(
              deps.getOwner(),
              args.agent,
            );
            if (!profile) {
              throw new Error(`Custom agent not found: ${args.agent}`);
            }
            const profileInstructions =
              `## Custom Agent Profile: ${profile.name}\n\n` +
              (profile.description ? `${profile.description}\n\n` : "") +
              profile.instructions;
            instructions = instructions
              ? `${profileInstructions}\n\n## Extra Task Context\n\n${instructions}`
              : profileInstructions;
            selectedModel = profile.model ?? selectedModel;
            selectedName = selectedName || profile.name;
          }
          const task = await spawnTask({
            description: args.task,
            instructions,
            ownerEmail: deps.getOwner(),
            systemPrompt: deps.getSystemPrompt(),
            actions: subAgentActions,
            engine: deps.getEngine(),
            model: selectedModel,
            name: selectedName || undefined,
            parentThreadId: deps.getParentThreadId(),
            parentSend: (event) => {
              if (capturedSend) capturedSend(event);
            },
          });
          return JSON.stringify({
            taskId: task.taskId,
            threadId: task.threadId,
            runId: task.runId,
            status: task.status,
            parentThreadId: task.parentThreadId,
            state: "launched_pending_completion",
            message:
              "Sub-agent launched and is still running. Use status or read-result later; do not describe this task as completed from the spawn response alone.",
            description: task.description,
            name: task.name ?? selectedName,
          });
        }

        // ── status ─────────────────────────────────────────────
        if (action === "status") {
          if (!args.taskId) throw new Error("'taskId' is required for status");
          const { getTask } = await import("../agent-teams.js");
          const task = await getTask(args.taskId);
          if (!task) return JSON.stringify({ error: "Task not found" });
          return JSON.stringify({
            taskId: task.taskId,
            threadId: task.threadId,
            parentThreadId: task.parentThreadId,
            status: task.status,
            description: task.description,
            name: task.name,
            preview: task.preview,
            currentStep: task.currentStep,
            summary: task.summary,
          });
        }

        // ── read-result ────────────────────────────────────────
        if (action === "read-result") {
          if (!args.taskId)
            throw new Error("'taskId' is required for read-result");
          const { getTask } = await import("../agent-teams.js");
          const task = await getTask(args.taskId);
          if (!task) return JSON.stringify({ error: "Task not found" });
          if (task.status === "running") {
            return JSON.stringify({
              status: "running",
              taskId: task.taskId,
              threadId: task.threadId,
              parentThreadId: task.parentThreadId,
              name: task.name,
              preview: task.preview,
              message:
                "Task is still running. Do not report it as complete; use status/read-result later.",
            });
          }
          return JSON.stringify({
            taskId: task.taskId,
            threadId: task.threadId,
            parentThreadId: task.parentThreadId,
            name: task.name,
            status: task.status,
            summary: task.summary,
            preview: task.preview,
          });
        }

        // ── send ───────────────────────────────────────────────
        if (action === "send") {
          if (!args.taskId) throw new Error("'taskId' is required for send");
          if (!args.message) throw new Error("'message' is required for send");
          const { sendToTask } = await import("../agent-teams.js");
          const result = await sendToTask(args.taskId, args.message);
          return JSON.stringify(result);
        }

        // ── list ───────────────────────────────────────────────
        if (action === "list") {
          const { listTasks } = await import("../agent-teams.js");
          const tasks = await listTasks();
          if (tasks.length === 0) {
            return "No sub-agent tasks.";
          }
          return JSON.stringify(
            tasks.map((t) => ({
              taskId: t.taskId,
              threadId: t.threadId,
              parentThreadId: t.parentThreadId,
              name: t.name,
              description: t.description,
              status: t.status,
              currentStep: t.currentStep,
              hasResult: t.summary.length > 0,
            })),
            null,
            2,
          );
        }

        throw new Error(
          `Unknown action '${action}'. Use one of: spawn, status, read-result, send, list`,
        );
      },
    },
  };
}
