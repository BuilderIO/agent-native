import path from "node:path";

import { importAgentPlugin } from "@agent-native/core/cli/agent-plugin";
import type {
  CreateMcpServerArgs,
  McpServersList,
  McpServerScope,
  TestMcpUrlResult,
} from "@agent-native/core/client/resources";
import {
  CHAT_FIRST_MCP_IPC,
  type ChatFirstMcpPluginImportResult,
} from "@shared/chat-first-mcp";
import {
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type Session,
} from "electron";

export interface McpHost {
  baseUrl: string;
  session: Session;
}

export interface ChatFirstMcpIpcDeps {
  resolveMcpHost: () => Promise<McpHost | null>;
  codeAgentWorkspaceRoot: () => string;
}

const MCP_REQUEST_TIMEOUT_MS = 10_000;

function routeUrl(baseUrl: string, route: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(route.replace(/^\//, ""), base).toString();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = (await response.text()).trim();
  if (!text) {
    if (response.status === 204) return {};
    throw new Error(
      `MCP settings returned an empty response (${response.status}).`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`MCP settings returned invalid JSON (${response.status}).`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `MCP settings returned an invalid JSON object (${response.status}).`,
    );
  }
  return objectValue(parsed);
}

function errorFromBody(
  body: Record<string, unknown>,
  fallback: string,
): string {
  return typeof body.error === "string" && body.error.trim()
    ? body.error.trim()
    : fallback;
}

async function requestMcpHost(
  host: McpHost,
  route: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const origin = new URL(host.baseUrl).origin;
  const cookies = await host.session.cookies.get({ url: origin });
  const cookieHeader = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const headers = new Headers(init.headers);
  if (cookieHeader) headers.set("cookie", cookieHeader);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(routeUrl(host.baseUrl, route), {
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `MCP settings request timed out after ${MCP_REQUEST_TIMEOUT_MS / 1000} seconds.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      errorFromBody(body, `MCP settings request failed (${response.status}).`),
    );
  }
  return body;
}

export function registerChatFirstMcpIpc(deps: ChatFirstMcpIpcDeps): void {
  async function request(
    route: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const host = await deps.resolveMcpHost();
    if (!host) {
      throw new Error(
        "Open a signed-in workspace app before managing MCP connections.",
      );
    }
    return requestMcpHost(host, route, init);
  }

  ipcMain.handle(CHAT_FIRST_MCP_IPC.LIST, async (): Promise<McpServersList> => {
    const body = await request("/_agent-native/mcp/servers");
    return body as unknown as McpServersList;
  });

  ipcMain.handle(
    CHAT_FIRST_MCP_IPC.CREATE,
    async (_event: IpcMainInvokeEvent, args: CreateMcpServerArgs) => {
      const body = await request("/_agent-native/mcp/servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (body.ok !== true || !body.server) {
        throw new Error(errorFromBody(body, "Could not save the MCP server."));
      }
      return body.server;
    },
  );

  ipcMain.handle(
    CHAT_FIRST_MCP_IPC.DELETE,
    async (
      _event: IpcMainInvokeEvent,
      args: { id: string; scope: McpServerScope },
    ): Promise<void> => {
      const body = await request(
        `/_agent-native/mcp/servers/${encodeURIComponent(args.id)}?scope=${args.scope}`,
        { method: "DELETE" },
      );
      if (body.ok !== true) {
        throw new Error(
          errorFromBody(body, "Could not remove the MCP server."),
        );
      }
    },
  );

  ipcMain.handle(
    CHAT_FIRST_MCP_IPC.RECONNECT,
    async (
      _event: IpcMainInvokeEvent,
      args: { id: string; scope: McpServerScope },
    ): Promise<void> => {
      const body = await request(
        `/_agent-native/mcp/servers/${encodeURIComponent(args.id)}/reconnect?scope=${args.scope}`,
        { method: "POST" },
      );
      if (body.ok !== true) {
        throw new Error(
          errorFromBody(body, "Could not reconnect the MCP server."),
        );
      }
    },
  );

  ipcMain.handle(
    CHAT_FIRST_MCP_IPC.TEST,
    async (
      _event: IpcMainInvokeEvent,
      args: { url: string; headers?: Record<string, string> },
    ): Promise<TestMcpUrlResult> => {
      const body = await request("/_agent-native/mcp/servers/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      return body as unknown as TestMcpUrlResult;
    },
  );

  ipcMain.handle(
    CHAT_FIRST_MCP_IPC.TEST_EXISTING,
    async (
      _event: IpcMainInvokeEvent,
      args: { id: string; scope: McpServerScope },
    ): Promise<TestMcpUrlResult> => {
      const body = await request(
        `/_agent-native/mcp/servers/${encodeURIComponent(args.id)}/test?scope=${args.scope}`,
        { method: "POST" },
      );
      return body as unknown as TestMcpUrlResult;
    },
  );

  ipcMain.handle(
    CHAT_FIRST_MCP_IPC.IMPORT_PLUGIN,
    async (): Promise<ChatFirstMcpPluginImportResult> => {
      const selection = await dialog.showOpenDialog({
        title: "Import Agent Plugin",
        properties: ["openDirectory"],
      });
      if (selection.canceled || selection.filePaths.length === 0) {
        return { ok: false, error: "Import cancelled." };
      }
      try {
        const workspaceRoot = deps.codeAgentWorkspaceRoot();
        const result = importAgentPlugin(selection.filePaths[0]!, {
          targetDir: workspaceRoot,
          skillsTargetDir: path.join(workspaceRoot, ".agents", "skills"),
        });
        return {
          ok: true,
          plugin: {
            name: result.plugin.name,
            ...(result.plugin.version
              ? { version: result.plugin.version }
              : {}),
          },
          skills: result.skills.length,
          mcpServers: result.mcpServers.length,
          skipped: result.skipped,
          warnings: result.warnings,
          targetDir: result.targetDir,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
