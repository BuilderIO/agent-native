import type {
  AgentHarnessAdapter,
  AgentHarnessCapabilities,
  AgentHarnessContinueInput,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
  AgentHarnessPermissionMode,
  AgentHarnessSession,
  AgentHarnessTurnInput,
} from "./types.js";

export type AiSdkHarnessRuntime = "claude-code" | "codex" | "pi";

export interface AiSdkHarnessAdapterOptions {
  runtime: AiSdkHarnessRuntime;
  label?: string;
  description?: string;
  permissionMode?: AgentHarnessCreateSessionOptions["permissionMode"];
  harnessOptions?: Record<string, unknown>;
  agentOptions?: Record<string, unknown>;
}

const RUNTIME_IMPORTS: Record<
  AiSdkHarnessRuntime,
  {
    packageName: string;
    exportNames: string[];
    label: string;
    sandbox: boolean;
  }
> = {
  "claude-code": {
    packageName: "@ai-sdk/harness-claude-code",
    exportNames: ["claudeCode", "createClaudeCode"],
    label: "Claude Code",
    sandbox: true,
  },
  codex: {
    packageName: "@ai-sdk/harness-codex",
    exportNames: ["createCodex", "codex"],
    label: "Codex",
    sandbox: true,
  },
  pi: {
    packageName: "@ai-sdk/harness-pi",
    exportNames: ["pi", "createPi"],
    label: "Pi",
    sandbox: false,
  },
};

const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

/** @internal */
export function resolveAiSdkHarnessPermissionMode(
  runtime: AiSdkHarnessRuntime,
  requested?: AgentHarnessPermissionMode,
): AgentHarnessPermissionMode {
  const permissionMode =
    requested ?? (runtime === "codex" ? "allow-all" : "allow-reads");
  if (runtime === "codex" && permissionMode !== "allow-all") {
    throw new Error(
      `[agent-harness] The Codex AI SDK harness only supports permissionMode "allow-all".`,
    );
  }
  return permissionMode;
}

/** @internal */
export function toAiSdkToolApprovalContinuation(
  approval: NonNullable<AgentHarnessContinueInput["approval"]>,
) {
  return {
    type: "tool-approval-response" as const,
    approvalId: approval.id,
    approved: approval.approved,
    ...(approval.message ? { reason: approval.message } : {}),
  };
}

export function createAiSdkHarnessAdapter(
  options: AiSdkHarnessAdapterOptions,
): AgentHarnessAdapter {
  const runtime = RUNTIME_IMPORTS[options.runtime];
  if (!runtime) {
    throw new Error(`[agent-harness] Unsupported AI SDK harness runtime`);
  }
  const capabilities: AgentHarnessCapabilities = {
    sandbox: runtime.sandbox,
    resumable: true,
    approvals: options.runtime !== "codex",
    hostTools: true,
    fileEvents: true,
  };
  return {
    name: `ai-sdk-harness:${options.runtime}`,
    label: options.label ?? runtime.label,
    description:
      options.description ??
      `Runs ${runtime.label} through the AI SDK HarnessAgent adapter.`,
    installPackage: `@ai-sdk/harness@latest ${runtime.packageName}@latest`,
    capabilities,
    async createSession(sessionOptions) {
      const permissionMode = resolveAiSdkHarnessPermissionMode(
        options.runtime,
        sessionOptions.permissionMode ?? options.permissionMode,
      );
      const [{ HarnessAgent }, runtimeModule] = await Promise.all([
        dynamicImport("@ai-sdk/harness/agent"),
        dynamicImport(runtime.packageName),
      ]);
      const exportName = runtime.exportNames.find(
        (name) => runtimeModule[name],
      );
      const harnessFactory = exportName ? runtimeModule[exportName] : undefined;
      if (!HarnessAgent || !harnessFactory) {
        throw new Error(
          `[agent-harness] AI SDK harness package "${runtime.packageName}" did not expose one of: ${runtime.exportNames.join(", ")}`,
        );
      }
      const hasHarnessOptions =
        options.harnessOptions &&
        Object.keys(options.harnessOptions).length > 0;
      const harness =
        typeof harnessFactory === "function" &&
        (hasHarnessOptions || exportName?.startsWith("create"))
          ? harnessFactory(options.harnessOptions)
          : harnessFactory;
      const agent = new HarnessAgent({
        ...(options.agentOptions ?? {}),
        harness,
        ...(sessionOptions.instructions
          ? { instructions: sessionOptions.instructions }
          : {}),
        ...(sessionOptions.skills ? { skills: sessionOptions.skills } : {}),
        ...(sessionOptions.tools ? { tools: sessionOptions.tools } : {}),
        permissionMode,
      });

      const nativeSession = await createNativeSession(agent, sessionOptions);
      return new AiSdkHarnessSession(agent, nativeSession);
    },
  };
}

