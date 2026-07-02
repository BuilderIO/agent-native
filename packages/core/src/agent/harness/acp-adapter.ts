/**
 * ACP (Agent Client Protocol) harness adapter.
 *
 * Lets Agent-Native act as an ACP *client* and drive a local coding agent —
 * Gemini CLI, Claude Code, or any other ACP-compliant agent — through the
 * existing {@link AgentHarnessAdapter} substrate. The agent runs as a local
 * subprocess that owns its own loop, tools, and workspace filesystem access,
 * which is exactly the shape ACP was designed for. See:
 * https://agentclientprotocol.com
 *
 * Scope: this adapter targets *local* coding. The agent is spawned as a child
 * process and speaks newline-delimited JSON-RPC over stdio. It reuses whatever
 * local CLI login the agent already has (e.g. `gemini`/`claude` auth in the
 * user's home dir) by inheriting the parent environment. It is not a hosted or
 * sandboxed transport, and it is not a chat/A2A transport.
 *
 * The protocol transport and framing are handled by the official
 * `@zed-industries/agent-client-protocol` package, loaded lazily as an optional
 * dependency so apps that never use ACP do not pay for it. Everything in this
 * file beyond the thin spawn/connection glue is pure mapping logic between ACP
 * `session/update` notifications and {@link AgentHarnessEvent}s.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import type {
  AgentHarnessAdapter,
  AgentHarnessApproval,
  AgentHarnessCapabilities,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
  AgentHarnessMessage,
  AgentHarnessPermissionMode,
  AgentHarnessSession,
  AgentHarnessTurnInput,
} from "./types.js";

/** Grace period between SIGTERM and SIGKILL when tearing a session down. */
const SIGKILL_GRACE_MS = 2_000;
/** Keep a bounded tail of child stderr for diagnostics. */
const STDERR_TAIL_LIMIT = 8_000;

/**
 * The optional package that carries the ACP protocol transport. Loaded lazily;
 * `resolveAgentHarness` surfaces a clear install error when it is missing.
 */
export const ACP_PACKAGE = "@zed-industries/agent-client-protocol";

export interface AcpHarnessAdapterOptions {
  /** Adapter id, e.g. "acp:gemini". Defaults to "acp". */
  name?: string;
  /** Human-readable label for pickers. */
  label?: string;
  /** Short description for pickers and diagnostics. */
  description?: string;
  /** Executable to spawn (the ACP agent binary), e.g. "gemini" or "npx". */
  command?: string;
  /** Arguments passed to the agent binary, e.g. ["--experimental-acp"]. */
  args?: string[];
  /**
   * Extra environment variables for the agent process. Merged over the parent
   * environment, which the agent inherits so it can reuse the user's local CLI
   * login.
   */
  env?: Record<string, string>;
  /** Default working directory when a turn does not specify one. */
  cwd?: string;
  /** Hint shown when the optional ACP package is missing. */
  installPackage?: string;
}

const DEFAULT_CAPABILITIES: AgentHarnessCapabilities = {
  // The agent runs locally with its own workspace access; Agent-Native does not
  // provide it an isolated sandbox.
  sandbox: false,
  // Best-effort: resumable when the agent advertises the `loadSession`
  // capability. Degrades to a fresh session per turn otherwise.
  resumable: true,
  approvals: true,
  // ACP host tools would flow through MCP servers; not wired in this adapter.
  hostTools: false,
  fileEvents: true,
};

/**
 * Indirect dynamic import so bundlers/TS do not try to resolve the optional ACP
 * package at build time (mirrors the AI SDK harness adapter).
 */
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

