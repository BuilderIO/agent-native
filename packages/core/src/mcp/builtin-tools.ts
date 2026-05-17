/**
 * Generic cross-app MCP tools — a stable verb set every external agent gets
 * regardless of which template it is talking to.
 *
 * These are merged into the MCP action registry by
 * `createMCPServerForRequest` (see `build-server.ts`). **Precedence: template
 * actions win.** If a template defines an action named `list_apps` /
 * `open_app` / `ask_app` / `create_workspace_app` / `list_templates`, the
 * template's `ActionEntry` overwrites the builtin of the same name. This is
 * the same template-over-framework precedence `autoDiscoverActions` uses.
 *
 * | Tool                  | Side effects | Returns                                  |
 * | --------------------- | ------------ | ---------------------------------------- |
 * | `list_apps`           | none         | `{ apps: [{ id, url, running }] }`       |
 * | `open_app`            | none         | `{ url }` (+ deep-link `link`)           |
 * | `ask_app`             | agent loop   | `{ app, response }`                      |
 * | `create_workspace_app`| scaffolds    | `{ name, url, port, deepLink }` (+ link) |
 * | `list_templates`      | none         | `{ templates: [...] }` (allow-list only) |
 *
 * Node-only at call time (workspace resolution + scaffolding use `fs`), but
 * the module has no top-level Node imports so it bundles fine alongside
 * `mountMCP` — the Node bits are dynamically imported inside `run()`.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import { buildDeepLink } from "../server/deep-link.js";
import type { MCPConfig } from "./build-server.js";

import type { ActionTool } from "../agent/types.js";

/** Flat map of param name → JSON-schema property. */
type Params = Record<
  string,
  { type: string; description?: string; enum?: string[] }
>;

/**
 * Build an `ActionTool`. `parameters` is wrapped in the
 * `{ type:"object", properties, required }` shape `createMCPServerForRequest`
 * forwards verbatim as the MCP tool `inputSchema`.
 */
