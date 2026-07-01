import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  AgentHarnessAdapter,
  AgentHarnessCapabilities,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
  AgentHarnessSession,
  AgentHarnessTurnInput,
} from "./types.js";

export type AiSdkHarnessRuntime = "claude-code" | "codex" | "pi";

export type CodexCliAuthConfig =
  | boolean
  | {
      /**
       * Local Codex home to read auth from. Defaults to CODEX_HOME, then
       * ~/.codex.
       */
      codexHome?: string;
      /**
       * Explicit local auth file path. Defaults to <codexHome>/auth.json.
       */
      authJsonPath?: string;
    };

export interface AiSdkHarnessAdapterOptions {
  runtime: AiSdkHarnessRuntime;
  label?: string;
  description?: string;
  permissionMode?: AgentHarnessCreateSessionOptions["permissionMode"];
  harnessOptions?: Record<string, unknown>;
  agentOptions?: Record<string, unknown>;
  /**
   * Opt in to copying the local Codex CLI auth file into the harness sandbox
   * before @ai-sdk/harness-codex starts. Use only with trusted/private
   * sandboxes: ChatGPT login tokens from ~/.codex/auth.json are copied into
   * the sandbox so the in-sandbox codex CLI can reuse `codex login`.
   */
  codexCliAuth?: CodexCliAuthConfig;
}

type SandboxRunResult = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type CodexCliAuthSandboxSession = {
  run(options: {
    command: string;
    abortSignal?: AbortSignal;
  }): PromiseLike<SandboxRunResult>;
  writeTextFile(options: {
    path: string;
    content: string;
    abortSignal?: AbortSignal;
  }): PromiseLike<void>;
};

