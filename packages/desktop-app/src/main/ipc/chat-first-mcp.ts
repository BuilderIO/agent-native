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
  type ChatFirstMcpOAuthRequest,
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
  navigateMcpOAuth: (
    url: string,
    host: McpHost,
    webContentsId: number,
  ) => void | Promise<void>;
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

export function resolveMcpOAuthUrl(rawUrl: string, baseUrl: string): string {
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(rawUrl, base);
  } catch {
    throw new Error("MCP OAuth URL is invalid.");
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  if (
    basePath &&
    target.pathname.startsWith("/_agent-native/") &&
    !target.pathname.startsWith(`${basePath}/`)
  ) {
    target.pathname = `${basePath}${target.pathname}`;
  }
  if (
    target.origin !== base.origin ||
    !target.pathname.endsWith("/_agent-native/mcp/servers/oauth/start")
  ) {
    throw new Error("MCP OAuth must start inside the signed-in workspace app.");
  }
  return target.toString();
}

export function resolveMcpOAuthReturnPath(
  rawUrl: string,
  baseUrl: string,
): string | null {
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(rawUrl, base);
  } catch {
    // coercion-ok: malformed OAuth URLs are an explicit absent return path.
    return null;
  }
  const returnUrl = target.searchParams.get("return");
  if (!returnUrl) return null;
  let returnTarget: URL;
  try {
    returnTarget = new URL(returnUrl, base);
  } catch {
    // coercion-ok: malformed OAuth return paths are an explicit absent value.
    return null;
  }
  if (returnTarget.origin !== base.origin) return null;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (
    basePath &&
    returnTarget.pathname.startsWith("/") &&
    !returnTarget.pathname.startsWith(`${basePath}/`) &&
    returnTarget.pathname !== basePath
  ) {
    returnTarget.pathname = `${basePath}${returnTarget.pathname}`;
  }
  return returnTarget.pathname;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function requestMcpHost(
  host: McpHost,
  route: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const origin = new URL(host.baseUrl).origin;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MCP_REQUEST_TIMEOUT_MS);
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const cookies = await withAbort(
      host.session.cookies.get({ url: origin }),
      controller.signal,
    );
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const headers = new Headers(init.headers);
    if (cookieHeader) headers.set("cookie", cookieHeader);
    const response = await withAbort(
      fetch(routeUrl(host.baseUrl, route), {
        ...init,
        headers,
        signal: controller.signal,
      }),
      controller.signal,
    );
    const body = await withAbort(readJson(response), controller.signal);
    if (!response.ok) {
      throw new Error(
        errorFromBody(
          body,
          `MCP settings request failed (${response.status}).`,
        ),
      );
    }
    return body;
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `MCP settings request timed out after ${MCP_REQUEST_TIMEOUT_MS / 1000} seconds.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
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
    CHAT_FIRST_MCP_IPC.START_OAUTH,
    async (_event: IpcMainInvokeEvent, request: unknown): Promise<void> => {
      const host = await deps.resolveMcpHost();
      if (!host) {
        throw new Error(
          "Open a signed-in workspace app before connecting an OAuth integration.",
        );
      }
      if (!request || typeof request !== "object" || Array.isArray(request)) {
        throw new Error("MCP OAuth URL is invalid.");
      }
      const { url: rawUrl, webContentsId } =
        request as Partial<ChatFirstMcpOAuthRequest>;
      if (
        typeof rawUrl !== "string" ||
        typeof webContentsId !== "number" ||
        !Number.isInteger(webContentsId) ||
        webContentsId <= 0
      ) {
        throw new Error(
          "The signed-in Dispatch integrations tab is not ready for OAuth.",
        );
      }
      await deps.navigateMcpOAuth(
        resolveMcpOAuthUrl(rawUrl, host.baseUrl),
        host,
        webContentsId,
      );
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
