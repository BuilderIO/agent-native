import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientApp,
  type ClientCapabilities,
  type ClientConnection,
  type ClientContext,
  type ContentBlock,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type InitializeResponse,
  type KillTerminalRequest,
  type KillTerminalResponse,
  type McpServer,
  type PromptResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate,
  type Stream,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk";

import type {
  AgentHarnessAdapter,
  AgentHarnessCapabilities,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
  AgentHarnessPermissionMode,
  AgentHarnessSession,
  AgentHarnessTurnInput,
} from "./types.js";

const DEFAULT_ADAPTER_NAME = "acp:stdio";
const MAX_ACTIVITY_CHARS = 500;
const MAX_STDERR_CHARS = 8_000;

export interface AcpHarnessAdapterOptions {
  name?: string;
  label?: string;
  description?: string;
  installPackage?: string;
  /**
   * Command for a local ACP agent. The process must speak ACP over stdio.
   */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  /**
   * Custom transport for hosted, sandboxed, or test ACP agents.
   */
  connection?: AcpHarnessConnectionFactory;
  additionalDirectories?: string[];
  mcpServers?: McpServer[];
  clientCapabilities?: ClientCapabilities;
  clientInfo?: { name: string; title?: string | null; version: string };
  clientHandlers?: AcpHarnessClientHandlers;
  permissionMode?: AgentHarnessPermissionMode;
}

export interface AcpHarnessConnection {
  stream: Stream;
  close?: (reason?: unknown) => void | Promise<void>;
}

export type AcpHarnessConnectionFactory = (opts: {
  adapter: AcpHarnessAdapterOptions;
  createSession: AgentHarnessCreateSessionOptions;
  signal?: AbortSignal;
}) => AcpHarnessConnection | Promise<AcpHarnessConnection>;

export interface AcpHarnessClientHandlers {
  requestPermission?: (
    request: RequestPermissionRequest,
    context: AcpHarnessPermissionContext,
  ) => Promise<RequestPermissionResponse> | RequestPermissionResponse;
  readTextFile?: (
    request: ReadTextFileRequest,
  ) => Promise<ReadTextFileResponse> | ReadTextFileResponse;
  writeTextFile?: (
    request: WriteTextFileRequest,
  ) => Promise<WriteTextFileResponse | void> | WriteTextFileResponse | void;
  createTerminal?: (
    request: CreateTerminalRequest,
  ) => Promise<CreateTerminalResponse> | CreateTerminalResponse;
  terminalOutput?: (
    request: TerminalOutputRequest,
  ) => Promise<TerminalOutputResponse> | TerminalOutputResponse;
  releaseTerminal?: (
    request: ReleaseTerminalRequest,
  ) => Promise<ReleaseTerminalResponse | void> | ReleaseTerminalResponse | void;
  waitForTerminalExit?: (
    request: WaitForTerminalExitRequest,
  ) => Promise<WaitForTerminalExitResponse> | WaitForTerminalExitResponse;
  killTerminal?: (
    request: KillTerminalRequest,
  ) => Promise<KillTerminalResponse | void> | KillTerminalResponse | void;
}

export interface AcpHarnessPermissionContext {
  permissionMode: AgentHarnessPermissionMode;
}

type AcpTurnMessage =
  | { kind: "update"; update: SessionUpdate }
  | { kind: "stop"; response: PromptResponse }
  | { kind: "error"; error: unknown };

const ACP_HARNESS_CAPABILITIES: AgentHarnessCapabilities = {
  sandbox: true,
  resumable: true,
  approvals: true,
  hostTools: false,
  fileEvents: true,
};

export function createAcpStdioHarnessAdapter(
  options: AcpHarnessAdapterOptions = {},
): AgentHarnessAdapter {
  const label = options.label ?? "ACP stdio";
  return {
    name: options.name ?? DEFAULT_ADAPTER_NAME,
    label,
    description:
      options.description ??
      "Runs an ACP-compatible coding agent over the Agent Client Protocol.",
    installPackage: options.installPackage,
    capabilities: ACP_HARNESS_CAPABILITIES,
    async createSession(sessionOptions) {
      return createAcpHarnessSession(options, sessionOptions);
    },
  };
}

