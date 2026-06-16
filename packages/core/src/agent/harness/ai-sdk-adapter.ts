import type {
  AgentHarnessAdapter,
  AgentHarnessCapabilities,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
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
    installPackage: `@ai-sdk/harness@canary ${runtime.packageName}@canary`,
    capabilities,
    async createSession(sessionOptions) {
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
        ...(sessionOptions.sandbox ? { sandbox: sessionOptions.sandbox } : {}),
        ...(sessionOptions.instructions
          ? { instructions: sessionOptions.instructions }
          : {}),
        ...(sessionOptions.skills ? { skills: sessionOptions.skills } : {}),
        ...(sessionOptions.tools ? { tools: sessionOptions.tools } : {}),
        permissionMode:
          sessionOptions.permissionMode ??
          options.permissionMode ??
          "allow-reads",
      });

      const nativeSession = await createNativeSession(agent, sessionOptions);
      return new AiSdkHarnessSession(agent, nativeSession);
    },
  };
}

async function createNativeSession(
  agent: any,
  options: AgentHarnessCreateSessionOptions,
): Promise<any> {
  if (options.resumeState && typeof agent.resumeSession === "function") {
    return agent.resumeSession(options.resumeState);
  }
  if (options.resumeState && typeof agent.createSession === "function") {
    try {
      return await agent.createSession({ resumeState: options.resumeState });
    } catch {
      return agent.createSession();
    }
  }
  if (typeof agent.createSession !== "function") {
    throw new Error(
      "[agent-harness] HarnessAgent does not expose createSession()",
    );
  }
  return agent.createSession();
}

class AiSdkHarnessSession implements AgentHarnessSession {
  readonly id: string;

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
      for (const event of aiSdkHarnessPartToEvents(part)) {
        yield event;
      }
    }
  }

  async *continueTurn(): AsyncIterable<AgentHarnessEvent> {
    if (typeof this.agent.continueStream !== "function") {
      return;
    }
    const result = await this.agent.continueStream({
      session: this.nativeSession,
    });
    for await (const part of result.fullStream ?? []) {
      for (const event of aiSdkHarnessPartToEvents(part)) {
        yield event;
      }
    }
  }

  async detach(): Promise<unknown> {
    if (typeof this.nativeSession.detach === "function") {
      return this.nativeSession.detach();
    }
    return undefined;
  }

  async stop(): Promise<unknown> {
    if (typeof this.nativeSession.stop === "function") {
      return this.nativeSession.stop();
    }
    return this.destroy();
  }

  async destroy(): Promise<void> {
    await this.nativeSession.destroy?.();
  }
}

export function aiSdkHarnessPartToEvents(part: any): AgentHarnessEvent[] {
  const type = part?.type;
  const events: AgentHarnessEvent[] = [];
  switch (type) {
    case "text-delta":
      if (part.text) events.push({ type: "text-delta", text: part.text });
      break;
    case "reasoning-delta":
    case "thinking-delta":
      if (part.text) events.push({ type: "thinking-delta", text: part.text });
      break;
    case "tool-input-start":
      events.push({
        type: "tool-start",
        id: part.id ?? part.toolCallId,
        name: part.toolName ?? part.name ?? "tool",
        input: {},
      });
      break;
    case "tool-call":
    case "dynamic-tool-call":
      events.push({
        type: "tool-start",
        id: part.toolCallId ?? part.id,
        name: part.toolName ?? part.name ?? "tool",
        input: part.input ?? part.args ?? {},
      });
      break;
    case "tool-result":
    case "dynamic-tool-result":
      events.push({
        type: "tool-done",
        id: part.toolCallId ?? part.id,
        name: part.toolName ?? part.name ?? "tool",
        result: part.output ?? part.result,
      });
      break;
    case "tool-approval-request":
      events.push({
        type: "approval-request",
        id: part.id ?? part.toolCallId ?? "approval",
        tool: part.toolName ?? part.name,
        message: part.message ?? "Harness is waiting for approval",
        input: part.input ?? part.args,
      });
      break;
    case "file-change":
      if (part.path) {
        events.push({
          type: "file-change",
          path: String(part.path),
          operation: normalizeFileOperation(part.operation),
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
      events.push({ type: "done", reason: part.finishReason });
      break;
    case "error":
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
  return value === "create" ||
    value === "update" ||
    value === "delete" ||
    value === "rename"
    ? value
    : "unknown";
}