export function createAcpHarnessAdapter(
  options: AcpHarnessAdapterOptions,
): AgentHarnessAdapter {
  const name = options.name ?? "acp";
  return {
    name,
    label: options.label ?? "ACP Agent",
    description:
      options.description ??
      "Drives a local ACP-compliant coding agent over stdio.",
    installPackage: options.installPackage ?? ACP_PACKAGE,
    capabilities: DEFAULT_CAPABILITIES,
    async createSession(sessionOptions) {
      const command = options.command?.trim();
      if (!command) {
        throw new Error(
          `[acp-harness] Harness "${name}" requires a command. Pass { command, args } when resolving the harness (e.g. resolveAgentHarness("acp", { command: "gemini", args: ["--experimental-acp"] })).`,
        );
      }
      const acp = await dynamicImport(ACP_PACKAGE);
      const cwd = path.resolve(
        sessionOptions.cwd ?? options.cwd ?? process.cwd(),
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...(options.env ?? {}),
      };
      const child = spawn(command, options.args ?? [], {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const session = new AcpHarnessSession({
        acp,
        child,
        command,
        cwd,
        permissionMode: sessionOptions.permissionMode ?? "allow-reads",
      });
      try {
        await session.initialize(sessionOptions);
      } catch (error) {
        await session.destroy();
        throw error;
      }
      return session;
    },
  };
}

interface AcpHarnessSessionDeps {
  acp: any;
  child: ChildProcessWithoutNullStreams;
  command: string;
  cwd: string;
  permissionMode: AgentHarnessPermissionMode;
}

interface PendingPermission {
  resolve: (response: AcpPermissionResponse) => void;
  options: AcpPermissionOption[];
}

class AcpHarnessSession implements AgentHarnessSession {
  readonly id: string;

  private readonly acp: any;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly command: string;
  private readonly cwd: string;
  private readonly permissionMode: AgentHarnessPermissionMode;
  private connection: any;
  private acpSessionId = "";
  private supportsLoad = false;

  private queue: AsyncEventQueue<AgentHarnessEvent> | null = null;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly toolTitles = new Map<string, string>();
  private readonly toolInputs = new Map<string, Record<string, unknown>>();
  private approvalCounter = 0;
  private stderrTail = "";
  private childExited = false;
  private shuttingDown = false;

  constructor(deps: AcpHarnessSessionDeps) {
    this.acp = deps.acp;
    this.child = deps.child;
    this.command = deps.command;
    this.cwd = deps.cwd;
    this.permissionMode = deps.permissionMode;
    // Placeholder until newSession/loadSession assigns the real id.
    this.id = `acp-${Math.random().toString(36).slice(2)}`;

    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(
        -STDERR_TAIL_LIMIT,
      );
    });
    this.child.on("exit", () => {
      this.childExited = true;
      if (!this.shuttingDown && this.queue) {
        this.queue.push({
          type: "error",
          error: this.childExitMessage(),
        });
        this.queue.close();
      }
      this.rejectAllPending();
    });
    this.child.on("error", (error: Error) => {
      this.childExited = true;
      if (this.queue) {
        this.queue.push({
          type: "error",
          error: `[acp-harness] ${this.command}: ${error.message}`,
        });
        this.queue.close();
      }
      this.rejectAllPending();
    });
  }

  async initialize(opts: AgentHarnessCreateSessionOptions): Promise<void> {
    const stream = this.acp.ndJsonStream(
      Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>,
    );
    this.connection = new this.acp.ClientSideConnection(
      () => this.createClient(),
      stream,
    );

    const initResponse = await this.connection.initialize({
      protocolVersion: this.acp.PROTOCOL_VERSION ?? 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
    });
    this.supportsLoad = Boolean(initResponse?.agentCapabilities?.loadSession);

    const resume = opts.resumeState as
      | { sessionId?: string }
      | undefined
      | null;
    if (resume?.sessionId && this.supportsLoad) {
      try {
        await this.connection.loadSession({
          sessionId: resume.sessionId,
          cwd: this.cwd,
          mcpServers: [],
        });
        this.acpSessionId = resume.sessionId;
        return;
      } catch {
        // Fall through to a fresh session if the agent could not load it.
      }
    }

    const created = await this.connection.newSession({
      cwd: this.cwd,
      mcpServers: [],
    });
    this.acpSessionId =
      typeof created?.sessionId === "string" ? created.sessionId : this.id;
  }

  async *streamTurn(
    input: AgentHarnessTurnInput,
  ): AsyncIterable<AgentHarnessEvent> {
    if (this.childExited) {
      yield { type: "error", error: this.childExitMessage() };
      return;
    }
    const queue = new AsyncEventQueue<AgentHarnessEvent>();
    this.queue = queue;

    const abort = input.abortSignal;
    const onAbort = () => {
      this.connection?.cancel({ sessionId: this.acpSessionId }).catch(() => {});
    };
    if (abort) {
      if (abort.aborted) onAbort();
      else abort.addEventListener("abort", onAbort, { once: true });
    }

    this.connection
      .prompt({
        sessionId: this.acpSessionId,
        prompt: buildAcpPromptBlocks(input),
      })
      .then((response: AcpPromptResponse) => {
        queue.push({ type: "done", reason: response?.stopReason });
      })
      .catch((error: unknown) => {
        queue.push({ type: "error", error: acpErrorMessage(error) });
      })
      .finally(() => {
        if (abort) abort.removeEventListener("abort", onAbort);
        this.rejectAllPending();
        queue.close();
        this.queue = null;
      });

    yield* queue;
  }

  async approve(approval: AgentHarnessApproval): Promise<void> {
    const pending = this.pendingPermissions.get(approval.id);
    if (!pending) return;
    this.pendingPermissions.delete(approval.id);
    pending.resolve(
      buildAcpPermissionResponse(pending.options, approval.approved),
    );
  }

  async detach(): Promise<unknown> {
    const state = { sessionId: this.acpSessionId, cwd: this.cwd };
    await this.destroy();
    return state;
  }

  async stop(): Promise<unknown> {
    return this.detach();
  }

  async destroy(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.rejectAllPending();
    try {
      this.child.stdin?.end();
    } catch {}
    if (!this.childExited && this.child.exitCode === null) {
      try {
        this.child.kill("SIGTERM");
      } catch {}
      const killTimer = setTimeout(() => {
        try {
          if (this.child.exitCode === null) this.child.kill("SIGKILL");
        } catch {}
      }, SIGKILL_GRACE_MS);
      killTimer.unref?.();
    }
  }

  // --- ACP Client implementation (agent -> client) ---

  private createClient() {
    return {
      sessionUpdate: async (params: AcpSessionNotification) => {
        this.handleSessionUpdate(params.update);
      },
      requestPermission: async (params: AcpRequestPermissionRequest) =>
        this.handlePermission(params),
      readTextFile: async (params: AcpReadTextFileRequest) =>
        this.handleReadTextFile(params),
      writeTextFile: async (params: AcpWriteTextFileRequest) =>
        this.handleWriteTextFile(params),
    };
  }

  private handleSessionUpdate(update: AcpSessionUpdate): void {
    if (update?.sessionUpdate === "tool_call" && update.title) {
      this.toolTitles.set(update.toolCallId, update.title);
    }
    if (
      (update?.sessionUpdate === "tool_call" ||
        update?.sessionUpdate === "tool_call_update") &&
      update.rawInput
    ) {
      this.toolInputs.set(update.toolCallId, update.rawInput);
    }
    // Updates that arrive without an active turn are history replay from
    // loadSession; the transcript already contains them, so drop them.
    if (!this.queue) return;
    for (const event of acpUpdateToHarnessEvents(update, {
      titleFor: (id) => this.toolTitles.get(id),
      inputFor: (id) => this.toolInputs.get(id),
    })) {
      this.queue.push(event);
    }
  }

  private async handlePermission(
    params: AcpRequestPermissionRequest,
  ): Promise<AcpPermissionResponse> {
    const toolCall = params.toolCall ?? {};
    const decision = acpAutoPermissionDecision(
      toolCall.kind ?? undefined,
      this.permissionMode,
    );
    if (decision === "allow") {
      const optionId = selectAcpPermissionOption(params.options ?? [], true);
      if (optionId) return { outcome: { outcome: "selected", optionId } };
    }
    if (!this.queue) {
      // No surface to prompt on: decline rather than hang the agent's turn.
      return buildAcpPermissionResponse(params.options ?? [], false);
    }
    const id = `acp-approval-${++this.approvalCounter}`;
    const response = new Promise<AcpPermissionResponse>((resolve) => {
      this.pendingPermissions.set(id, {
        resolve,
        options: params.options ?? [],
      });
    });
    this.queue.push({
      type: "approval-request",
      id,
      tool: toolCall.toolCallId ?? toolCall.title,
      message: toolCall.title
        ? `Approve: ${toolCall.title}`
        : "Agent is requesting permission",
      input: toolCall.rawInput,
    });
    return response;
  }

  private async handleReadTextFile(
    params: AcpReadTextFileRequest,
  ): Promise<{ content: string }> {
    const abs = resolveAcpWorkspacePath(this.cwd, params.path);
    const raw = await fs.readFile(abs, "utf8");
    return { content: sliceTextFile(raw, params.line, params.limit) };
  }

  private async handleWriteTextFile(
    params: AcpWriteTextFileRequest,
  ): Promise<Record<string, never>> {
    const abs = resolveAcpWorkspacePath(this.cwd, params.path);
    const existed = await fileExists(abs);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, params.content, "utf8");
    this.queue?.push({
      type: "file-change",
      path: params.path,
      operation: existed ? "update" : "create",
    });
    return {};
  }

  private rejectAllPending(): void {
    if (this.pendingPermissions.size === 0) return;
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissions.clear();
  }

  private childExitMessage(): string {
    const tail = this.stderrTail.trim();
    const base = `[acp-harness] ${this.command} exited before the turn completed.`;
    return tail ? `${base}\n${tail.slice(-1_000)}` : base;
  }
}