async function createAcpHarnessSession(
  options: AcpHarnessAdapterOptions,
  sessionOptions: AgentHarnessCreateSessionOptions,
): Promise<AcpHarnessSession> {
  let harnessSession: AcpHarnessSession | undefined;
  const app = createAcpClientApp(options, sessionOptions, (notification) => {
    harnessSession?.handleSessionNotification(notification);
  });
  const transport = await createAcpConnection(options, sessionOptions);
  const connection = app.connect(transport.stream);

  try {
    const initializeResponse = await initializeAcpAgent(
      connection.agent,
      options,
    );
    const sessionId = await openAcpSession(
      connection.agent,
      initializeResponse,
      options,
      sessionOptions,
    );
    harnessSession = new AcpHarnessSession({
      sessionId,
      agent: connection.agent,
      connection,
      transport,
    });
    return harnessSession;
  } catch (error) {
    connection.close(error);
    await transport.close?.(error);
    throw error;
  }
}

function createAcpClientApp(
  options: AcpHarnessAdapterOptions,
  sessionOptions: AgentHarnessCreateSessionOptions,
  onSessionNotification: (notification: SessionNotification) => void,
): ClientApp {
  const handlers = options.clientHandlers ?? {};
  const permissionMode =
    sessionOptions.permissionMode ?? options.permissionMode ?? "allow-reads";
  const app = client({ name: "agent-native-harness" })
    .onNotification(methods.client.session.update, (ctx) => {
      onSessionNotification(ctx.params);
    })
    .onRequest(methods.client.session.requestPermission, (ctx) => {
      if (handlers.requestPermission) {
        return handlers.requestPermission(ctx.params, { permissionMode });
      }
      return chooseAcpPermissionOption(ctx.params, permissionMode);
    });

  if (handlers.readTextFile) {
    app.onRequest(methods.client.fs.readTextFile, (ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handlers.readTextFile!(ctx.params),
    );
  }
  if (handlers.writeTextFile) {
    app.onRequest(methods.client.fs.writeTextFile, (ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handlers.writeTextFile!(ctx.params),
    );
  }
  if (handlers.createTerminal) {
    app.onRequest(methods.client.terminal.create, (ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handlers.createTerminal!(ctx.params),
    );
  }
  if (handlers.terminalOutput) {
    app.onRequest(methods.client.terminal.output, (ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handlers.terminalOutput!(ctx.params),
    );
  }
  if (handlers.releaseTerminal) {
    app.onRequest(methods.client.terminal.release, (ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handlers.releaseTerminal!(ctx.params),
    );
  }
  if (handlers.waitForTerminalExit) {
    app.onRequest(methods.client.terminal.waitForExit, (ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handlers.waitForTerminalExit!(ctx.params),
    );
  }
  if (handlers.killTerminal) {
    app.onRequest(methods.client.terminal.kill, (ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handlers.killTerminal!(ctx.params),
    );
  }

  return app;
}

async function initializeAcpAgent(
  agent: ClientContext,
  options: AcpHarnessAdapterOptions,
): Promise<InitializeResponse> {
  return agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: options.clientInfo ?? {
      name: "agent-native",
      title: "Agent Native",
      version: "0",
    },
    clientCapabilities: buildClientCapabilities(options),
  });
}

async function openAcpSession(
  agent: ClientContext,
  initializeResponse: InitializeResponse,
  options: AcpHarnessAdapterOptions,
  sessionOptions: AgentHarnessCreateSessionOptions,
): Promise<string> {
  const cwd = normalizeCwd(options.cwd ?? sessionOptions.cwd);
  const additionalDirectories = options.additionalDirectories?.map((dir) =>
    path.resolve(cwd, dir),
  );
  const mcpServers = options.mcpServers ?? [];
  const resumeSessionId = acpResumeSessionId(sessionOptions.resumeState);
  const supportsResume =
    Boolean(
      initializeResponse.agentCapabilities?.sessionCapabilities?.resume,
    ) && Boolean(resumeSessionId);
  const metadata = buildSessionMetadata(sessionOptions);

  if (supportsResume && resumeSessionId) {
    try {
      await agent.request(methods.agent.session.resume, {
        sessionId: resumeSessionId,
        cwd,
        ...(additionalDirectories ? { additionalDirectories } : {}),
        ...(mcpServers.length ? { mcpServers } : {}),
        ...(metadata ? { _meta: metadata } : {}),
      });
      return resumeSessionId;
    } catch {
      // Stale ACP sessions can happen after agent upgrades or sandbox resets.
      // Fall back to a fresh protocol session instead of replaying history.
    }
  }

  const session = await agent.request(methods.agent.session.new, {
    cwd,
    ...(additionalDirectories ? { additionalDirectories } : {}),
    mcpServers,
    ...(metadata ? { _meta: metadata } : {}),
  });
  return session.sessionId;
}

async function createAcpConnection(
  options: AcpHarnessAdapterOptions,
  sessionOptions: AgentHarnessCreateSessionOptions,
): Promise<AcpHarnessConnection> {
  if (options.connection) {
    return options.connection({
      adapter: options,
      createSession: sessionOptions,
      signal: sessionOptions.signal,
    });
  }
  if (!options.command) {
    throw new Error(
      `[agent-harness] ACP stdio harness requires a command or connection factory.`,
    );
  }
  return createStdioAcpConnection(options, sessionOptions);
}

async function createStdioAcpConnection(
  options: AcpHarnessAdapterOptions,
  sessionOptions: AgentHarnessCreateSessionOptions,
): Promise<AcpHarnessConnection> {
  const cwd = normalizeCwd(options.cwd ?? sessionOptions.cwd);
  const child = spawn(options.command ?? "", options.args ?? [], {
    cwd,
    env: {
      ...process.env,
      ...compactEnv(options.env),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = capString(`${stderr}${String(chunk)}`, MAX_STDERR_CHARS);
  });

  await waitForChildSpawn(child, options.command ?? "", () => stderr);

  const output = Writable.toWeb(child.stdin);
  const input = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(output, input);
  return {
    stream,
    close(reason) {
      if (child.exitCode === null && !child.killed) {
        child.kill(reason instanceof Error ? "SIGTERM" : undefined);
      }
    },
  };
}

function waitForChildSpawn(
  child: ChildProcessWithoutNullStreams,
  command: string,
  stderr: () => string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off("spawn", handleSpawn);
      child.off("error", handleError);
      child.off("exit", handleExit);
    };
    const handleSpawn = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(
        new Error(
          `[agent-harness] Unable to start ACP agent command "${command}": ${error.message}`,
        ),
      );
    };
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      const detail =
        stderr() || `exit ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`;
      reject(
        new Error(
          `[agent-harness] ACP agent command "${command}" exited before startup: ${detail}`,
        ),
      );
    };
    child.once("spawn", handleSpawn);
    child.once("error", handleError);
    child.once("exit", handleExit);
  });
}

class AcpHarnessSession implements AgentHarnessSession {
  readonly id: string;
  private readonly messages = new AsyncQueue<AcpTurnMessage>();

  constructor(
    private readonly opts: {
      sessionId: string;
      agent: ClientContext;
      connection: ClientConnection;
      transport: AcpHarnessConnection;
    },
  ) {
    this.id = opts.sessionId;
  }

  handleSessionNotification(notification: SessionNotification): void {
    if (notification.sessionId !== this.id) return;
    this.messages.push({
      kind: "update",
      update: notification.update,
    });
  }

  async *streamTurn(
    input: AgentHarnessTurnInput,
  ): AsyncIterable<AgentHarnessEvent> {
    this.messages.clear();
    const abort = () => {
      void this.opts.agent.notify(methods.agent.session.cancel, {
        sessionId: this.id,
      });
    };
    input.abortSignal?.addEventListener("abort", abort, { once: true });

    void this.opts.agent
      .request(methods.agent.session.prompt, {
        sessionId: this.id,
        prompt: agentHarnessInputToAcpPrompt(input),
        ...(input.metadata ? { _meta: input.metadata } : {}),
      })
      .then(
        (response) => this.messages.push({ kind: "stop", response }),
        (error) => this.messages.push({ kind: "error", error }),
      );

    try {
      for (;;) {
        const message = await this.messages.next();
        if (message.kind === "update") {
          for (const event of acpSessionUpdateToEvents(message.update)) {
            yield event;
          }
          continue;
        }
        if (message.kind === "error") {
          throw toError(message.error);
        }
        if (message.response.usage) {
          yield {
            type: "usage",
            inputTokens: message.response.usage.inputTokens,
            outputTokens: message.response.usage.outputTokens,
            totalTokens: message.response.usage.totalTokens,
          };
        }
        yield { type: "done", reason: message.response.stopReason };
        return;
      }
    } finally {
      input.abortSignal?.removeEventListener("abort", abort);
    }
  }

  async detach(): Promise<unknown> {
    await this.destroy();
    return {
      protocol: "acp",
      sessionId: this.id,
    };
  }

  async stop(): Promise<unknown> {
    await this.opts.agent.notify(methods.agent.session.cancel, {
      sessionId: this.id,
    });
    await this.destroy();
    return {
      protocol: "acp",
      sessionId: this.id,
    };
  }

  async destroy(): Promise<void> {
    this.opts.connection.close();
    await this.opts.transport.close?.();
    this.messages.fail(new Error("ACP harness session closed"));
  }
}

class AsyncQueue<T> {
  private values: T[] = [];
  private waiters: Array<{
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  }> = [];
  private failed: unknown;

  push(value: T): void {
    if (this.failed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(value);
      return;
    }
    this.values.push(value);
  }

  next(): Promise<T> {
    if (this.values.length > 0) {
      return Promise.resolve(this.values.shift() as T);
    }
    if (this.failed) return Promise.reject(this.failed);
    return new Promise<T>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  clear(): void {
    this.values = [];
  }

  fail(error: unknown): void {
    if (this.failed) return;
    this.failed = error;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }
}

export function acpSessionUpdateToEvents(
  update: SessionUpdate,
): AgentHarnessEvent[] {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text = contentBlockToText(update.content);
      return text ? [{ type: "text-delta", text }] : [];
    }
    case "agent_thought_chunk": {
      const text = contentBlockToText(update.content);
      return text ? [{ type: "thinking-delta", text }] : [];
    }
    case "tool_call":
      return [
        {
          type: "tool-start",
          id: update.toolCallId,
          name: toolName(update),
          input: update.rawInput ?? locationsInput(update.locations),
        },
      ];
    case "tool_call_update":
      return toolCallUpdateToEvents(update);
    case "plan":
      return [
        {
          type: "activity",
          tool: "harness:plan",
          label: capString(
            `Plan: ${update.entries.map((entry) => entry.content).join("; ")}`,
            MAX_ACTIVITY_CHARS,
          ),
        },
      ];
    case "plan_update":
      return [
        {
          type: "activity",
          tool: "harness:plan",
          label: capString(
            `Updated plan: ${planUpdateLabel(update.plan)}`,
            MAX_ACTIVITY_CHARS,
          ),
        },
      ];
    case "plan_removed":
      return [
        {
          type: "activity",
          tool: "harness:plan",
          label: `Removed plan ${update.id}`,
        },
      ];
    case "usage_update":
      return [
        {
          type: "usage",
          totalTokens: update.used,
          costCents: usdCostCents(update.cost),
        },
      ];
    case "available_commands_update":
    case "config_option_update":
    case "current_mode_update":
    case "session_info_update":
    case "user_message_chunk":
      return [];
  }
}

