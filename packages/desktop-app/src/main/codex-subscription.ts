import { spawn, type ChildProcess } from "node:child_process";

import type {
  SubscriptionPlan,
  SubscriptionRateLimitMeter,
  SubscriptionStatus,
  SubscriptionTelemetry,
  SubscriptionTelemetryCapabilities,
} from "../../shared/subscription-status.js";

export interface CodexCommandResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: { code?: string };
}

export type CodexCommandRunner = (
  args: string[],
  timeoutMs: number,
) => Promise<CodexCommandResult>;

export type SpawnCodexCommand = (args: string[]) => ChildProcess;

export interface CodexJsonRpcChildProcess extends ChildProcess {
  stdout: NonNullable<ChildProcess["stdout"]>;
  stdin: NonNullable<ChildProcess["stdin"]>;
}

export type SpawnCodexAppServer = () => CodexJsonRpcChildProcess;

export interface CodexAppServerClient {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onNotification(
    listener: (method: string, params: unknown) => void,
  ): () => void;
  onExit(listener: () => void): () => void;
  close(): void;
}

export type CodexAppServerErrorCode =
  | "METHOD_NOT_FOUND"
  | "TIMEOUT"
  | "TRANSPORT"
  | "REMOTE";

export class CodexAppServerError extends Error {
  constructor(
    readonly code: CodexAppServerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CodexAppServerError";
  }
}

export interface CodexSubscriptionAdapterOptions {
  runCommand?: CodexCommandRunner;
  spawnAppServer?: SpawnCodexAppServer;
  createAppServerClient?: () => CodexAppServerClient;
  now?: () => Date;
  commandTimeoutMs?: number;
  requestTimeoutMs?: number;
  restartDelayMs?: (attempt: number) => number;
}