function tool(
  description: string,
  parameters?: Params,
  required?: string[],
): ActionTool {
  if (!parameters) return { description };
  return {
    description,
    parameters: {
      type: "object",
      properties: parameters,
      ...(required && required.length ? { required } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// list_apps
// ---------------------------------------------------------------------------

function listAppsTool(): ActionEntry {
  return {
    tool: tool(
      "List the workspace apps and their local dev URLs/ports. Use this to " +
        "discover which apps exist before opening or asking one. In a single-" +
        "app project this returns just that app.",
    ),
    readOnly: true,
    parallelSafe: true,
    run: async () => {
      const { resolveWorkspace } = await import("./workspace-resolve.js");
      const ws = await resolveWorkspace();
      return {
        workspace: ws.isWorkspace,
        gatewayUrl: ws.gatewayUrl,
        apps: ws.apps.map((a) => ({
          id: a.id,
          url: a.url,
          port: a.port,
          running: a.running,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// open_app
// ---------------------------------------------------------------------------

function openAppTool(): ActionEntry {
  return {
    tool: tool(
      "Build a deep link that opens an app at a specific view/record. No side " +
        "effects — returns a URL the user can click to land in the running UI. " +
        'After calling, surface the returned "Open in … →" link to the user.',
      {
        app: { type: "string", description: "App id, e.g. 'mail'" },
        view: {
          type: "string",
          description: "Target view, e.g. 'inbox' (maps to navigate command)",
        },
        params: {
          type: "object",
          description:
            "Optional record-focus / filter params, e.g. { threadId: 'abc' }",
        },
      },
      ["app", "view"],
    ),
    readOnly: true,
    parallelSafe: true,
    run: async (args: Record<string, any>) => {
      const app = String(args.app ?? "").trim();
      const view = String(args.view ?? "").trim();
      if (!app || !view) {
        throw new Error("open_app requires both 'app' and 'view'.");
      }
      let params: Record<string, string | number | boolean> | undefined;
      const raw = args.params;
      if (raw && typeof raw === "object") {
        params = raw as Record<string, string | number | boolean>;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          params = JSON.parse(raw);
        } catch {
          params = undefined;
        }
      }
      const url = buildDeepLink({ app, view, params });
      return { app, view, url };
    },
    link: ({ result }) => {
      if (!result || typeof result !== "object") return null;
      const r = result as { url?: string; app?: string; view?: string };
      if (!r.url) return null;
      return {
        url: r.url,
        label: `Open ${r.app ?? "app"}`,
        view: r.view,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// ask_app
// ---------------------------------------------------------------------------

function askAppTool(config: MCPConfig): ActionEntry {
  return {
    tool: tool(
      "Send a natural-language message to an app's AI agent and get its " +
        "response. Use for complex, multi-step tasks needing the agent's " +
        "reasoning and full app context. In a single-app project the 'app' " +
        "param is optional (defaults to this app).",
      {
        app: {
          type: "string",
          description: "App id to route to (optional in a single-app project)",
        },
        message: {
          type: "string",
          description: "The message to send to the app's agent",
        },
      },
      ["message"],
    ),
    run: async (args: Record<string, any>) => {
      const message = String(args.message ?? "").trim();
      if (!message) throw new Error("ask_app requires a 'message'.");
      const requestedApp = String(args.app ?? "").trim();

      // This MCP server is mounted for a single app (`config`). Delegate to
      // its own ask-agent handler — that is the same entry point the HTTP MCP
      // mount + A2A use, so there is no second agent runner. Cross-app routing
      // (talking to a *different* workspace app's agent) is intentionally not
      // done here: the stdio proxy connects to one app, and cross-app fan-out
      // is the workspace control plane's job (Dispatch / A2A).
      if (!config.askAgent) {
        throw new Error(
          "This app does not expose an agent (no ask-agent handler).",
        );
      }
      const response = await config.askAgent(message);
      return {
        app: requestedApp || config.name,
        response,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// list_templates
// ---------------------------------------------------------------------------

function listTemplatesTool(): ActionEntry {
  return {
    tool: tool(
      "List the first-party templates that can be scaffolded into a workspace " +
        "(allow-listed templates only).",
    ),
    readOnly: true,
    parallelSafe: true,
    run: async () => {
      const { visibleTemplates } = await import("../cli/templates-meta.js");
      return {
        templates: visibleTemplates().map((t) => ({
          name: t.name,
          label: t.label,
          hint: t.hint,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// create_workspace_app
// ---------------------------------------------------------------------------

function createWorkspaceAppTool(): ActionEntry {
  return {
    tool: tool(
      "Scaffold a new app into the current workspace from an allow-listed " +
        "template, then return a deep link to open it. Idempotent: if an app " +
        "with that name already exists it is reused. After calling, surface " +
        'the returned "Open … →" link to the user.',
      {
        name: {
          type: "string",
          description: "New app id (directory under apps/), e.g. 'mymail'",
        },
        template: {
          type: "string",
          description:
            "Template to scaffold from — must be allow-listed (see list_templates)",
        },
      },
      ["name", "template"],
    ),
    run: async (args: Record<string, any>) => {
      const name = String(args.name ?? "").trim();
      const template = String(args.template ?? "").trim();
      if (!name || !template) {
        throw new Error(
          "create_workspace_app requires both 'name' and 'template'.",
        );
      }

      // Enforce the strict public template allow-list. The authoritative,
      // dependency-free source inside @agent-native/core is cli/templates-meta
      // (kept in sync with packages/shared-app-config/templates.ts; CI guard).
      const { visibleTemplates } = await import("../cli/templates-meta.js");
      const allowed = new Set(visibleTemplates().map((t) => t.name));
      if (!allowed.has(template)) {
        throw new Error(
          `Template "${template}" is not allow-listed. Allowed: ${[...allowed]
            .sort()
            .join(", ")}`,
        );
      }

      const { findWorkspaceRoot, resolveWorkspace } =
        await import("./workspace-resolve.js");
      const fs = await import("node:fs");
      const path = await import("node:path");

      const root = findWorkspaceRoot(process.cwd());
      if (!root) {
        throw new Error(
          "Not inside a workspace. create_workspace_app only works in a " +
            "multi-app workspace (run from the workspace root).",
        );
      }

      const appDir = path.join(root, "apps", name);
      const alreadyExisted = fs.existsSync(appDir);

      if (!alreadyExisted) {
        // Reuse the CLI scaffolder directly (no second `agent-native`
        // subprocess). `addAppToWorkspace(name, { template })` takes the
        // non-interactive single-template path when name + one template are
        // given. Run it from the workspace root so detectWorkspace resolves.
        const prevCwd = process.cwd();
        try {
          process.chdir(root);
          const { addAppToWorkspace } = await import("../cli/create.js");
          await addAppToWorkspace(name, { template, noInstall: true });
        } finally {
          try {
            process.chdir(prevCwd);
          } catch {
            // best-effort cwd restore
          }
        }
      }

      // The workspace gateway auto-detects new apps/* dirs (fs.watch +
      // 2s sync) and lazily boots the dev server on first request, so we
      // don't spawn vite ourselves — opening the deep link warms it. Resolve
      // the port the gateway will use so we can report it.
      const ws = await resolveWorkspace(root);
      const appInfo = ws.apps.find((a) => a.id === name);
      const port = appInfo?.port;
      const deepLink = buildDeepLink({ app: name, view: "home" });

      return {
        name,
        template,
        created: !alreadyExisted,
        reused: alreadyExisted,
        port,
        url: appInfo?.url,
        gatewayUrl: ws.gatewayUrl,
        deepLink,
      };
    },
    link: ({ result }) => {
      if (!result || typeof result !== "object") return null;
      const r = result as { deepLink?: string; name?: string };
      if (!r.deepLink) return null;
      return {
        url: r.deepLink,
        label: `Open ${r.name ?? "app"}`,
        view: "home",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Build the generic cross-app builtin tool registry. Called by
 * `createMCPServerForRequest`; the result is merged UNDER the config's
 * actions so template actions of the same name win.
 */
export function getBuiltinCrossAppTools(
  config: MCPConfig,
): Record<string, ActionEntry> {
  return {
    list_apps: listAppsTool(),
    open_app: openAppTool(),
    ask_app: askAppTool(config),
    create_workspace_app: createWorkspaceAppTool(),
    list_templates: listTemplatesTool(),
  };
}