function toolCallUpdateToEvents(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): AgentHarnessEvent[] {
  const events: AgentHarnessEvent[] = [];
  const name = toolName(update);
  if (update.status === "completed" || update.status === "failed") {
    events.push({
      type: "tool-done",
      id: update.toolCallId,
      name,
      result: update.rawOutput ?? toolContentToResult(update.content),
    });
  } else {
    events.push({
      type: "activity",
      tool: name,
      label: capString(`${name} ${update.status ?? "updated"}`, 120),
    });
  }

  if (update.status === "completed") {
    const operation = fileOperationForToolKind(update.kind);
    for (const location of update.locations ?? []) {
      events.push({
        type: "file-change",
        path: location.path,
        operation,
      });
    }
  }
  return events;
}

function agentHarnessInputToAcpPrompt(
  input: AgentHarnessTurnInput,
): ContentBlock[] {
  if (input.prompt) return [{ type: "text", text: input.prompt }];
  return (input.messages ?? []).map((message) => ({
    type: "text",
    text: `${message.role}: ${messageContentToText(message.content)}`,
  }));
}

function messageContentToText(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  return content.map((item) => stringify(item)).join("\n");
}

function contentBlockToText(content: ContentBlock): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "resource_link":
      return content.title ?? content.name ?? content.uri;
    case "image":
      return content.uri ? `[image: ${content.uri}]` : "[image]";
    case "audio":
      return "[audio]";
    case "resource":
      return "resource" in content.resource
        ? stringify(content.resource)
        : stringify(content.resource);
  }
}

