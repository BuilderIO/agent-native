import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  assertValidComputerCommandEnvelope,
  type ComputerCommandEnvelope,
} from "@agent-native/core/integrations";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { BrowserControlLoopbackBridge } from "../browser-control/bridge";
import type { BrowserTaskRegistration } from "../browser-control/protocol";
import type { ComputerControlBroker } from "./broker";
import { normalizeOrigin } from "./policy";
import type { EphemeralScreenObserver } from "./screen-observer";
import type {
  ComputerPermissionStatus,
  MutationOperation,
  SemanticNode,
  SemanticSnapshot,
  SemanticTarget,
} from "./types";

const COMPUTER_MCP_PATH = "/mcp";
const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1_000;

export type DesktopComputerPermissionMode =
  | "read-only"
  | "ask-before-edit"
  | "auto-edit"
  | "full-auto";

interface RunContext {
  runId: string;
  permissionMode: DesktopComputerPermissionMode;
  latestSnapshot?: SemanticSnapshot;
  leaseToken?: string;
  browserRegistration?: BrowserTaskRegistration;
  browserObservationId?: string;
  browserOrigin?: string;
  connector?: boolean;
  remoteBrowserRegistrations?: Map<string, BrowserTaskRegistration>;
  remoteSequences?: Map<string, number>;
  remoteResults?: Map<string, unknown>;
}

export interface DesktopComputerMcpRegistration {
  url: string;
  bearerToken: string;
}

export interface DesktopComputerMcpBridgeOptions {
  broker: ComputerControlBroker;
  permissionStatus: () => ComputerPermissionStatus;
  screenObserver?: EphemeralScreenObserver;
  browserBridge?: BrowserControlLoopbackBridge;
  browserNativeHostInstalled?: () => boolean;
  browserExtensionPath?: () => string | undefined;
  token?: () => string;
  leaseTtlMs?: number;
}

/**
 * One loopback MCP endpoint for the lifetime of the desktop process. Each child
 * run gets an independent random bearer credential whose server-side record is
 * the sole source of task identity and permission mode.
 */
export class DesktopComputerMcpBridge {
  private readonly contextsByTokenHash = new Map<string, RunContext>();
  private readonly tokenHashesByRun = new Map<string, Set<string>>();
  private readonly requestContext = new AsyncLocalStorage<RunContext>();
  private readonly token: () => string;
  private readonly leaseTtlMs: number;
  private httpServer?: HttpServer;
  private url?: string;

  constructor(private readonly options: DesktopComputerMcpBridgeOptions) {
    this.token = options.token ?? (() => randomBytes(32).toString("base64url"));
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  }

  async start(): Promise<string> {
    if (this.url) return this.url;
    const httpServer = createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
    const address = httpServer.address() as AddressInfo;
    this.httpServer = httpServer;
    this.url = `http://127.0.0.1:${address.port}${COMPUTER_MCP_PATH}`;
    return this.url;
  }

  registerRun(
    runId: string,
    permissionMode: DesktopComputerPermissionMode,
  ): DesktopComputerMcpRegistration {
    if (!this.url) throw new Error("Desktop computer MCP bridge is not ready.");
    if (!runId.trim()) throw new Error("A run id is required.");
    for (const previous of this.removeCredentials(runId)) {
      this.stopBrowserContext(previous);
    }
    const bearerToken = this.token();
    const tokenHash = hashToken(bearerToken);
    this.contextsByTokenHash.set(tokenHash, {
      runId,
      permissionMode,
      browserRegistration: this.options.browserBridge?.registerTask(runId),
    });
    this.tokenHashesByRun.set(runId, new Set([tokenHash]));
    return { url: this.url, bearerToken };
  }

