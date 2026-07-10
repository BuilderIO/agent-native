import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

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

  async revokeRun(runId: string): Promise<void> {
    const contexts = this.removeCredentials(runId);
    this.options.screenObserver?.clear(runId);
    await Promise.allSettled([
      this.options.broker.kill(runId),
      ...contexts.map((context) => this.stopBrowserContext(context)),
    ]);
  }

  async close(): Promise<void> {
    this.contextsByTokenHash.clear();
    this.tokenHashesByRun.clear();
    this.options.screenObserver?.clear();
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
    if (!bridge || !registration) return;
    try {
      await bridge.stopTask(registration);
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