function toolContentToResult(
  content: Extract<
    SessionUpdate,
    { sessionUpdate: "tool_call_update" }
  >["content"],
): unknown {
  if (!content || content.length === 0) return undefined;
  const text = content
    .map((item) => {
      if (item.type === "content") return contentBlockToText(item.content);
      if (item.type === "terminal") return `terminal:${item.terminalId}`;
      return stringify(item);
    })
    .filter(Boolean)
    .join("\n");
  return text || content;
}

function toolName(update: {
  title?: string | null;
  kind?: string | null;
}): string {
  return update.title || update.kind || "tool";
}

function locationsInput(
  locations?: Array<{ path: string; line?: number | null }> | null,
): unknown {
  if (!locations || locations.length === 0) return {};
  return { locations };
}

function fileOperationForToolKind(
  kind: string | null | undefined,
): Extract<AgentHarnessEvent, { type: "file-change" }>["operation"] {
  if (kind === "edit") return "update";
  if (kind === "delete") return "delete";
  if (kind === "move") return "rename";
  return "unknown";
}

function planUpdateLabel(
  plan: Extract<SessionUpdate, { sessionUpdate: "plan_update" }>["plan"],
): string {
  if (plan.type === "markdown") return plan.content;
  if (plan.type === "file") return plan.uri;
  return plan.entries.map((entry) => entry.content).join("; ");
}