  registerConnector(): DesktopComputerMcpRegistration {
    if (!this.url) throw new Error("Desktop computer MCP bridge is not ready.");
    const runId = "__remote_connector__";
    for (const previous of this.removeCredentials(runId)) {
      void this.stopBrowserContext(previous);
    }
    const bearerToken = this.token();
    const tokenHash = hashToken(bearerToken);
    this.contextsByTokenHash.set(tokenHash, {
      runId,
      permissionMode: "full-auto",
      connector: true,
      remoteBrowserRegistrations: new Map(),
      remoteSequences: new Map(),
      remoteResults: new Map(),
    });
    this.tokenHashesByRun.set(runId, new Set([tokenHash]));
    return { url: this.url, bearerToken };
  }

  async revokeRun(runId: string): Promise<void> {
    const contexts = this.removeCredentials(runId);
    this.options.screenObserver?.clear(runId);
    await Promise.allSettled([
      this.options.broker.kill(runId),
      ...contexts.map((context) => this.stopBrowserContext(context)),
    ]);
  }

  async close(): Promise<void> {
    const contexts = [...this.contextsByTokenHash.values()];
    this.contextsByTokenHash.clear();
    this.tokenHashesByRun.clear();
    this.options.screenObserver?.clear();
    await Promise.allSettled(
      contexts.map((context) => this.stopBrowserContext(context)),
    );
    await this.options.browserBridge?.close();
    await this.options.broker.kill();
    this.options.broker.close();
    const server = this.httpServer;
    this.httpServer = undefined;
    this.url = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private removeCredentials(runId: string): RunContext[] {
    const contexts: RunContext[] = [];
    for (const tokenHash of this.tokenHashesByRun.get(runId) ?? []) {
      const context = this.contextsByTokenHash.get(tokenHash);
      if (context) contexts.push(context);
      this.contextsByTokenHash.delete(tokenHash);
    }
    this.tokenHashesByRun.delete(runId);
    return contexts;
  }

  private async stopBrowserContext(context: RunContext): Promise<void> {
    const bridge = this.options.browserBridge;
    const registration = context.browserRegistration;
    context.browserRegistration = undefined;
    context.browserObservationId = undefined;
    if (bridge && context.remoteBrowserRegistrations) {
      const registrations = [...context.remoteBrowserRegistrations.values()];
      context.remoteBrowserRegistrations.clear();
      await Promise.allSettled(
        registrations.map(async (remoteRegistration) => {
          try {
            await stopBrowserTaskBounded(bridge, remoteRegistration);
          } finally {
            bridge.revokeTask(remoteRegistration.taskId);
          }
        }),
      );
    }
    if (!bridge || !registration) return;
    try {
      await stopBrowserTaskBounded(bridge, registration);
    } finally {
      bridge.revokeTask(context.runId);
    }
  }

  private async handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (
      request.url !== COMPUTER_MCP_PATH ||
      !isLoopbackAddress(request.socket.remoteAddress)
    ) {
      response.writeHead(404).end();
      return;
    }
    const token = readBearerToken(request.headers.authorization);
    const context = token
      ? this.contextsByTokenHash.get(hashToken(token))
      : undefined;
    if (!context) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (
      context.connector &&
      request.method === "POST" &&
      (await this.handleDirectConnectorRequest(context, request, response))
    ) {
      return;
    }
    const mcp = new McpServer({
      name: "agent-native-desktop-computer",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    this.registerTools(mcp);
    try {
      await mcp.connect(transport);
      response.once("close", () => {
        void transport.close().catch(() => undefined);
        void mcp.close().catch(() => undefined);
      });
      await this.requestContext.run(context, () =>
        transport.handleRequest(request, response),
      );
    } catch (error) {
      console.warn(
        "[computer-control] MCP request failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  }

  private registerTools(mcp: McpServer): void {
    mcp.registerTool(
      "computer_status",
      {
        description:
          "Read the current macOS Screen Recording and Accessibility permission status.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => this.textResult(this.options.permissionStatus()),
    );
    mcp.registerTool(
      "computer_observe",
      {
        description:
          "Observe the currently focused application as a semantic accessibility snapshot. In Auto mode this also scopes control to exactly that app and web origin.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const context = this.context();
        if (!canMutate(context.permissionMode)) {
          throw new Error(
            "Focused-app observation is disabled outside full Auto mode until a scoped human approval is available.",
          );
        }
        const snapshot = (await this.options.broker.execute("plan", {
          kind: "observe.snapshot",
          taskId: context.runId,
        })) as SemanticSnapshot;
        context.latestSnapshot = snapshot;
        context.leaseToken = undefined;
        let control: "ready" | "busy" = "busy";
        try {
          const lease = await this.options.broker.acquireLease(
            context.runId,
            scopeForSnapshot(snapshot),
            this.leaseTtlMs,
          );
          context.leaseToken = lease.token;
          control = "ready";
        } catch {
          control = "busy";
        }
        const permissions = this.options.permissionStatus();
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: "image/png" }
        > = [];
        let screen:
          | { available: true; width: number; height: number }
          | { available: false; guidance: string };
        if (
          permissions.screenRecording === "granted" &&
          this.options.screenObserver
        ) {
          try {
            const frame = await this.options.screenObserver.capture(
              context.runId,
            );
            const bytes = this.options.screenObserver.take(
              frame.handle,
              context.runId,
            );
            if (!bytes) throw new Error("Captured frame expired.");
            const data = bytes.toString("base64");
            bytes.fill(0);
            screen = {
              available: true,
              width: frame.width,
              height: frame.height,
            };
            content.push({ type: "image", data, mimeType: "image/png" });
          } catch {
            screen = {
              available: false,
              guidance:
                "Capture failed. Observe again or verify Screen Recording permission in System Settings > Privacy & Security.",
            };
          }
        } else {
          screen = {
            available: false,
            guidance:
              "Enable Agent Native in System Settings > Privacy & Security > Screen Recording to include a desktop image.",
          };
        }
        content.unshift({
          type: "text",
          text: JSON.stringify({ snapshot, control, screen }),
        });
        return { content };
      },
    );

    const targetSchema = {
      nodeId: z.string().min(1).describe("Node id from the latest snapshot"),
    };
    mcp.registerTool(
      "computer_click",
      {
        description:
          "Click a node from the latest semantic snapshot. Observe again before every mutation.",
        inputSchema: {
          ...targetSchema,
          button: z.enum(["left", "right"]).optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ nodeId, button }) =>
        this.mutate(nodeId, (taskId, leaseToken, target) => ({
          kind: "input.click",
          taskId,
          leaseToken,
          target,
          button,
        })),
    );
    mcp.registerTool(
      "computer_type",
      {
        description:
          "Type text into a node from the latest semantic snapshot. Observe again before every mutation.",
        inputSchema: { ...targetSchema, text: z.string().max(100_000) },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ nodeId, text }) =>
        this.mutate(nodeId, (taskId, leaseToken, target) => ({
          kind: "input.type",
          taskId,
          leaseToken,
          target,
          text,
        })),
    );
    mcp.registerTool(
      "computer_key",
      {
        description:
          "Press a key at a node from the latest semantic snapshot. Observe again before every mutation.",
        inputSchema: {
          ...targetSchema,
          key: z.string().min(1).max(64),
          modifiers: z.array(z.string().min(1).max(32)).max(8).optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ nodeId, key, modifiers }) =>
        this.mutate(nodeId, (taskId, leaseToken, target) => ({
          kind: "input.key",
          taskId,
          leaseToken,
          target,
          key,
          modifiers,
        })),
    );
    mcp.registerTool(
      "computer_scroll",
      {
        description:
          "Scroll at a node from the latest semantic snapshot. Observe again before every mutation.",
        inputSchema: {
          ...targetSchema,
          deltaX: z.number().finite().min(-10_000).max(10_000),
          deltaY: z.number().finite().min(-10_000).max(10_000),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ nodeId, deltaX, deltaY }) =>
        this.mutate(nodeId, (taskId, leaseToken, target) => ({
          kind: "input.scroll",
          taskId,
          leaseToken,
          target,
          deltaX,
          deltaY,
        })),
    );
    mcp.registerTool(
      "computer_kill",
      {
        description:
          "Immediately stop this task's computer control and release held input.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        const context = this.context();
        await this.options.broker.kill(context.runId);
        context.latestSnapshot = undefined;
        context.leaseToken = undefined;
        return this.textResult({ stopped: true });
      },
    );

    mcp.registerTool(
      "computer_operation",
      {
        description:
          "Execute one validated, approval-bound remote computer command envelope.",
        inputSchema: { envelope: z.unknown() },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ envelope: rawEnvelope }) => {
        const context = this.context();
        return this.textResult(
          await this.executeConnectorOperation(context, rawEnvelope),
        );
      },
    );
    mcp.registerTool(
      "computer_revoke_control",
      {
        description:
          "Revoke all remote connector browser control and detach debuggers.",
        inputSchema: { reason: z.string().max(256).optional() },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        const context = this.context();
        await this.revokeConnectorControl(context);
        return this.textResult({ revoked: true });
      },
    );

    mcp.registerTool(
      "browser_status",
      {
        description:
          "Read Agent Native Chrome extension, native-host, and task attachment status.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const context = this.context();
        return this.textResult({
          nativeHostInstalled:
            this.options.browserNativeHostInstalled?.() ?? false,
          extensionPath: this.options.browserExtensionPath?.(),
          attachedOrigin: context.browserOrigin,
          ...(this.options.browserBridge?.status() ?? {
            nativeHostConnected: false,
            registeredTasks: 0,
          }),
        });
      },
    );
    mcp.registerTool(
      "browser_attach",
      {
        description:
          "Attach this full-Auto task to one Chrome tab and exactly one approved HTTP(S) origin.",
        inputSchema: {
          tabId: z.number().int().min(0),
          origin: z.string().max(2_048),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ tabId, origin }) => {
        const context = this.assertBrowserContext();
        const exactOrigin = normalizeBrowserOrigin(origin);
        const result = await this.browserExecute(context, {
          type: "attach",
          tabId,
          allowedOrigins: [exactOrigin],
        });
        const attached = browserRecord(result);
        if (attached.origin !== exactOrigin) {
          throw new Error("Chrome attached a different origin than requested.");
        }
        context.browserOrigin = exactOrigin;
        context.browserObservationId = undefined;
        return this.textResult({ tabId, origin: exactOrigin });
      },
    );
    mcp.registerTool(
      "browser_observe",
      {
        description:
          "Observe the attached Chrome tab's accessibility tree and bounded screenshot. Full Auto is required until explicit tab approval UX exists.",
        inputSchema: {
          maxNodes: z.number().int().min(1).max(2_000).optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ maxNodes }) => {
        const context = this.assertBrowserContext();
        const raw = browserRecord(
          await this.browserExecute(context, {
            type: "observe",
            includeScreenshot: true,
            maxNodes: maxNodes ?? 400,
          }),
        );
        if (typeof raw.observationId !== "string") {
          throw new Error("Chrome returned an invalid observation.");
        }
        context.browserObservationId = raw.observationId;
        const screenshot = browserRecord(raw.screenshot, true);
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: "image/jpeg" }
        > = [
          {
            type: "text",
            text: JSON.stringify({ ...raw, screenshot: undefined }),
          },
        ];
        if (
          typeof screenshot.data === "string" &&
          screenshot.data.length <= 4 * 1024 * 1024
        ) {
          content.push({
            type: "image",
            data: screenshot.data,
            mimeType: "image/jpeg",
          });
        }
        return { content };
      },
    );
    const browserTargetSchema = {
      backendNodeId: z.number().int().min(1),
    };
    mcp.registerTool(
      "browser_click",
      {
        description:
          "Click a backend node from the latest Chrome observation. Observe again before another target action.",
        inputSchema: {
          ...browserTargetSchema,
          button: z.enum(["left", "middle", "right"]).optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ backendNodeId, button }) =>
        this.browserTargetMutation(backendNodeId, (target) => ({
          type: "click",
          target,
          button,
        })),
    );
    mcp.registerTool(
      "browser_type",
      {
        description:
          "Type into a backend node from the latest Chrome observation. Observe again before another target action.",
        inputSchema: {
          ...browserTargetSchema,
          text: z.string().max(100_000),
          replace: z.boolean().optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ backendNodeId, text, replace }) =>
        this.browserTargetMutation(backendNodeId, (target) => ({
          type: "type",
          target,
          text,
          replace,
        })),
    );
    mcp.registerTool(
      "browser_key",
      {
        description: "Press a supported key in the attached Chrome tab.",
        inputSchema: {
          key: z.enum([
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "Backspace",
            "Delete",
            "End",
            "Enter",
            "Escape",
            "Home",
            "PageDown",
            "PageUp",
            "Space",
            "Tab",
          ]),
          modifiers: z
            .array(z.enum(["alt", "control", "meta", "shift"]))
            .max(4)
            .optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ key, modifiers }) => {
        const context = this.assertBrowserContext();
        const result = await this.browserExecute(context, {
          type: "key",
          key,
          modifiers,
        });
        context.browserObservationId = undefined;
        return this.textResult(result);
      },
    );
    mcp.registerTool(
      "browser_navigate",
      {
        description:
          "Navigate within the exact origin assigned when this task attached the tab.",
        inputSchema: { url: z.string().max(16_384) },
        annotations: { readOnlyHint: false, openWorldHint: true },
      },
      async ({ url }) => {
        const context = this.assertBrowserContext();
        const parsed = new URL(url);
        if (parsed.origin !== context.browserOrigin) {
          throw new Error("Navigation cannot leave the attached origin.");
        }
        const result = await this.browserExecute(context, {
          type: "navigate",
          url: parsed.toString(),
        });
        context.browserObservationId = undefined;
        return this.textResult(result);
      },
    );
    mcp.registerTool(
      "browser_scroll",
      {
        description: "Scroll the attached Chrome tab.",
        inputSchema: {
          deltaX: z.number().finite().min(-100_000).max(100_000),
          deltaY: z.number().finite().min(-100_000).max(100_000),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ deltaX, deltaY }) => {
        const context = this.assertBrowserContext();
        const result = await this.browserExecute(context, {
          type: "scroll",
          deltaX,
          deltaY,
        });
        context.browserObservationId = undefined;
        return this.textResult(result);
      },
    );
    mcp.registerTool(
      "browser_stop",
      {
        description:
          "Stop this task's Chrome control, release input, and detach the debugger.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        const context = this.context();
        const registration = context.browserRegistration;
        if (registration && this.options.browserBridge) {
          await this.options.browserBridge.stopTask(registration);
        }
        context.browserObservationId = undefined;
        context.browserOrigin = undefined;
        return this.textResult({ stopped: true });
      },
    );
  }

  private async handleDirectConnectorRequest(
    context: RunContext,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const body = await readBoundedJson(request, 64 * 1024).catch(() => null);
    const record = browserRecord(body, true);
    if (record.method !== "tools/call") return false;
    const params = browserRecord(record.params, true);
    const args = browserRecord(params.arguments, true);
    try {
      let result: unknown;
      if (params.name === "computer_operation") {
        result = this.textResult(
          await this.executeConnectorOperation(context, args.envelope),
        );
      } else if (params.name === "computer_revoke_control") {
        await this.revokeConnectorControl(context);
        result = this.textResult({ revoked: true });
      } else {
        throw new Error("Unsupported connector computer tool.");
      }
      writeJsonRpc(response, { jsonrpc: "2.0", id: record.id ?? null, result });
    } catch (error) {
      writeJsonRpc(response, {
        jsonrpc: "2.0",
        id: record.id ?? null,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Command failed",
        },
      });
    }
    return true;
  }

  private async executeConnectorOperation(
    context: RunContext,
    rawEnvelope: unknown,
  ): Promise<unknown> {
    if (!context.connector) {
      throw new Error("Remote computer commands require connector scope.");
    }
    const envelope = await assertValidComputerCommandEnvelope(rawEnvelope);
    const cached = context.remoteResults?.get(envelope.idempotencyKey);
    if (cached !== undefined) return cached;
    const lastSequence = context.remoteSequences?.get(envelope.runId) ?? -1;
    if (envelope.sequence <= lastSequence) {
      throw new Error("Remote computer command sequence was replayed.");
    }
    const result = await this.executeRemoteBrowserEnvelope(context, envelope);
    context.remoteSequences?.set(envelope.runId, envelope.sequence);
    context.remoteResults?.set(envelope.idempotencyKey, result);
    return result;
  }

  private async revokeConnectorControl(context: RunContext): Promise<void> {
    if (!context.connector) {
      throw new Error("Remote computer revoke requires connector scope.");
    }
    await this.stopBrowserContext(context);
    context.remoteBrowserRegistrations = new Map();
  }

  private async executeRemoteBrowserEnvelope(
    context: RunContext,
    envelope: ComputerCommandEnvelope,
  ): Promise<unknown> {
    if (!envelope.operationClass.startsWith("browser.")) {
      throw new Error(
        "This connector currently advertises browser control only.",
      );
    }
    const bridge = this.options.browserBridge;
    const registrations = context.remoteBrowserRegistrations;
    if (!bridge || !registrations) {
      throw new Error("Browser control is unavailable.");
    }
    const action = browserRecord(envelope.action);
    const input = browserRecord(action.input, true);
    const target = browserRecord(action.target, true);
    const taskId = envelope.runId;
    if (action.type === "browser.attach") {
      const tabId = Number(input.tabId);
      const origin = normalizeBrowserOrigin(String(input.origin ?? ""));
      if (!Number.isInteger(tabId) || tabId < 0) {
        throw new Error("browser.attach requires a valid tab id.");
      }
      const previous = registrations.get(taskId);
      if (previous) {
        await bridge.stopTask(previous).catch(() => undefined);
        bridge.revokeTask(taskId);
      }
      const registration = bridge.registerTask(taskId);
      registrations.set(taskId, registration);
      return bridge.execute(registration, {
        type: "attach",
        tabId,
        allowedOrigins: [origin],
      });
    }
    const registration = registrations.get(taskId);
    if (!registration) {
      throw new Error("Remote task must attach a Chrome tab first.");
    }
    switch (action.type) {
      case "browser.observe": {
        const result = browserRecord(
          await bridge.execute(registration, {
            type: "observe",
            includeScreenshot: false,
            maxNodes: 400,
          }),
        );
        return { ...result, screenshot: undefined };
      }
      case "browser.click":
        return bridge.execute(registration, {
          type: "click",
          target: remoteBrowserTarget(target),
          button:
            input.button === "middle" || input.button === "right"
              ? input.button
              : "left",
        });
      case "browser.type":
        return bridge.execute(registration, {
          type: "type",
          target: remoteBrowserTarget(target),
          text: String(input.text ?? "").slice(0, 100_000),
          replace: input.replace === true,
        });
      case "browser.navigate":
        return bridge.execute(registration, {
          type: "navigate",
          url: String(input.url ?? ""),
        });
      case "browser.scroll":
        return bridge.execute(registration, {
          type: "scroll",
          deltaX: boundedRemoteNumber(input.deltaX),
          deltaY: boundedRemoteNumber(input.deltaY),
        });
      case "browser.stop":
        await bridge.stopTask(registration);
        bridge.revokeTask(taskId);
        registrations.delete(taskId);
        return { stopped: true };
      default:
        throw new Error(`Unsupported remote browser action: ${action.type}`);
    }
  }

  private assertBrowserContext(): RunContext {
    const context = this.assertMutationContext();
    if (!context.browserRegistration || !this.options.browserBridge) {
      throw new Error("Agent Native browser control is unavailable.");
    }
    return context;
  }

  private browserExecute(
    context: RunContext,
    command: import("../browser-control/protocol").BrowserCommand,
  ) {
    return this.options.browserBridge!.execute(
      context.browserRegistration!,
      command,
    );
  }

  private async browserTargetMutation(
    backendNodeId: number,
    command: (target: {
      observationId: string;
      backendNodeId: number;
    }) => import("../browser-control/protocol").BrowserCommand,
  ) {
    const context = this.assertBrowserContext();
    const observationId = context.browserObservationId;
    if (!observationId) {
      throw new Error("Observe the Chrome tab again before targeting a node.");
    }
    try {
      const result = await this.browserExecute(
        context,
        command({ observationId, backendNodeId }),
      );
      return this.textResult(result);
    } finally {
      context.browserObservationId = undefined;
    }
  }

  private async mutate(
    nodeId: string,
    createOperation: (
      taskId: string,
      leaseToken: string,
      target: SemanticTarget,
    ) => MutationOperation,
  ) {
    const context = this.assertMutationContext();
    const snapshot = this.snapshot(context);
    const leaseToken = context.leaseToken;
    if (!leaseToken) {
      throw new Error(
        "Computer control is not leased to this task. Observe or explicitly take over first.",
      );
    }
    const node = findNode(snapshot.nodes, nodeId);
    if (!node)
      throw new Error("The requested node is not in the latest snapshot.");
    const target: SemanticTarget = {
      snapshotId: snapshot.snapshotId,
      nodeId,
      bundleId: snapshot.bundleId,
      origin: normalizeOrigin(snapshot.origin),
      expectedRole: node.role,
    };
    try {
      await this.options.broker.execute(
        "act",
        createOperation(context.runId, leaseToken, target),
      );
      return this.textResult({ ok: true, observeRequired: true });
    } finally {
      // One semantic snapshot authorizes at most one mutation. This prevents a
      // second action from targeting UI that the first action may have changed.
      context.latestSnapshot = undefined;
    }
  }

  private context(): RunContext {
    const context = this.requestContext.getStore();
    if (!context)
      throw new Error("Desktop computer request is unauthenticated.");
    return context;
  }

  private assertMutationContext(): RunContext {
    const context = this.context();
    if (!canMutate(context.permissionMode)) {
      throw new Error(
        "Computer mutations require the task's full Auto permission mode.",
      );
    }
    return context;
  }

  private snapshot(context: RunContext): SemanticSnapshot {
    if (!context.latestSnapshot) {
      throw new Error("Observe the focused application again before acting.");
    }
    return context.latestSnapshot;
  }

  private textResult(value: unknown) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
    };
  }
}

