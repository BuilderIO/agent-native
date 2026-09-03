import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import type {
  BrowserCommand,
  BrowserHostBridgeRegistration,
  BrowserNativeHeartbeat,
  BrowserNativeRequest,
  BrowserNativeResponse,
  BrowserTaskRegistration,
} from "./protocol";

const COMMAND_PATH = "/v1/commands";
const MESSAGE_PATH = "/v1/messages";
const LONG_POLL_MS = 25_000;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

type QueueEntry = {
  request: BrowserNativeRequest;
  taskTokenHash: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type BrowserControlLoopbackBridgeOptions = {
  token?: () => string;
  requestId?: () => string;
  commandTimeoutMs?: number;
  longPollMs?: number;
};

export class BrowserControlLoopbackBridge {
  private readonly taskTokenHashes = new Map<string, string>();
  private readonly queued: QueueEntry[] = [];
  private readonly inFlight = new Map<string, QueueEntry>();
  private readonly token: () => string;
  private readonly requestId: () => string;
  private readonly commandTimeoutMs: number;
  private readonly longPollMs: number;
  private hostTokenHash?: string;
  private server?: HttpServer;
  private baseUrl?: string;
  private waitingPoll?: ServerResponse;
  private waitingPollTimer?: ReturnType<typeof setTimeout>;
  private lastHeartbeatAt?: number;

  constructor(options: BrowserControlLoopbackBridgeOptions = {}) {
    this.token = options.token ?? (() => randomBytes(32).toString("base64url"));
    this.requestId = options.requestId ?? randomUUID;
    this.commandTimeoutMs =
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.longPollMs = options.longPollMs ?? LONG_POLL_MS;
  }

  async start(): Promise<BrowserHostBridgeRegistration> {
    if (this.server && this.baseUrl && this.hostTokenHash) {
      throw new Error("Browser control bridge has already started.");
    }
    const bearerToken = this.token();
    this.hostTokenHash = hashToken(bearerToken);
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    this.server = server;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return { baseUrl: this.baseUrl, bearerToken };
  }

  registerTask(taskId: string): BrowserTaskRegistration {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId || normalizedTaskId.length > 256) {
      throw new Error("A task id of at most 256 characters is required.");
    }
    this.revokeTask(normalizedTaskId, "Task credentials were rotated.");
    const taskToken = this.token();
    this.taskTokenHashes.set(normalizedTaskId, hashToken(taskToken));
    return { taskId: normalizedTaskId, taskToken };
  }

  status(): {
    nativeHostConnected: boolean;
    lastHeartbeatAt?: string;
    registeredTasks: number;
  } {
    const connected =
      this.lastHeartbeatAt !== undefined &&
      Date.now() - this.lastHeartbeatAt < 60_000;
    return {
      nativeHostConnected: connected,
      lastHeartbeatAt: this.lastHeartbeatAt
        ? new Date(this.lastHeartbeatAt).toISOString()
        : undefined,
      registeredTasks: this.taskTokenHashes.size,
    };
  }

  execute(
    registration: BrowserTaskRegistration,
    command: BrowserCommand,
  ): Promise<unknown> {
    const taskTokenHash = this.assertTask(registration);
    return this.enqueue(registration.taskId, taskTokenHash, command, false);
  }

  async detachTask(registration: BrowserTaskRegistration): Promise<void> {
    const taskTokenHash = this.assertTask(registration);
    await this.enqueue(
      registration.taskId,
      taskTokenHash,
      { type: "detach" },
      true,
    );
  }

  async stopTask(registration: BrowserTaskRegistration): Promise<void> {
    const taskTokenHash = this.assertTask(registration);
    this.cancelTaskCommands(
      registration.taskId,
      "Task stopped before the browser command completed.",
    );
    await this.enqueue(
      registration.taskId,
      taskTokenHash,
      { type: "stop" },
      true,
    );
  }

  revokeTask(taskId: string, reason = "Browser task was revoked."): void {
    this.taskTokenHashes.delete(taskId);
    this.cancelTaskCommands(taskId, reason);
  }

  async close(): Promise<void> {
    this.hostTokenHash = undefined;
    this.baseUrl = undefined;
    this.taskTokenHashes.clear();
    this.cancelAll("Browser control bridge closed.");
    this.endWaitingPoll(503);
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private enqueue(
    taskId: string,
    taskTokenHash: string,
    command: BrowserCommand,
    priority: boolean,
  ): Promise<unknown> {
    if (!this.server) {
      return Promise.reject(new Error("Browser control bridge is not ready."));
    }
    return new Promise((resolve, reject) => {
      const id = this.requestId();
      const entry = {
        request: { id, taskId, command },
        taskTokenHash,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeEntry(id);
          reject(new Error(`Browser command ${id} timed out.`));
        }, this.commandTimeoutMs),
      } satisfies QueueEntry;
      if (priority) this.queued.unshift(entry);
      else this.queued.push(entry);
      this.flushWaitingPoll();
    });
  }

  private assertTask(registration: BrowserTaskRegistration): string {
    const expected = this.taskTokenHashes.get(registration.taskId);
    const actual = hashToken(registration.taskToken);
    if (!expected || !safeEqual(expected, actual)) {
      throw new Error("Browser task credentials are invalid or expired.");
    }
    return expected;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!isLoopback(request.socket.remoteAddress)) {
      response.writeHead(404).end();
      return;
    }
    if (!this.isAuthorized(request.headers.authorization)) {
      json(response, 401, { error: "Unauthorized" });
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && pathname === COMMAND_PATH) {
      this.handleCommandPoll(response);
      return;
    }
    if (request.method === "POST" && pathname === MESSAGE_PATH) {
      await this.handleNativeMessage(request, response);
      return;
    }
    response.writeHead(404).end();
  }

  private handleCommandPoll(response: ServerResponse): void {
    if (this.waitingPoll) {
      json(response, 409, { error: "A native-host poll is already active." });
      return;
    }
    const entry = this.takeNextValidEntry();
    if (entry) {
      this.dispatchEntry(response, entry);
      return;
    }
    this.waitingPoll = response;
    this.waitingPollTimer = setTimeout(
      () => this.endWaitingPoll(204),
      this.longPollMs,
    );
    response.once("close", () => {
      if (this.waitingPoll === response) this.clearWaitingPoll();
    });
  }

  private async handleNativeMessage(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const body = await readJson(request, MAX_MESSAGE_BYTES);
      if (isHeartbeat(body)) {
        this.lastHeartbeatAt = Date.now();
        response.writeHead(204).end();
        return;
      }
      if (!isNativeResponse(body)) {
        json(response, 400, { error: "Invalid native response." });
        return;
      }
      const entry = this.inFlight.get(body.id);
      if (!entry) {
        json(response, 404, { error: "Unknown browser command." });
        return;
      }
      this.inFlight.delete(body.id);
      clearTimeout(entry.timer);
      if (body.ok) entry.resolve(body.result);
      else {
        const error = new Error(body.error.message);
        error.name = body.error.code;
        entry.reject(error);
      }
      response.writeHead(204).end();
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "Invalid message.",
      });
    }
  }

  private isAuthorized(authorization: string | undefined): boolean {
    const prefix = "Bearer ";
    if (!authorization?.startsWith(prefix) || !this.hostTokenHash) return false;
    return safeEqual(
      this.hostTokenHash,
      hashToken(authorization.slice(prefix.length)),
    );
  }

  private flushWaitingPoll(): void {
    if (!this.waitingPoll) return;
    const entry = this.takeNextValidEntry();
    if (!entry) return;
    const response = this.waitingPoll;
    this.clearWaitingPoll();
    this.dispatchEntry(response, entry);
  }

  private dispatchEntry(response: ServerResponse, entry: QueueEntry): void {
    this.inFlight.set(entry.request.id, entry);
    json(response, 200, entry.request);
  }

  private takeNextValidEntry(): QueueEntry | undefined {
    while (this.queued.length) {
      const entry = this.queued.shift()!;
      const expected = this.taskTokenHashes.get(entry.request.taskId);
      if (expected && safeEqual(expected, entry.taskTokenHash)) return entry;
      clearTimeout(entry.timer);
      entry.reject(new Error("Browser task credentials expired."));
    }
    return undefined;
  }

  private cancelTaskCommands(taskId: string, reason: string): void {
    for (const entry of [...this.queued]) {
      if (entry.request.taskId === taskId) this.rejectEntry(entry, reason);
    }
    for (const entry of [...this.inFlight.values()]) {
      if (entry.request.taskId === taskId) this.rejectEntry(entry, reason);
    }
  }

  private cancelAll(reason: string): void {
    for (const entry of [...this.queued, ...this.inFlight.values()]) {
      this.rejectEntry(entry, reason);
    }
  }

  private rejectEntry(entry: QueueEntry, reason: string): void {
    this.removeEntry(entry.request.id);
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }

  private removeEntry(id: string): void {
    const queueIndex = this.queued.findIndex(
      (entry) => entry.request.id === id,
    );
    if (queueIndex >= 0) this.queued.splice(queueIndex, 1);
    this.inFlight.delete(id);
  }

  private endWaitingPoll(status: number): void {
    const response = this.waitingPoll;
    this.clearWaitingPoll();
    if (response && !response.writableEnded) response.writeHead(status).end();
  }

  private clearWaitingPoll(): void {
    if (this.waitingPollTimer) clearTimeout(this.waitingPollTimer);
    this.waitingPollTimer = undefined;
    this.waitingPoll = undefined;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function isLoopback(remoteAddress: string | undefined): boolean {
  return remoteAddress === "127.0.0.1" || remoteAddress === "::ffff:127.0.0.1";
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(value));
}

async function readJson(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new Error("Native message is too large.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function isHeartbeat(value: unknown): value is BrowserNativeHeartbeat {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<BrowserNativeHeartbeat>;
  return (
    input.type === "heartbeat" &&
    typeof input.activeTasks === "number" &&
    typeof input.timestamp === "string"
  );
}

function isNativeResponse(value: unknown): value is BrowserNativeResponse {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<BrowserNativeResponse>;
  if (typeof input.id !== "string" || typeof input.ok !== "boolean")
    return false;
  if (input.ok) return true;
  const error = (input as { error?: unknown }).error;
  return (
    !!error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