export function chooseAcpPermissionOption(
  request: RequestPermissionRequest,
  permissionMode: AgentHarnessPermissionMode,
): RequestPermissionResponse {
  const allowedKinds =
    permissionMode === "allow-all"
      ? ["allow_once", "allow_always"]
      : permissionMode === "allow-edits" &&
          (request.toolCall.kind === "read" || request.toolCall.kind === "edit")
        ? ["allow_once", "allow_always"]
        : permissionMode === "allow-reads" && request.toolCall.kind === "read"
          ? ["allow_once", "allow_always"]
          : [];
  const option =
    request.options.find((candidate) =>
      allowedKinds.includes(candidate.kind),
    ) ??
    request.options.find((candidate) => candidate.kind.startsWith("reject"));
  if (!option) return { outcome: { outcome: "cancelled" } };
  return {
    outcome: {
      outcome: "selected",
      optionId: option.optionId,
    },
  };
}

function buildClientCapabilities(
  options: AcpHarnessAdapterOptions,
): ClientCapabilities {
  const handlers = options.clientHandlers ?? {};
  return {
    plan: {},
    fs:
      handlers.readTextFile || handlers.writeTextFile
        ? {
            readTextFile: Boolean(handlers.readTextFile),
            writeTextFile: Boolean(handlers.writeTextFile),
          }
        : undefined,
    terminal:
      Boolean(handlers.createTerminal) &&
      Boolean(handlers.terminalOutput) &&
      Boolean(handlers.releaseTerminal) &&
      Boolean(handlers.waitForTerminalExit) &&
      Boolean(handlers.killTerminal),
    ...(options.clientCapabilities ?? {}),
  };
}

function buildSessionMetadata(
  sessionOptions: AgentHarnessCreateSessionOptions,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {
    ...(sessionOptions.metadata ?? {}),
  };
  if (sessionOptions.instructions) {
    metadata["agent-native/instructions"] = sessionOptions.instructions;
  }
  if (sessionOptions.skills) {
    metadata["agent-native/skills"] = sessionOptions.skills;
  }
  if (sessionOptions.tools) {
    metadata["agent-native/toolNames"] = Object.keys(sessionOptions.tools);
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function acpResumeSessionId(resumeState: unknown): string | undefined {
  if (typeof resumeState === "string") return resumeState;
  if (!resumeState || typeof resumeState !== "object") return undefined;
  const record = resumeState as Record<string, unknown>;
  return record.protocol === "acp" && typeof record.sessionId === "string"
    ? record.sessionId
    : undefined;
}

function normalizeCwd(cwd: string | undefined): string {
  return path.resolve(cwd ?? process.cwd());
}

function compactEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function usdCostCents(
  cost: { amount: number; currency: string } | null | undefined,
): number | undefined {
  if (!cost || cost.currency.toUpperCase() !== "USD") return undefined;
  return Math.round(cost.amount * 100);
}

function capString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...[truncated]`;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