// --- Pure helpers (exported for testing) ---

/** Build the ACP prompt content blocks for a turn. */
export function buildAcpPromptBlocks(input: {
  prompt?: string;
  messages?: AgentHarnessMessage[];
}): Array<{ type: "text"; text: string }> {
  if (input.prompt && input.prompt.trim()) {
    return [{ type: "text", text: input.prompt }];
  }
  const messages = input.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const text = messageToText(messages[i].content);
      if (text.trim()) return [{ type: "text", text }];
    }
  }
  const joined = messages
    .map((message) => messageToText(message.content))
    .filter(Boolean)
    .join("\n\n");
  return [{ type: "text", text: joined }];
}

function messageToText(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

/**
 * Translate a single ACP `session/update` payload into harness events. Pure and
 * stateless; the caller supplies a resolver for tool titles seen on earlier
 * `tool_call` updates so completion events can be labelled.
 */
export function acpUpdateToHarnessEvents(
  update: AcpSessionUpdate,
  resolvers?:
    | ((toolCallId: string) => string | undefined)
    | {
        titleFor?: (toolCallId: string) => string | undefined;
        inputFor?: (toolCallId: string) => Record<string, unknown> | undefined;
      },
): AgentHarnessEvent[] {
  const titleFor =
    typeof resolvers === "function" ? resolvers : resolvers?.titleFor;
  const inputFor =
    typeof resolvers === "function" ? undefined : resolvers?.inputFor;
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text = acpContentBlockToText(update.content);
      return text ? [{ type: "text-delta", text }] : [];
    }
    case "agent_thought_chunk": {
      const text = acpContentBlockToText(update.content);
      return text ? [{ type: "thinking-delta", text }] : [];
    }
    case "user_message_chunk":
      // The user's own message; already in the transcript.
      return [];
    case "tool_call": {
      const events: AgentHarnessEvent[] = [
        {
          type: "tool-start",
          id: update.toolCallId,
          name: update.title || update.kind || "tool",
          input: update.rawInput ?? {},
        },
      ];
      events.push(...acpFileChangeEventsFromToolContent(update.content));
      if (isTerminalToolStatus(update.status)) {
        events.push({
          type: "tool-done",
          id: update.toolCallId,
          name: update.title || titleFor?.(update.toolCallId) || "tool",
          ...((update.rawInput ?? inputFor?.(update.toolCallId))
            ? { input: update.rawInput ?? inputFor?.(update.toolCallId) }
            : {}),
          result: update.rawOutput ?? acpToolContentText(update.content),
        });
      }
      return events;
    }
    case "tool_call_update": {
      const content = update.content ?? undefined;
      const events: AgentHarnessEvent[] =
        acpFileChangeEventsFromToolContent(content);
      if (isTerminalToolStatus(update.status)) {
        events.push({
          type: "tool-done",
          id: update.toolCallId,
          name: update.title || titleFor?.(update.toolCallId) || "tool",
          ...((update.rawInput ?? inputFor?.(update.toolCallId))
            ? { input: update.rawInput ?? inputFor?.(update.toolCallId) }
            : {}),
          result: update.rawOutput ?? acpToolContentText(content),
        });
      }
      return events;
    }
    case "plan":
      return [
        {
          type: "activity",
          label: acpPlanLabel(update.entries),
          tool: "acp:plan",
        },
      ];
    case "available_commands_update":
    case "current_mode_update":
      return [];
    default:
      return [];
  }
}