export interface CodexCliProbe {
  state: SubscriptionStatus["connectionState"];
  authMethod?: string;
  version?: string;
  message?: string;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 1_500;
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;
const MAX_COMMAND_OUTPUT_CHARS = 64 * 1024;
const MAX_APP_SERVER_STDOUT_CHARS = 256 * 1024;
const COMMAND_TERMINATION_GRACE_MS = 250;
const COMMAND_FORCE_SETTLE_MS = 250;
const APP_SERVER_INITIALIZE_PARAMS = {
  clientInfo: {
    name: "agent-native-desktop",
    title: "Agent Native Desktop",
    version: "1",
  },
  capabilities: {
    experimentalApi: true,
    requestAttestation: false,
    optOutNotificationMethods: ["thread/started", "thread/status/changed"],
  },
};

const UNAVAILABLE_CAPABILITIES: SubscriptionTelemetryCapabilities = {
  account: false,
  plan: false,
  rateLimits: false,
  modelTierRateLimits: false,
  contextWindow: false,
  credits: false,
  liveUpdates: false,
};

export async function probeCodexSubscription(
  runCommand: CodexCommandRunner = defaultCodexCommandRunner,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<CodexCliProbe> {
  const version = await runCodexCommand(runCommand, ["--version"], timeoutMs);
  if (version.error) {
    return {
      state: "unavailable",
      message:
        version.error.code === "ENOENT"
          ? "Codex CLI was not found."
          : "Codex CLI could not be started.",
    };
  }

  const status = await runCodexCommand(
    runCommand,
    ["login", "status"],
    timeoutMs,
  );
  if (status.error) {
    return {
      state: "error",
      version: commandText(version),
      message: "Codex login status could not be read.",
    };
  }
  if (status.status !== 0) {
    return {
      state: "needs-sign-in",
      version: commandText(version),
      message: "Codex CLI is not logged in.",
    };
  }

  return {
    state: "connected",
    version: commandText(version),
    authMethod: normalizeAuthMethod(
      `${status.stdout ?? ""}\n${status.stderr ?? ""}`,
    ),
  };
}

export function createCodexAppServerClient(
  spawnAppServer: SpawnCodexAppServer = defaultSpawnCodexAppServer,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): CodexAppServerClient {
  const child = spawnAppServer();
  let nextId = 1;
  let stdout = "";
  let closed = false;
  const notificationListeners = new Set<
    (method: string, params: unknown) => void
  >();
  const exitListeners = new Set<() => void>();
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  const rejectPending = (error: CodexAppServerError) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  const notifyExit = () => {
    if (closed) return;
    closed = true;
    rejectPending(
      new CodexAppServerError("TRANSPORT", "Codex app-server exited."),
    );
    for (const listener of exitListeners) listener();
  };
  const abortTransport = (message: string) => {
    if (closed) return;
    closed = true;
    rejectPending(new CodexAppServerError("TRANSPORT", message));
    child.kill();
    for (const listener of exitListeners) listener();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    rejectPending(
      new CodexAppServerError("TRANSPORT", "Codex app-server exited."),
    );
    child.kill();
  };
  const handleLine = (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (typeof message.id !== "number") {
      if (typeof message.method === "string") {
        for (const listener of notificationListeners) {
          listener(message.method, message.params);
        }
      }
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) {
      const error = isRecord(message.error) ? message.error : {};
      request.reject(
        new CodexAppServerError(
          error.code === -32601 ? "METHOD_NOT_FOUND" : "REMOTE",
          error.code === -32601
            ? "Codex app-server does not support this method."
            : "Codex app-server rejected the request.",
        ),
      );
      return;
    }
    request.resolve(message.result);
  };

  child.stdout.on("data", (chunk: Buffer | string) => {
    if (closed) return;
    const next = chunk.toString();
    if (stdout.length + next.length > MAX_APP_SERVER_STDOUT_CHARS) {
      stdout = "";
      abortTransport("Codex app-server output exceeded its safety limit.");
      return;
    }
    stdout += next;
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handleLine(line);
    }
  });
  child.stdout.on("error", () =>
    abortTransport("Codex app-server stdout failed."),
  );
  child.stdin.on("error", () =>
    abortTransport("Codex app-server stdin failed."),
  );
  child.on("error", () => abortTransport("Codex app-server process failed."));
  child.once("exit", notifyExit);

  return {
    request(method, params = {}) {
      if (closed) {
        return Promise.reject(
          new CodexAppServerError("TRANSPORT", "Codex app-server exited."),
        );
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new CodexAppServerError(
              "TIMEOUT",
              "Codex app-server request timed out.",
            ),
          );
        }, requestTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
          );
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(
            new CodexAppServerError(
              "TRANSPORT",
              "Codex app-server could not accept a request.",
            ),
          );
        }
      });
    },
    onNotification(listener) {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    close,
  };
}

/**
 * Owns one initialized app-server process so rate-limit notifications can keep
 * the shared subscription state current between explicit refreshes.
 */
export class CodexSubscriptionAdapter {
  private client: CodexAppServerClient | undefined;
  private initializingClient: Promise<CodexAppServerClient> | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private restartAttempt = 0;
  private stopped = true;
  private plan: SubscriptionPlan | undefined;
  private probe: CodexCliProbe | undefined;
  private rateLimits: unknown;
  private listeners = new Set<(status: SubscriptionStatus) => void>();
  private status: SubscriptionStatus = unavailableStatus(
    "Codex has not been checked.",
  );

  constructor(private readonly options: CodexSubscriptionAdapterOptions = {}) {}

