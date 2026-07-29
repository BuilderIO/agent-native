import path from "node:path";

import type {
  AgentHarnessAdapter,
  AgentHarnessEvent,
  AgentHarnessHostTool,
  AgentHarnessPermissionMode,
  AgentHarnessSession,
  AgentHarnessTurnInput,
} from "./types.js";

export const LOCAL_PI_PACKAGE = "@earendil-works/pi-coding-agent@latest";

export interface LocalPiHarnessAdapterOptions {
  label?: string;
  description?: string;
  cwd?: string;
  agentDir?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /**
   * Pi-native tools available in app chat. Defaults to read-only filesystem
   * tools; app operations are supplied separately as scoped host tools.
   */
  nativeTools?: string[];
}

export interface LocalPiResumeState {
  sessionFile: string;
}

type PiModule = {
  createAgentSession(options: Record<string, unknown>): Promise<{
    session: PiSession;
  }>;
  DefaultResourceLoader: new (options: Record<string, unknown>) => {
    reload(): Promise<void>;
  };
  SessionManager: {
    create(cwd: string, sessionDir?: string): unknown;
    open(sessionFile: string, sessionDir?: string): unknown;
  };
  SettingsManager: {
    create(cwd?: string, agentDir?: string): unknown;
  };
  getAgentDir(): string;
};

type PiSession = {
  sessionId: string;
  sessionFile?: string;
  prompt(text: string, options?: Record<string, unknown>): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
};

const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<PiModule>;

export function createLocalPiHarnessAdapter(
  options: LocalPiHarnessAdapterOptions = {},
): AgentHarnessAdapter {
  return {
    name: "pi:local",
    label: options.label ?? "Local Pi",
    description:
      options.description ??
      "Runs Pi in the local Node process using Pi-owned configuration and credentials.",
    installPackage: LOCAL_PI_PACKAGE,
    capabilities: {
      sandbox: false,
      resumable: true,
      approvals: false,
      hostTools: true,
      fileEvents: false,
    },
    async createSession(sessionOptions) {
      const pi = await dynamicImport("@earendil-works/pi-coding-agent");
      const cwd = sessionOptions.cwd ?? options.cwd ?? process.cwd();
      const agentDir = options.agentDir ?? pi.getAgentDir();
      const sessionDir = path.join(agentDir, "sessions");
      const settingsManager = pi.SettingsManager.create(cwd, agentDir);
      const resourceLoader = new pi.DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        ...(sessionOptions.instructions
          ? { appendSystemPrompt: [sessionOptions.instructions] }
          : {}),
      });
      await resourceLoader.reload();

      const resume = normalizeLocalPiResumeState(
        sessionOptions.resumeState,
        sessionDir,
      );
      const sessionManager = resume
        ? pi.SessionManager.open(resume.sessionFile, sessionDir)
        : pi.SessionManager.create(cwd, sessionDir);
      const permissionMode = sessionOptions.permissionMode ?? "allow-reads";
      const hostTools = filterLocalPiHostTools(
        sessionOptions.tools ?? {},
        permissionMode,
      );
      const customTools = localPiHostToolsToDefinitions(hostTools);
      const nativeTools = uniqueToolNames([
        ...(options.nativeTools ?? ["read", "grep", "find", "ls"]),
        ...Object.keys(hostTools),
      ]);
      const { session } = await pi.createAgentSession({
        cwd,
        agentDir,
        settingsManager,
        resourceLoader,
        sessionManager,
        tools: nativeTools,
        customTools,
        ...(options.thinkingLevel
          ? { thinkingLevel: options.thinkingLevel }
          : {}),
      });
      return new LocalPiHarnessSession(
        sessionOptions.sessionId ?? session.sessionId,
        session,
      );
    },
  };
}

export function normalizeLocalPiResumeState(
  value: unknown,
  sessionDir: string,
): LocalPiResumeState | null {
  if (!value || typeof value !== "object") return null;
  const sessionFile = (value as { sessionFile?: unknown }).sessionFile;
  if (typeof sessionFile !== "string" || !sessionFile.endsWith(".jsonl")) {
    return null;
  }
  const resolvedDir = path.resolve(sessionDir);
  const resolvedFile = path.resolve(sessionFile);
  if (
    resolvedFile !== resolvedDir &&
    !resolvedFile.startsWith(`${resolvedDir}${path.sep}`)
  ) {
    return null;
  }
  return { sessionFile: resolvedFile };
}