function isTerminalToolStatus(status: unknown): boolean {
  return status === "completed" || status === "failed";
}

/** Extract displayable text from an ACP content block. */
export function acpContentBlockToText(
  block: AcpContentBlock | undefined,
): string {
  if (!block || typeof block !== "object") return "";
  if (block.type === "text")
    return typeof block.text === "string" ? block.text : "";
  if (block.type === "resource_link") {
    const label = block.name || block.uri || "";
    return block.uri ? `[${label}](${block.uri})` : label;
  }
  return "";
}

function acpToolContentText(
  content: AcpToolCallContent[] | undefined | null,
): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      if (entry?.type === "content")
        return acpContentBlockToText(entry.content);
      if (entry?.type === "diff" && entry.path) return `diff: ${entry.path}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Derive file-change events from a tool call's `diff` content blocks. */
export function acpFileChangeEventsFromToolContent(
  content: AcpToolCallContent[] | undefined | null,
): AgentHarnessEvent[] {
  if (!Array.isArray(content)) return [];
  const events: AgentHarnessEvent[] = [];
  for (const entry of content) {
    if (entry?.type === "diff" && typeof entry.path === "string") {
      events.push({
        type: "file-change",
        path: entry.path,
        operation:
          entry.oldText === null || entry.oldText === undefined
            ? "create"
            : "update",
      });
    }
  }
  return events;
}

function acpPlanLabel(entries: AcpPlanEntry[] | undefined): string {
  const list = Array.isArray(entries) ? entries : [];
  const total = list.length;
  const done = list.filter((entry) => entry?.status === "completed").length;
  const active = list.find((entry) => entry?.status === "in_progress");
  const suffix = active?.content ? ` — ${active.content}` : "";
  return `Updated plan (${done}/${total})${suffix}`;
}

/**
 * Map an Agent-Native permission mode onto a decision for an ACP permission
 * request, using the tool-call kind the agent reports. Reads always run; edits
 * run under `allow-edits`; everything risky prompts unless `allow-all`.
 */
export function acpAutoPermissionDecision(
  kind: string | undefined,
  mode: AgentHarnessPermissionMode,
): "allow" | "prompt" {
  if (mode === "allow-all") return "allow";
  const resolved = kind ?? "other";
  const readish =
    resolved === "read" ||
    resolved === "search" ||
    resolved === "fetch" ||
    resolved === "think";
  if (readish) return "allow";
  if (mode === "allow-edits") {
    return resolved === "edit" || resolved === "move" ? "allow" : "prompt";
  }
  return "prompt";
}

/**
 * Pick the option id to return for an ACP permission request. Prefers the
 * "once" variant so approvals do not silently become "always".
 */
export function selectAcpPermissionOption(
  options: AcpPermissionOption[],
  approved: boolean,
): string | undefined {
  const order = approved
    ? (["allow_once", "allow_always"] as const)
    : (["reject_once", "reject_always"] as const);
  for (const kind of order) {
    const match = options.find((option) => option?.kind === kind);
    if (match) return match.optionId;
  }
  return undefined;
}

function buildAcpPermissionResponse(
  options: AcpPermissionOption[],
  approved: boolean,
): AcpPermissionResponse {
  const optionId = selectAcpPermissionOption(options, approved);
  if (optionId) return { outcome: { outcome: "selected", optionId } };
  return { outcome: { outcome: "cancelled" } };
}

/**
 * Resolve a path requested by the agent against the session workspace, refusing
 * anything that escapes it. The agent already has its own filesystem tools;
 * this `fs/*` surface is a scoped convenience, not an arbitrary read/write hole.
 */