  subscribe(listener: (status: SubscriptionStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  getStatus(): SubscriptionStatus {
    return this.status;
  }

  async start(): Promise<SubscriptionStatus> {
    this.stopped = false;
    return this.refresh();
  }

  async refresh(): Promise<SubscriptionStatus> {
    const probe = await probeCodexSubscription(
      this.options.runCommand,
      this.options.commandTimeoutMs,
    );
    this.probe = probe;
    if (probe.state !== "connected" || probe.authMethod !== "ChatGPT") {
      this.clearSessionCache();
      this.closeClient();
      this.publish(statusFromProbe(probe));
      return this.status;
    }

    try {
      const client = await this.ensureClient();
      const accountResult = await client.request("account/read", {});
      this.plan = normalizePlan(accountResult) ?? this.plan;
      this.restartAttempt = 0;
      try {
        this.rateLimits = await client.request("account/rateLimits/read", {});
        this.publish(liveStatus(probe, this.plan, this.rateLimits, this.now()));
      } catch (error) {
        if (isAppServerError(error, "METHOD_NOT_FOUND")) {
          this.publish(
            unavailableStatus(
              "Codex usage meters are not supported by this CLI version.",
              probe,
              this.plan,
              "unsupported",
            ),
          );
        } else {
          this.handleTelemetryFailure(probe, error);
        }
      }
    } catch (error) {
      if (this.status.telemetry.state === "stale") return this.status;
      this.publish(
        unavailableStatus(
          "Codex subscription telemetry could not be refreshed.",
          probe,
          this.plan,
          "error",
        ),
      );
      this.clearSessionCache();
      this.closeClient();
      this.scheduleRestart();
    }
    return this.status;
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.closeClient();
  }

  private async ensureClient(): Promise<CodexAppServerClient> {
    if (this.client) return this.client;
    if (this.initializingClient) return this.initializingClient;
    const initializing = this.initializeClient();
    this.initializingClient = initializing;
    try {
      return await initializing;
    } finally {
      if (this.initializingClient === initializing) {
        this.initializingClient = undefined;
      }
    }
  }

  private async initializeClient(): Promise<CodexAppServerClient> {
    const client =
      this.options.createAppServerClient?.() ??
      createCodexAppServerClient(
        this.options.spawnAppServer,
        this.options.requestTimeoutMs,
      );
    let initialized = false;
    client.onNotification((method, params) => {
      if (method !== "account/rateLimits/updated") return;
      const update = isRecord(params) ? params.rateLimits : undefined;
      if (!isRecord(update)) return;
      this.rateLimits = mergeRateLimitUpdate(this.rateLimits, update);
      const probe = this.probe;
      if (probe?.state === "connected") {
        this.publish(liveStatus(probe, this.plan, this.rateLimits, this.now()));
      }
    });
    client.onExit(() => {
      if (this.client !== client) return;
      const failed = this.transientFailureStatus(
        this.probe,
        "Codex app-server exited; reconnecting.",
      );
      this.client = undefined;
      if (this.stopped || !initialized) return;
      this.clearSessionCache();
      this.publish(failed);
      this.scheduleRestart();
    });
    try {
      await client.request("initialize", APP_SERVER_INITIALIZE_PARAMS);
      initialized = true;
      if (this.stopped) {
        client.close();
        throw new CodexAppServerError(
          "TRANSPORT",
          "Codex app-server initialization was canceled.",
        );
      }
      this.client = client;
    } catch (error) {
      client.close();
      throw error;
    }
    return client;
  }

  private closeClient(): void {
    const client = this.client;
    this.client = undefined;
    client?.close();
  }

  private clearSessionCache(): void {
    this.plan = undefined;
    this.rateLimits = undefined;
  }

  private handleTelemetryFailure(probe: CodexCliProbe, error: unknown): void {
    if (isAppServerError(error, "TRANSPORT")) {
      if (
        this.status.telemetry.state !== "stale" &&
        this.status.telemetry.state !== "error"
      ) {
        const failed = this.transientFailureStatus(
          probe,
          "Codex app-server exited; reconnecting.",
        );
        this.clearSessionCache();
        this.publish(failed);
      }
    } else {
      this.publish(
        unavailableStatus(
          "Codex usage meters could not be refreshed.",
          probe,
          this.plan,
          "error",
        ),
      );
      this.clearSessionCache();
    }
    this.closeClient();
    this.scheduleRestart();
  }

  private transientFailureStatus(
    probe: CodexCliProbe | undefined,
    message: string,
  ): SubscriptionStatus {
    return this.status.connectionState === "connected"
      ? staleStatus(this.status, this.now())
      : unavailableStatus(message, probe, this.plan, "error");
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    const attempt = this.restartAttempt++;
    const delay =
      this.options.restartDelayMs?.(attempt) ??
      Math.min(30_000, 1_000 * 2 ** attempt);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.refresh();
    }, delay);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private publish(status: SubscriptionStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}

export async function readCodexSubscriptionStatus(
  options: CodexSubscriptionAdapterOptions = {},
): Promise<SubscriptionStatus> {
  const adapter = new CodexSubscriptionAdapter(options);
  try {
    return await adapter.start();
  } finally {
    adapter.stop();
  }
}

function statusFromProbe(probe: CodexCliProbe): SubscriptionStatus {
  return {
    schemaVersion: 1,
    providerId: "codex",
    connectionState: probe.state,
    ...(probe.authMethod ? { authMethod: probe.authMethod } : {}),
    ...(probe.message ? { connectionMessage: probe.message } : {}),
    telemetry: {
      state: "unavailable",
      source: "connection-only",
      capabilities: UNAVAILABLE_CAPABILITIES,
      meters: [],
    },
  };
}

function unavailableStatus(
  message: string,
  probe?: CodexCliProbe,
  plan?: SubscriptionPlan,
  state: SubscriptionTelemetry["state"] = "unavailable",
): SubscriptionStatus {
  return {
    ...statusFromProbe(
      probe ?? { state: "unavailable", message: "Codex CLI was not found." },
    ),
    ...(plan ? { plan } : {}),
    telemetry: {
      state,
      source: "connection-only",
      capabilities: {
        ...UNAVAILABLE_CAPABILITIES,
        plan: Boolean(plan),
      },
      meters: [],
      error: { message },
    },
  };
}

function staleStatus(
  status: SubscriptionStatus,
  staleAt: Date,
): SubscriptionStatus {
  return {
    ...status,
    telemetry: {
      ...status.telemetry,
      state: "stale",
      staleAt: staleAt.toISOString(),
      capabilities: {
        ...status.telemetry.capabilities,
        liveUpdates: false,
      },
      error: { message: "Codex app-server exited; reconnecting." },
    },
  };
}

function liveStatus(
  probe: CodexCliProbe,
  plan: SubscriptionPlan | undefined,
  rateLimits: unknown,
  observedAt: Date,
): SubscriptionStatus {
  const telemetry = {
    ...normalizeRateLimits(rateLimits, observedAt, Boolean(plan)),
    ...(probe.version ? { sourceVersion: probe.version } : {}),
  };
  return {
    schemaVersion: 1,
    providerId: "codex",
    connectionState: "connected",
    ...(probe.authMethod ? { authMethod: probe.authMethod } : {}),
    ...(plan ? { plan } : {}),
    telemetry,
  };
}

function normalizePlan(value: unknown): SubscriptionPlan | undefined {
  const response = isRecord(value) ? value : {};
  const source = isRecord(response.account)
    ? response.account
    : isRecord(response.chatgpt)
      ? response.chatgpt
      : response;
  if (source.type && source.type !== "chatgpt") return undefined;
  const planType = stringValue(source.planType);
  return planType ? { type: planType, label: planType } : undefined;
}

function normalizeRateLimits(
  value: unknown,
  observedAt: Date,
  hasPlan: boolean,
): SubscriptionTelemetry {
  const response = isRecord(value) ? value : {};
  const rateLimits = isRecord(response.rateLimits)
    ? response.rateLimits
    : response;
  const byLimitId = isRecord(response.rateLimitsByLimitId)
    ? response.rateLimitsByLimitId
    : undefined;
  const baseLimitId = stringValue(rateLimits.limitId) ?? "codex";
  const meters = normalizeMeters(rateLimits, baseLimitId, false);
  if (byLimitId) {
    for (const [limitId, snapshot] of Object.entries(byLimitId)) {
      if (!isRecord(snapshot) || limitId === baseLimitId) continue;
      meters.push(...normalizeMeters(snapshot, limitId, true));
    }
  }
  const credits = normalizeCredits(rateLimits.credits);
  return {
    state: "live",
    source: "codex-app-server",
    updatedAt: observedAt.toISOString(),
    capabilities: {
      account: false,
      plan: hasPlan,
      rateLimits: meters.length > 0,
      modelTierRateLimits: meters.some(
        (meter) => meter.kind === "model-tier-weekly",
      ),
      contextWindow: false,
      credits: Boolean(credits),
      liveUpdates: true,
    },
    meters,
    ...(credits ? { credits } : {}),
  };
}

function normalizeMeters(
  snapshot: Record<string, unknown>,
  limitId: string,
  modelTier: boolean,
): SubscriptionRateLimitMeter[] {
  const tier = stringValue(snapshot.limitName) ?? limitId;
  const meters: SubscriptionRateLimitMeter[] = [];
  for (const slot of ["primary", "secondary"] as const) {
    const window = normalizeWindow(
      snapshot[slot],
      { id: `${limitId}:${slot}` },
      modelTier ? tier : undefined,
      slot,
    );
    if (window) meters.push(window);
  }
  return meters;
}

function normalizeWindow(
  value: unknown,
  base: Pick<SubscriptionRateLimitMeter, "id">,
  modelTier: string | undefined,
  slot: "primary" | "secondary",
): SubscriptionRateLimitMeter | undefined {
  if (!isRecord(value)) return undefined;
  const usedPercent = percentage(value.usedPercent);
  const duration = positiveNumber(value.windowDurationMins);
  const weekly =
    duration === 10_080 || (duration === undefined && slot === "secondary");
  if (modelTier && !weekly) return undefined;
  const kind = modelTier
    ? "model-tier-weekly"
    : weekly
      ? "weekly"
      : "five-hour";
  return {
    ...base,
    kind,
    ...(duration === undefined
      ? {}
      : {
          label: modelTier
            ? `${modelTier} weekly`
            : weekly
              ? "Weekly"
              : "5-hour",
        }),
    ...(modelTier ? { modelTier } : {}),
    state: usedPercent === undefined ? "unavailable" : "available",
    ...(usedPercent === undefined ? {} : { usedPercent }),
    ...(duration === undefined ? {} : { windowDurationMinutes: duration }),
    ...(resetAt(value.resetsAt) ? { resetsAt: resetAt(value.resetsAt) } : {}),
  };
}

function normalizeCredits(value: unknown): SubscriptionTelemetry["credits"] {
  if (!isRecord(value)) return undefined;
  const hasCredits = booleanValue(value.hasCredits);
  const unlimited = booleanValue(value.unlimited);
  const balance = value.balance;
  if (
    hasCredits === undefined &&
    unlimited === undefined &&
    typeof balance !== "string" &&
    typeof balance !== "number"
  ) {
    return undefined;
  }
  return {
    state: "available",
    ...(hasCredits === undefined ? {} : { hasCredits }),
    ...(unlimited === undefined ? {} : { unlimited }),
    ...(typeof balance === "string" || typeof balance === "number"
      ? { balance }
      : {}),
  };
}

function mergeRateLimitUpdate(
  current: unknown,
  update: Record<string, unknown>,
): unknown {
  const currentResponse = isRecord(current) ? current : {};
  const limitId = stringValue(update.limitId);
  if (!limitId) {
    return {
      ...currentResponse,
      rateLimits: mergeRecords(currentResponse.rateLimits, update),
    };
  }
  const existingById = isRecord(currentResponse.rateLimitsByLimitId)
    ? currentResponse.rateLimitsByLimitId
    : {};
  const next = {
    ...currentResponse,
    rateLimitsByLimitId: {
      ...existingById,
      [limitId]: mergeRecords(existingById[limitId], update),
    },
  };
  const currentBase = isRecord(currentResponse.rateLimits)
    ? currentResponse.rateLimits
    : undefined;
  return currentBase && stringValue(currentBase.limitId) === limitId
    ? { ...next, rateLimits: mergeRecords(currentBase, update) }
    : next;
}

function mergeRecords(
  current: unknown,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const base = isRecord(current) ? current : {};
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(update).map(([key, value]) => [
        key,
        isRecord(value) ? mergeRecords(base[key], value) : (value ?? base[key]),
      ]),
    ),
  };
}