function canMutate(mode: DesktopComputerPermissionMode): boolean {
  return mode === "full-auto";
}

function normalizeBrowserOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Browser origin must be one exact HTTP(S) origin.");
  }
  return url.origin;
}

function browserRecord(
  value: unknown,
  optional = false,
): Record<string, unknown> {
  if (optional && value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Chrome returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function remoteBrowserTarget(value: Record<string, unknown>): {
  observationId: string;
  backendNodeId: number;
} {
  const observationId = value.observationId;
  const backendNodeId = Number(value.backendNodeId);
  if (
    typeof observationId !== "string" ||
    !observationId ||
    !Number.isInteger(backendNodeId) ||
    backendNodeId < 1
  ) {
    throw new Error("Remote browser target is invalid.");
  }
  return { observationId, backendNodeId };
}

function boundedRemoteNumber(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < -100_000 || number > 100_000) {
    throw new Error("Remote browser numeric input is out of bounds.");
  }
  return number;
}

function scopeForSnapshot(snapshot: SemanticSnapshot) {
  const origin = normalizeOrigin(snapshot.origin);
  return {
    bundleIds: [snapshot.bundleId],
    origins: origin ? [origin] : [],
  };
}

function findNode(
  nodes: readonly SemanticNode[],
  id: string,
): SemanticNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = node.children ? findNode(node.children, id) : undefined;
    if (child) return child;
  }
  return undefined;
}

function readBearerToken(value: string | undefined): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(value ?? "");
  return match?.[1];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

async function readBoundedJson(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) throw new Error("Connector request is too large.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJsonRpc(response: ServerResponse, value: unknown): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(value));
}

async function stopBrowserTaskBounded(
  bridge: BrowserControlLoopbackBridge,
  registration: BrowserTaskRegistration,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      bridge.stopTask(registration),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