export type CodexCliAuthSandboxHook = (opts: {
  session: CodexCliAuthSandboxSession;
  sessionWorkDir: string;
  abortSignal?: AbortSignal;
}) => Promise<void> | void;

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
      const agentOptions = agentOptionsWithCodexCliAuth(options);
      const agent = new HarnessAgent({
        ...agentOptions,
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

function agentOptionsWithCodexCliAuth(
  options: AiSdkHarnessAdapterOptions,
): Record<string, unknown> {
  const agentOptions = { ...(options.agentOptions ?? {}) };
  if (!options.codexCliAuth) return agentOptions;
  if (options.runtime !== "codex") {
    throw new Error(
      "[agent-harness] codexCliAuth is only supported for the codex AI SDK harness runtime.",
    );
  }
  const existingHook = agentOptions.onSandboxSession;
  if (existingHook !== undefined && typeof existingHook !== "function") {
    throw new Error(
      "[agent-harness] agentOptions.onSandboxSession must be a function when codexCliAuth is enabled.",
    );
  }
  agentOptions.onSandboxSession = createCodexCliAuthSandboxHook(
    options.codexCliAuth,
    existingHook as CodexCliAuthSandboxHook | undefined,
  );
  return agentOptions;
}

/** @internal */
export function createCodexCliAuthSandboxHook(
  config: CodexCliAuthConfig,
  existingHook?: CodexCliAuthSandboxHook,
): CodexCliAuthSandboxHook {
  const codexCliAuth = normalizeCodexCliAuthConfig(config);
  return async (hookOptions) => {
    await installCodexCliAuthIntoSandbox(codexCliAuth, hookOptions);
    await existingHook?.(hookOptions);
  };
}

/** @internal */
export function normalizeCodexCliAuthConfig(
  config: CodexCliAuthConfig,
): Required<Exclude<CodexCliAuthConfig, boolean>> {
  const input = typeof config === "object" ? config : {};
  const codexHome =
    input.codexHome ??
    // guard:allow-env-credential -- CODEX_HOME is a local auth-directory path override, not a credential value.
    process.env.CODEX_HOME ??
    path.join(os.homedir(), ".codex");
  return {
    codexHome,
    authJsonPath: input.authJsonPath ?? path.join(codexHome, "auth.json"),
  };
}

async function installCodexCliAuthIntoSandbox(
  config: Required<Exclude<CodexCliAuthConfig, boolean>>,
  opts: {
    session: CodexCliAuthSandboxSession;
    abortSignal?: AbortSignal;
  },
): Promise<void> {
  const authJson = readCodexCliAuthJson(config.authJsonPath);
  const home = await resolveSandboxHome(opts.session, opts.abortSignal);
  const codexHome = path.posix.join(home, ".codex");
  const sandboxAuthPath = path.posix.join(codexHome, "auth.json");

  const mkdirResult = await opts.session.run({
    command: `mkdir -p ${shellQuote(codexHome)} && chmod 700 ${shellQuote(codexHome)}`,
    abortSignal: opts.abortSignal,
  });
  if (mkdirResult.exitCode !== undefined && mkdirResult.exitCode !== 0) {
    throw new Error(
      `[agent-harness] Unable to create sandbox Codex home: ${mkdirResult.stderr || mkdirResult.stdout || `exit ${mkdirResult.exitCode}`}`,
    );
  }
  await opts.session.writeTextFile({
    path: sandboxAuthPath,
    content: authJson,
    abortSignal: opts.abortSignal,
  });
  const chmodResult = await opts.session.run({
    command: `chmod 600 ${shellQuote(sandboxAuthPath)}`,
    abortSignal: opts.abortSignal,
  });
  if (chmodResult.exitCode !== undefined && chmodResult.exitCode !== 0) {
    throw new Error(
      `[agent-harness] Unable to secure sandbox Codex auth file: ${chmodResult.stderr || chmodResult.stdout || `exit ${chmodResult.exitCode}`}`,
    );
  }
}

function readCodexCliAuthJson(authJsonPath: string): string {
  let authJson: string;
  try {
    authJson = fs.readFileSync(authJsonPath, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    const hint =
      code === "ENOENT"
        ? " Run `codex login`, or pass harnessOptions.auth for API-key/gateway auth."
        : "";
    throw new Error(
      `[agent-harness] Codex CLI auth file was not readable at ${authJsonPath}.${hint}`,
    );
  }
  assertCodexCliAuthJson(authJson, authJsonPath);
  return authJson;
}

function assertCodexCliAuthJson(authJson: string, authJsonPath: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    throw new Error(
      `[agent-harness] Codex CLI auth file at ${authJsonPath} is not valid JSON.`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `[agent-harness] Codex CLI auth file at ${authJsonPath} has an invalid shape.`,
    );
  }
  const record = parsed as Record<string, unknown>;
  const tokens = record.tokens;
  const hasChatGptTokens =
    tokens !== null &&
    typeof tokens === "object" &&
    (typeof (tokens as Record<string, unknown>).access_token === "string" ||
      typeof (tokens as Record<string, unknown>).refresh_token === "string");
  const hasApiKey = typeof record.OPENAI_API_KEY === "string";
  if (!hasChatGptTokens && !hasApiKey) {
    throw new Error(
      `[agent-harness] Codex CLI auth file at ${authJsonPath} does not contain usable ChatGPT tokens or an API key.`,
    );
  }
}

async function resolveSandboxHome(
  session: CodexCliAuthSandboxSession,
  abortSignal?: AbortSignal,
): Promise<string> {
  const result = await session.run({
    command: 'printf "%s" "$HOME"',
    abortSignal,
  });
  const home = result.stdout?.trim();
  if (result.exitCode !== undefined && result.exitCode !== 0) {
    throw new Error(
      `[agent-harness] Unable to resolve sandbox HOME: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
    );
  }
  if (!home || !path.posix.isAbsolute(home)) {
    throw new Error("[agent-harness] Sandbox HOME was not an absolute path.");
  }
  return home;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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
        ...(part.input !== undefined || part.args !== undefined
          ? { input: part.input ?? part.args }
          : {}),
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