export function defaultCodexCommandRunner(
  args: string[],
  timeoutMs: number,
  spawnCommand: SpawnCodexCommand = (commandArgs) =>
    spawn("codex", commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }),
): Promise<CodexCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child: ChildProcess | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let terminationTimer: NodeJS.Timeout | undefined;
    let forceSettleTimer: NodeJS.Timeout | undefined;
    let failure: CodexCommandResult | undefined;
    const finish = (result: CodexCommandResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (terminationTimer) clearTimeout(terminationTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      resolve({ ...result, stdout, stderr });
    };
    const stop = (result: CodexCommandResult) => {
      if (settled || failure) return;
      failure = result;
      terminationTimer = setTimeout(() => {
        if (settled) return;
        forceSettleTimer = setTimeout(
          () => finish(failure ?? result),
          COMMAND_FORCE_SETTLE_MS,
        );
        child?.kill("SIGKILL");
      }, COMMAND_TERMINATION_GRACE_MS);
      child?.kill("SIGTERM");
    };
    try {
      child = spawnCommand(args);
      timeout = setTimeout(
        () => stop({ status: null, error: { code: "ETIMEDOUT" } }),
        timeoutMs,
      );
      child.stdout?.on("data", (chunk) => {
        stdout = appendBoundedOutput(stdout, chunk.toString());
      });
      child.stderr?.on("data", (chunk) => {
        stderr = appendBoundedOutput(stderr, chunk.toString());
      });
      child.stdout?.on("error", (error: NodeJS.ErrnoException) => {
        stop({ status: null, error: { code: error.code ?? "EIO" } });
      });
      child.stderr?.on("error", (error: NodeJS.ErrnoException) => {
        stop({ status: null, error: { code: error.code ?? "EIO" } });
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        stop({ status: null, error: { code: error.code } });
      });
      child.once("close", (status) => finish(failure ?? { status }));
    } catch (error) {
      finish({
        status: null,
        error: { code: (error as NodeJS.ErrnoException).code },
      });
    }
  });
}