export function localPiSessionEventToHarnessEvents(
  value: unknown,
): AgentHarnessEvent[] {
  if (!value || typeof value !== "object") return [];
  const event = value as Record<string, any>;
  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta" && typeof update.delta === "string") {
        return [{ type: "text-delta", text: update.delta }];
      }
      if (
        update?.type === "thinking_delta" &&
        typeof update.delta === "string"
      ) {
        return [{ type: "thinking-delta", text: update.delta }];
      }
      return [];
    }
    case "tool_execution_start":
      return [
        {
          type: "tool-start",
          id: stringOrUndefined(event.toolCallId),
          name: stringOrFallback(event.toolName, "tool"),
          input: event.args,
        },
      ];
    case "tool_execution_end":
      return [
        {
          type: "tool-done",
          id: stringOrUndefined(event.toolCallId),
          name: stringOrFallback(event.toolName, "tool"),
          result: event.result,
        },
      ];
    case "compaction_start":
      return [{ type: "activity", label: "Pi is compacting context" }];
    case "compaction_end":
      return [{ type: "compaction" }];
    case "auto_retry_start":
      return [{ type: "activity", label: "Pi is retrying the model request" }];
    case "extension_error":
      return [
        {
          type: "error",
          error: stringOrFallback(
            event.error?.message ?? event.error,
            "Pi extension failed",
          ),
        },
      ];
    default:
      return [];
  }
}

export function filterLocalPiHostTools(
  tools: Record<string, AgentHarnessHostTool>,
  permissionMode: AgentHarnessPermissionMode,
): Record<string, AgentHarnessHostTool> {
  if (permissionMode !== "allow-reads") return tools;
  return Object.fromEntries(
    Object.entries(tools).filter(([, tool]) => tool.readOnly === true),
  );
}

export function localPiHostToolsToDefinitions(
  tools: Record<string, AgentHarnessHostTool>,
): Array<Record<string, unknown>> {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    label: name,
    description: tool.description,
    parameters: tool.inputSchema,
    async execute(
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
    ) {
      if (await tool.needsApproval?.(params)) {
        throw new Error(
          `Agent Native action ${name} requires approval and is unavailable in the local Pi adapter.`,
        );
      }
      const result = await tool.execute(params, {
        toolCallId,
        abortSignal: signal,
        approved: false,
      });
      return {
        content: [{ type: "text", text: stringifyLocalPiToolResult(result) }],
        details: result,
      };
    },
  }));
}

class LocalPiHarnessSession implements AgentHarnessSession {
  private disposed = false;

  constructor(
    readonly id: string,
    private readonly session: PiSession,
  ) {}

  async *streamTurn(
    input: AgentHarnessTurnInput,
  ): AsyncIterable<AgentHarnessEvent> {
    const prompt = input.prompt ?? messagesToPrompt(input.messages);
    if (!prompt.trim()) throw new Error("Pi harness prompt is required.");

    const queue: AgentHarnessEvent[] = [];
    let finished = false;
    let failure: unknown;
    let wake: (() => void) | undefined;
    const notify = () => {
      const current = wake;
      wake = undefined;
      current?.();
    };
    const unsubscribe = this.session.subscribe((event) => {
      queue.push(...localPiSessionEventToHarnessEvents(event));
      notify();
    });
    const onAbort = () => {
      void this.session.abort();
    };
    input.abortSignal?.addEventListener("abort", onAbort, { once: true });
    void this.session
      .prompt(prompt, { source: "rpc" })
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        finished = true;
        notify();
      });

    try {
      while (!finished || queue.length > 0) {
        const event = queue.shift();
        if (event) {
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (failure) throw failure;
      yield { type: "done" };
    } finally {
      unsubscribe();
      input.abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  async detach(): Promise<LocalPiResumeState> {
    const sessionFile = this.session.sessionFile;
    if (!sessionFile) {
      throw new Error("Pi did not create a persistent session file.");
    }
    this.dispose();
    return { sessionFile };
  }

  async stop(): Promise<void> {
    await this.session.abort();
    this.dispose();
  }

  async destroy(): Promise<void> {
    this.dispose();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.session.dispose();
  }
}

function messagesToPrompt(messages: AgentHarnessTurnInput["messages"]): string {
  return (messages ?? [])
    .map((message) => {
      const content =
        typeof message.content === "string"
          ? message.content
          : stringifyLocalPiToolResult(message.content);
      return `${message.role}: ${content}`;
    })
    .join("\n\n");
}

function uniqueToolNames(names: string[]): string[] {
  return Array.from(new Set(names.filter(Boolean)));
}

function stringifyLocalPiToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}