/** @internal */
export async function createNativeSession(
  agent: any,
  options: AgentHarnessCreateSessionOptions,
): Promise<any> {
  if (options.resumeState != null && options.sessionId == null) {
    throw new Error(
      "[agent-harness] Resuming an AI SDK Harness session requires sessionId.",
    );
  }
  if (typeof agent.createSession !== "function") {
    throw new Error(
      "[agent-harness] HarnessAgent does not expose createSession()",
    );
  }

  const createOptions = {
    ...(options.sessionId !== undefined
      ? { sessionId: options.sessionId }
      : {}),
    ...(options.resumeState != null ? { resumeFrom: options.resumeState } : {}),
    ...(options.sandbox != null ? { sandboxSession: options.sandbox } : {}),
    ...(options.signal ? { abortSignal: options.signal } : {}),
  };
  return Object.keys(createOptions).length > 0
    ? agent.createSession(createOptions)
    : agent.createSession();
}

class AiSdkHarnessSession implements AgentHarnessSession {
  readonly id: string;
  private readonly toolCalls = new Map<
    string,
    { name: string; input?: unknown }
  >();

  constructor(
    private readonly agent: any,
    private readonly nativeSession: any,
  ) {
    this.id =
      typeof nativeSession?.id === "string"
        ? nativeSession.id
        : typeof nativeSession?.sessionId === "string"
          ? nativeSession.sessionId
          : `ai-sdk-harness-${Math.random().toString(36).slice(2)}`;
  }