export function resolveAcpWorkspacePath(
  cwd: string,
  requestedPath: string,
): string {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) {
    throw new Error("[acp-harness] File path must be a non-empty string.");
  }
  const normalizedCwd = path.resolve(cwd);
  const abs = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(normalizedCwd, requestedPath);
  const rel = path.relative(normalizedCwd, abs);
  if (rel === "") return abs;
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(
      `[acp-harness] Refusing file access outside the session workspace: ${requestedPath}`,
    );
  }
  return abs;
}

function sliceTextFile(
  content: string,
  line?: number | null,
  limit?: number | null,
): string {
  if (line == null && limit == null) return content;
  const lines = content.split("\n");
  const start = line && line > 0 ? line - 1 : 0;
  const end = limit && limit > 0 ? start + limit : lines.length;
  return lines.slice(start, end).join("\n");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function acpErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    if (typeof record.message === "string" && record.message) {
      return record.message;
    }
    if (record.code !== undefined) {
      return `ACP request failed (code ${String(record.code)})`;
    }
  }
  return typeof error === "string" ? error : "ACP request failed";
}

// --- Minimal structural mirrors of the ACP schema (avoids a build-time dep) ---

interface AcpContentBlock {
  type: string;
  text?: string;
  uri?: string;
  name?: string;
  [key: string]: unknown;
}