async function runCodexCommand(
  runCommand: CodexCommandRunner,
  args: string[],
  timeoutMs: number,
): Promise<CodexCommandResult> {
  try {
    return await runCommand(args, timeoutMs);
  } catch (error) {
    return {
      status: null,
      error: { code: (error as NodeJS.ErrnoException).code },
    };
  }
}

function appendBoundedOutput(current: string, next: string): string {
  if (current.length >= MAX_COMMAND_OUTPUT_CHARS) return current;
  return `${current}${next}`.slice(0, MAX_COMMAND_OUTPUT_CHARS);
}

function defaultSpawnCodexAppServer(): CodexJsonRpcChildProcess {
  return spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  }) as CodexJsonRpcChildProcess;
}

function commandText(result: CodexCommandResult): string | undefined {
  const value = result.stdout?.trim();
  return value || undefined;
}

function normalizeAuthMethod(value: string): string | undefined {
  if (/chatgpt/i.test(value)) return "ChatGPT";
  if (/api key/i.test(value)) return "API key";
  return undefined;
}

function percentage(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function resetAt(value: unknown): string | undefined {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp)
      ? undefined
      : new Date(timestamp).toISOString();
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Date(value * 1_000).toISOString();
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAppServerError(
  value: unknown,
  code: CodexAppServerErrorCode,
): value is CodexAppServerError {
  return value instanceof CodexAppServerError && value.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