  async *streamTurn(
    input: AgentHarnessTurnInput,
  ): AsyncIterable<AgentHarnessEvent> {
    const result = await this.agent.stream({
      session: this.nativeSession,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(input.messages ? { messages: input.messages } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
    for await (const part of result.fullStream ?? []) {
      for (const event of aiSdkHarnessPartToEvents(part, this.toolCalls)) {
        yield event;
      }
    }
  }

  async *continueTurn(
    input: AgentHarnessContinueInput = {},
  ): AsyncIterable<AgentHarnessEvent> {
    if (typeof this.agent.continueStream !== "function") {
      throw new Error(
        "[agent-harness] This runtime cannot continue a harness turn.",
      );
    }
    const result = await this.agent.continueStream({
      session: this.nativeSession,
      ...(input.approval
        ? {
            toolApprovalContinuations: [
              toAiSdkToolApprovalContinuation(input.approval),
            ],
          }
        : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
    for await (const part of result.fullStream ?? []) {
      for (const event of aiSdkHarnessPartToEvents(part, this.toolCalls)) {
        yield event;
      }
    }
  }

  async detach(): Promise<unknown> {
    this.toolCalls.clear();
    if (typeof this.nativeSession.detach === "function") {
      return this.nativeSession.detach();
    }
    return undefined;
  }

  async stop(): Promise<unknown> {
    this.toolCalls.clear();
    if (typeof this.nativeSession.stop === "function") {
      return this.nativeSession.stop();
    }
    return this.destroy();
  }

  async destroy(): Promise<void> {
    this.toolCalls.clear();
    await this.nativeSession.destroy?.();
  }
}

export function aiSdkHarnessPartToEvents(
  part: any,
  toolCalls = new Map<string, { name: string; input?: unknown }>(),
): AgentHarnessEvent[] {
  const type = part?.type;
  const events: AgentHarnessEvent[] = [];
  switch (type) {
    case "text-delta":
      {
        const text = typeof part.delta === "string" ? part.delta : part.text;
        if (typeof text === "string" && text) {
          events.push({ type: "text-delta", text });
        }
      }
      break;
    case "reasoning-delta":
    case "thinking-delta":
      {
        const text = typeof part.delta === "string" ? part.delta : part.text;
        if (typeof text === "string" && text) {
          events.push({ type: "thinking-delta", text });
        }
      }
      break;
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-end":
      break;
    case "tool-call":
    case "dynamic-tool-call":
      if (isSyntheticHarnessToolPart(part, "fileChange")) {
        const input = part.input ?? part.args;
        if (input && typeof input === "object" && !Array.isArray(input)) {
          const path = input.path;
          if (typeof path === "string") {
            events.push({
              type: "file-change",
              path,
              operation: normalizeFileOperation(input.event),
            });
          }
        }
        break;
      }
      if (isSyntheticHarnessToolPart(part, "compaction")) break;
      const id = part.toolCallId ?? part.id;
      const name = part.toolName ?? part.name ?? "tool";
      const input = part.input ?? part.args ?? {};
      if (typeof id === "string") toolCalls.set(id, { name, input });
      events.push({
        type: "tool-start",
        id,
        name,
        input,
      });
      break;
    case "tool-result":
    case "dynamic-tool-result":
      if (isSyntheticHarnessToolPart(part, "fileChange")) break;
      if (isSyntheticHarnessToolPart(part, "compaction")) {
        const output = part.output ?? part.result;
        events.push({
          type: "compaction",
          summary:
            output && typeof output === "object" && !Array.isArray(output)
              ? typeof output.summary === "string"
                ? output.summary
                : undefined
              : undefined,
        });
        break;
      }
      {
        const id = part.toolCallId ?? part.id;
        if (typeof id === "string") toolCalls.delete(id);
      }
      events.push({
        type: "tool-done",
        id: part.toolCallId ?? part.id,
        name: part.toolName ?? part.name ?? "tool",
        ...(part.input !== undefined || part.args !== undefined
          ? { input: part.input ?? part.args }
          : {}),
        result: part.output ?? part.result,
      });
      break;
    case "tool-approval-request": {
      const toolCall = part.toolCall ?? {};
      const toolCallId = part.toolCallId ?? toolCall.toolCallId;
      const previousToolCall =
        typeof toolCallId === "string" ? toolCalls.get(toolCallId) : undefined;
      const tool =
        part.toolName ??
        part.name ??
        toolCall.toolName ??
        toolCall.name ??
        previousToolCall?.name;
      const input =
        part.input ??
        part.args ??
        toolCall.input ??
        toolCall.args ??
        previousToolCall?.input;
      const approvalId = part.approvalId ?? part.id ?? toolCallId ?? "approval";
      if (!tool || input === undefined) {
        throw new Error(
          `[agent-harness] Approval "${approvalId}" is missing tool metadata.`,
        );
      }
      events.push({
        type: "approval-request",
        id: approvalId,
        tool,
        message: part.message ?? "Harness is waiting for approval",
        input,
      });
      if (typeof toolCallId === "string") toolCalls.delete(toolCallId);
      break;
    }
    case "file-change":
      if (part.path) {
        events.push({
          type: "file-change",
          path: String(part.path),
          operation: normalizeFileOperation(part.event ?? part.operation),
          summary: typeof part.summary === "string" ? part.summary : undefined,
        });
      }
      break;
    case "compaction":
      events.push({
        type: "compaction",
        summary: typeof part.summary === "string" ? part.summary : undefined,
      });
      break;
    case "finish":
      toolCalls.clear();
      events.push({ type: "done", reason: part.finishReason });
      break;
    case "error":
      toolCalls.clear();
      events.push({
        type: "error",
        error: part.error?.message ?? part.message ?? "Harness stream error",
      });
      break;
  }
  return events;
}

function normalizeFileOperation(
  value: unknown,
): Extract<AgentHarnessEvent, { type: "file-change" }>["operation"] {
  return value === "modify"
    ? "update"
    : value === "create" ||
        value === "update" ||
        value === "delete" ||
        value === "rename"
      ? value
      : "unknown";
}

function isSyntheticHarnessToolPart(part: any, toolName: string): boolean {
  return (
    (part?.type === "tool-call" ||
      part?.type === "dynamic-tool-call" ||
      part?.type === "tool-result" ||
      part?.type === "dynamic-tool-result") &&
    part.dynamic === true &&
    part.providerExecuted === true &&
    (part.toolName ?? part.name) === toolName
  );
}