interface AcpToolCallContent {
  type: string;
  content?: AcpContentBlock;
  path?: string;
  oldText?: string | null;
  newText?: string;
  terminalId?: string;
}

interface AcpPlanEntry {
  content?: string;
  status?: string;
  priority?: string;
}

export type AcpSessionUpdate =
  | {
      sessionUpdate:
        | "agent_message_chunk"
        | "user_message_chunk"
        | "agent_thought_chunk";
      content: AcpContentBlock;
    }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title: string;
      kind?: string;
      status?: string;
      content?: AcpToolCallContent[];
      rawInput?: Record<string, unknown>;
      rawOutput?: Record<string, unknown>;
      locations?: unknown[];
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      title?: string | null;
      kind?: string | null;
      status?: string | null;
      content?: AcpToolCallContent[] | null;
      rawInput?: Record<string, unknown>;
      rawOutput?: Record<string, unknown>;
    }
  | { sessionUpdate: "plan"; entries: AcpPlanEntry[] }
  | { sessionUpdate: "available_commands_update"; availableCommands: unknown[] }
  | { sessionUpdate: "current_mode_update"; currentModeId: string };

interface AcpSessionNotification {
  sessionId: string;
  update: AcpSessionUpdate;
}

interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

interface AcpRequestPermissionRequest {
  sessionId: string;
  options: AcpPermissionOption[];
  toolCall: {
    toolCallId?: string;
    title?: string;
    kind?: string | null;
    rawInput?: Record<string, unknown>;
  };
}

type AcpPermissionResponse = {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
};

interface AcpReadTextFileRequest {
  sessionId: string;
  path: string;
  line?: number | null;
  limit?: number | null;
}

interface AcpWriteTextFileRequest {
  sessionId: string;
  path: string;
  content: string;
}

interface AcpPromptResponse {
  stopReason?: string;
}

/** Minimal async queue bridging ACP's callback updates to an async iterable. */
class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) resolver({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    let resolver: ((result: IteratorResult<T>) => void) | undefined;
    while ((resolver = this.resolvers.shift())) {
      resolver({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.values.length > 0) {
          return Promise.resolve({
            value: this.values.shift() as T,
            done: false,
          });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}
