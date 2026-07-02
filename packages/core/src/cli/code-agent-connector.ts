import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  executeDenyCodeAgentApproval,
  executePendingCodeAgentApproval,
} from "./code-agent-executor.js";
import {
  appendCodeAgentTranscriptEvent,
  codeAgentRunTranscriptPath,
  codeAgentStoreRoot,
  createCodeAgentRunRecord,
  getCodeAgentRunRecord,
  listCodeAgentRunRecords,
  normalizeCodeAgentPermissionMode,
  queueCodeAgentFollowUp,
  updateCodeAgentRunRecord,
  type CodeAgentPermissionMode,
  type CodeAgentRunRecord,
  type CodeAgentTranscriptEvent,
} from "./code-agent-runs.js";

export interface RemoteCodeAgentDeviceConfig {
  token: string;
  relayUrl?: string;
  deviceId?: string;
  deviceName?: string;
  pollIntervalMs?: number;
}

export interface RunCodeAgentConnectorOptions {
  relayUrl?: string;
  output?: NodeJS.WritableStream;
  signal?: AbortSignal;
  once?: boolean;
}

interface RemoteCommand {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  raw: Record<string, unknown>;
}

interface TranscriptCursor {
  offset: number;
  seq: number;
}

interface RunnerProcess {
  child: ChildProcess;
  runId: string;
  cwd: string;
  command: string;
  startedAt: string;
}

const DEVICE_PATH_ENV = "AGENT_NATIVE_REMOTE_DEVICE_PATH";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 30_000;
const MAX_TRANSCRIPT_EVENTS_PER_BATCH = 50;

const activeRunners = new Map<string, RunnerProcess>();

export function remoteDeviceConfigPath(): string {
  return path.resolve(
    process.env[DEVICE_PATH_ENV] ??
      path.join(os.homedir(), ".agent-native", "remote-device.json"),
  );
}

export function loadRemoteCodeAgentDeviceConfig(
  configPath = remoteDeviceConfigPath(),
): RemoteCodeAgentDeviceConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
    if (!isObject(raw)) return null;
    const token = firstStringValue(
      raw.token,
      raw.deviceToken,
      raw.relayToken,
      raw.accessToken,
      raw.bearerToken,
    );
    if (!token) return null;
    const pollIntervalMs = Number(raw.pollIntervalMs);
    return {
      token,
      relayUrl: firstStringValue(raw.relayUrl, raw.url, raw.baseUrl),
      deviceId: firstStringValue(raw.deviceId, raw.id),
      deviceName: firstStringValue(raw.deviceName, raw.name),
      pollIntervalMs:
        Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
          ? Math.min(Math.max(pollIntervalMs, 500), MAX_POLL_INTERVAL_MS)
          : undefined,
    };
  } catch {
    return null;
  }
}

export async function runCodeAgentConnector(
  options: RunCodeAgentConnectorOptions = {},
): Promise<number> {
  const output = options.output ?? process.stdout;
  const configPath = remoteDeviceConfigPath();
  const config = loadRemoteCodeAgentDeviceConfig(configPath);
  if (!config) {
    output.write(
      [
        "Agent-Native Code remote connector is not paired.",
        "",
        `Expected device config: ${configPath}`,
        "Pair this device from Agent Native, or set AGENT_NATIVE_REMOTE_DEVICE_PATH to a JSON file containing a device token.",
        "Then run: agent-native code serve --relay-url <relay-url>",
        "",
      ].join("\n"),
    );
    return 1;
  }

  const relayUrl = normalizeRelayUrl(options.relayUrl ?? config.relayUrl);
  if (!relayUrl) {
    output.write(
      [
        "Agent-Native Code remote connector needs a relay URL.",
        "",
        "Run: agent-native code serve --relay-url https://your-agent-native-app.example",
        `Or add "relayUrl" to ${configPath}.`,
        "",
      ].join("\n"),
    );
    return 1;
  }

  const connector = new RemoteCodeAgentConnector(config, relayUrl, output);
  await connector.run({ signal: options.signal, once: options.once });
  return 0;
}

class RemoteCodeAgentConnector {
  private readonly transcriptCursors = new Map<string, TranscriptCursor>();
  private readonly remoteRunIds = new Set<string>();
  private stopped = false;

  constructor(
    private readonly config: RemoteCodeAgentDeviceConfig,
    private readonly relayUrl: string,
    private readonly output: NodeJS.WritableStream,
  ) {
    for (const run of listCodeAgentRunRecords()) {
      if (isRemoteStartedRun(run, relayUrl)) {
        this.remoteRunIds.add(run.id);
        this.transcriptCursors.set(run.id, { offset: 0, seq: 0 });
      }
    }
  }

  async run(options: { signal?: AbortSignal; once?: boolean } = {}) {
    const onAbort = () => {
      this.stopped = true;
    };
    if (options.signal) {
      if (options.signal.aborted) this.stopped = true;
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    this.output.write(
      `Agent-Native Code remote connector serving ${this.relayUrl}\n`,
    );

    let backoffMs = this.pollIntervalMs();
    try {
      while (!this.stopped) {
        try {
          await this.pollOnce();
          await this.flushRemoteRunEvents();
          backoffMs = this.pollIntervalMs();
          if (options.once) break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.output.write(`Remote connector poll failed: ${message}\n`);
          backoffMs = Math.min(backoffMs * 2, MAX_POLL_INTERVAL_MS);
        }
        await sleep(backoffMs, options.signal);
      }
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async pollOnce() {
    const response = await this.postJson(
      "/_agent-native/integrations/remote/poll",
      {
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName ?? os.hostname(),
        capabilities: [
          "create-run",
          "append-followup",
          "approve",
          "deny",
          "stop",
          "status",
          "run-events",
        ],
        activeRunIds: Array.from(this.remoteRunIds),
      },
    );
    const commands = normalizeCommands(response);
    for (const command of commands) {
      const result = await this.dispatchCommand(command).catch((err) => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      await this.postCommandResult(command, result);
    }
  }

  private async dispatchCommand(command: RemoteCommand) {
    switch (normalizeKind(command.kind)) {
      case "create-run":
        return this.createRun(command);
      case "append-followup":
      case "append-follow-up":
      case "followup":
      case "follow-up":
        return this.appendFollowUp(command);
      case "approve":
        return this.approve(command);
      case "deny":
        return this.deny(command);
      case "stop":
        return this.stop(command);
      case "status":
        return this.status(command);
      default:
        return {
          ok: false,
          error: `Unsupported remote command kind: ${command.kind}`,
        };
    }
  }

  private createRun(command: RemoteCommand) {
    const prompt = firstTextValue(
      command.params.prompt,
      command.params.message,
      command.params.input,
    );
    if (!prompt) {
      return { ok: false, error: "Missing prompt." };
    }
    const goalId = firstStringValue(command.params.goalId) ?? "task";
    const cwd = resolveCommandCwd(command.params.cwd);
    const permissionMode =
      normalizeCodeAgentPermissionMode(command.params.permissionMode) ??
      "full-auto";
    const engine = firstStringValue(command.params.engine);
    const model = firstStringValue(command.params.model);
    const effort = firstStringValue(
      command.params.effort,
      command.params.reasoningEffort,
    );
    const metadata = isObject(command.params.metadata)
      ? command.params.metadata
      : {};
    const run = createCodeAgentRunRecord({
      goalId,
      title: firstStringValue(command.params.title) ?? titleFromPrompt(prompt),
      subtitle: "Remote coding task",
      status: "queued",
      phase: "queued",
      permissionMode,
      cwd,
      progress: {
        label: "Queued",
        completed: 0,
        total: 1,
        percent: 0,
      },
      details: [
        { label: "Prompt", value: truncateForDisplay(prompt, 160) },
        { label: "Agent", value: "Remote connector" },
        { label: "Mode", value: permissionMode },
      ],
      metadata: {
        ...metadata,
        prompt,
        source: "remote-connector",
        engine,
        model,
        effort,
        remote: {
          commandId: command.id,
          deviceId: this.config.deviceId,
          relayUrl: this.relayUrl,
        },
      },
    });

    appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "user",
      message: prompt,
      metadata: { source: "remote-initial-prompt", commandId: command.id },
    });
    appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "status",
      message: "Remote Agent-Native Code run queued.",
      metadata: { status: "queued", phase: "queued", commandId: command.id },
    });
    this.remoteRunIds.add(run.id);
    this.transcriptCursors.set(run.id, { offset: 0, seq: 0 });
    this.spawnRunner(run.id, cwd, permissionMode);
    return { ok: true, runId: run.id, run };
  }

  private appendFollowUp(command: RemoteCommand) {
    const runId = firstStringValue(command.params.runId);
    const prompt = firstTextValue(
      command.params.prompt,
      command.params.message,
    );
    if (!runId) return { ok: false, error: "Missing runId." };
    if (!prompt) return { ok: false, error: "Missing prompt." };
    const run = getCodeAgentRunRecord(runId);
    if (!run) return { ok: false, error: `Run not found: ${runId}` };

    const permissionMode =
      normalizeCodeAgentPermissionMode(command.params.permissionMode) ??
      undefined;
    const activeRun = permissionMode
      ? (updateCodeAgentRunRecord(runId, { permissionMode }) ?? run)
      : run;
    const followUpMode =
      firstStringValue(command.params.followUpMode) === "queued"
        ? "queued"
        : "immediate";
    const runnerActive = activeRunners.has(activeRun.id);
    const shouldQueue = activeRun.status === "needs-approval" || runnerActive;
    const event = appendCodeAgentTranscriptEvent({
      runId: activeRun.id,
      kind: "user",
      message: prompt,
      metadata: {
        source: "remote-follow-up",
        commandId: command.id,
        followUpMode,
        delivery: shouldQueue ? followUpMode : "run-now",
      },
    });

    if (shouldQueue) {
      queueCodeAgentFollowUp({
        runId: activeRun.id,
        prompt,
        mode: followUpMode,
        eventId: event.id,
        permissionMode,
        source: "remote-follow-up",
        createdAt: event.createdAt,
      });
    } else {
      this.spawnRunner(activeRun.id, activeRun.cwd, permissionMode);
    }
    this.remoteRunIds.add(activeRun.id);
    return { ok: true, runId: activeRun.id, event, queued: shouldQueue };
  }

  private async approve(command: RemoteCommand) {
    const runId = firstStringValue(command.params.runId);
    if (!runId) return { ok: false, error: "Missing runId." };
    const run = getCodeAgentRunRecord(runId);
    if (!run) return { ok: false, error: `Run not found: ${runId}` };
    // executePendingCodeAgentApproval now auto-resumes inline after running the
    // approved command, so no separate spawnRunner call is needed.
    const result = await executePendingCodeAgentApproval(runId);
    return { ok: true, runId, run: result ?? getCodeAgentRunRecord(runId) };
  }

  private async deny(command: RemoteCommand) {
    const runId = firstStringValue(command.params.runId);
    if (!runId) return { ok: false, error: "Missing runId." };
    const run = getCodeAgentRunRecord(runId);
    if (!run) return { ok: false, error: `Run not found: ${runId}` };
    appendCodeAgentTranscriptEvent({
      runId,
      kind: "status",
      message: "Remote approval denied.",
      metadata: { source: "remote-connector", commandId: command.id },
    });
    // Auto-resume so the model can adapt its plan after the denial.
    const result = await executeDenyCodeAgentApproval(runId);
    return { ok: true, runId, run: result ?? getCodeAgentRunRecord(runId) };
  }

  private stop(command: RemoteCommand) {
    const runId = firstStringValue(command.params.runId);
    if (!runId) return { ok: false, error: "Missing runId." };
    const run = getCodeAgentRunRecord(runId);
    if (!run) return { ok: false, error: `Run not found: ${runId}` };
    const active = activeRunners.get(runId);
    const pid = active?.child.pid ?? Number(run.metadata?.runnerPid);
    let killed = false;
    let killError: string | undefined;
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
        killed = true;
      } catch (err) {
        killError = err instanceof Error ? err.message : String(err);
      }
    }
    activeRunners.delete(runId);
    appendCodeAgentTranscriptEvent({
      runId,
      kind: "status",
      message: killed
        ? "Remote stop requested for Agent-Native Code runner."
        : "Remote stop requested; no active runner process was found.",
      metadata: {
        source: "remote-connector",
        commandId: command.id,
        pid: Number.isFinite(pid) ? pid : undefined,
        killed,
        killError,
      },
    });
    const updated = updateCodeAgentRunRecord(runId, {
      status: "paused",
      phase: "stopped",
      progress: {
        label: "Stopped",
        completed: 0,
        total: 1,
        percent: 0,
      },
      metadata: {
        runnerState: "stopped",
        stoppedAt: new Date().toISOString(),
        stoppedBy: "remote-connector",
        stopSignalSent: killed,
        stopError: killError,
      },
    });
    return { ok: !killError, runId, run: updated, killed, error: killError };
  }

  private status(command: RemoteCommand) {
    const runId = firstStringValue(command.params.runId);
    if (runId) {
      const run = getCodeAgentRunRecord(runId);
      return run
        ? { ok: true, runId, run, runner: runnerStatus(runId) }
        : { ok: false, runId, error: `Run not found: ${runId}` };
    }
    return {
      ok: true,
      runs: listCodeAgentRunRecords().slice(0, 20),
      activeRunIds: Array.from(activeRunners.keys()),
    };
  }

  private spawnRunner(
    runId: string,
    cwd: string,
    permissionMode?: CodeAgentPermissionMode,
  ) {
    if (activeRunners.has(runId)) return;
    const invocation = resolveCodeAgentCliInvocation();
    const child = spawn(
      invocation.command,
      [...invocation.args, "code", "run", runId],
      {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          AGENT_NATIVE_CODE_AGENTS_HOME: codeAgentStoreRoot(),
          ...(permissionMode
            ? { AGENT_NATIVE_CODE_AGENT_PERMISSION_MODE: permissionMode }
            : {}),
        },
      },
    );
    const runnerCommand = `${invocation.command} ${[
      ...invocation.args,
      "code",
      "run",
      runId,
    ].join(" ")}`;
    const startedAt = new Date().toISOString();
    activeRunners.set(runId, {
      child,
      runId,
      cwd,
      command: runnerCommand,
      startedAt,
    });
    updateCodeAgentRunRecord(runId, {
      status: "running",
      phase: "executing",
      metadata: {
        runnerState: "running",
        runnerPid: child.pid,
        runnerCommand,
        runnerCwd: cwd,
        runnerStartedAt: startedAt,
      },
    });
    child.stdout?.on("data", (chunk) => appendRunnerOutput(runId, chunk));
    child.stderr?.on("data", (chunk) =>
      appendRunnerOutput(runId, chunk, "runner-stderr"),
    );
    child.on("exit", (code, signal) => {
      activeRunners.delete(runId);
      updateCodeAgentRunRecord(runId, {
        metadata: {
          runnerState: "exited",
          runnerExitedAt: new Date().toISOString(),
          runnerExitCode: code,
          runnerExitSignal: signal,
        },
      });
    });
    child.unref();
  }

  private async flushRemoteRunEvents() {
    for (const runId of this.remoteRunIds) {
      const cursor = this.transcriptCursors.get(runId) ?? { offset: 0, seq: 0 };
      const batch = readTranscriptBatch(runId, cursor.offset);
      if (batch.events.length === 0) {
        this.transcriptCursors.set(runId, {
          offset: batch.nextOffset,
          seq: cursor.seq,
        });
        continue;
      }
      await this.postJson("/_agent-native/integrations/remote/run-events", {
        deviceId: this.config.deviceId,
        remoteRunId: runId,
        cursor: { offset: batch.nextOffset },
        events: batch.events.map((event, index) => ({
          seq: cursor.seq + index,
          event,
        })),
      });
      this.transcriptCursors.set(runId, {
        offset: batch.nextOffset,
        seq: cursor.seq + batch.events.length,
      });
    }
  }

  private async postCommandResult(
    command: RemoteCommand,
    result: Record<string, unknown>,
  ) {
    await this.postJson("/_agent-native/integrations/remote/result", {
      deviceId: this.config.deviceId,
      commandId: command.id,
      kind: command.kind,
      ok: result.ok !== false,
      status: result.ok === false ? "failed" : "completed",
      result,
      errorMessage: typeof result.error === "string" ? result.error : undefined,
    });
  }

  private async postJson(pathname: string, body: unknown): Promise<unknown> {
    const url = new URL(pathname, this.relayUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${url.pathname} returned ${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private pollIntervalMs() {
    return this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }
}

function normalizeCommands(value: unknown): RemoteCommand[] {
  const rawCommands = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.commands)
      ? value.commands
      : isObject(value) && isObject(value.command)
        ? [value.command]
        : isObject(value) && firstStringValue(value.kind, value.type)
          ? [value]
          : [];
  return rawCommands
    .map((raw): RemoteCommand | null => {
      if (!isObject(raw)) return null;
      const kind = firstStringValue(
        raw.kind,
        raw.type,
        raw.command,
        raw.action,
      );
      if (!kind) return null;
      const params = isObject(raw.params)
        ? raw.params
        : isObject(raw.payload)
          ? raw.payload
          : isObject(raw.args)
            ? raw.args
            : raw;
      return {
        id:
          firstStringValue(raw.id, raw.commandId, raw.requestId) ??
          `${normalizeKind(kind)}-${Date.now()}`,
        kind,
        params,
        raw,
      };
    })
    .filter((command): command is RemoteCommand => Boolean(command));
}

function normalizeKind(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function readTranscriptBatch(runId: string, offset: number) {
  const transcriptPath = codeAgentRunTranscriptPath(runId);
  if (!fs.existsSync(transcriptPath)) {
    return { events: [] as CodeAgentTranscriptEvent[], nextOffset: 0 };
  }
  const stat = fs.statSync(transcriptPath);
  const safeOffset = Math.max(0, Math.min(offset, stat.size));
  const fd = fs.openSync(transcriptPath, "r");
  try {
    const length = Math.min(stat.size - safeOffset, 256_000);
    if (length <= 0) {
      return {
        events: [] as CodeAgentTranscriptEvent[],
        nextOffset: safeOffset,
      };
    }
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, safeOffset);
    const text = buffer.toString("utf-8");
    const lines = text.split(/\r?\n/);
    const hasTrailingNewline = /\r?\n$/.test(text);
    const completeLines = hasTrailingNewline ? lines : lines.slice(0, -1);
    const selected = completeLines
      .filter(Boolean)
      .slice(0, MAX_TRANSCRIPT_EVENTS_PER_BATCH);
    const consumedBytes = Buffer.byteLength(
      selected.map((line) => `${line}\n`).join(""),
      "utf-8",
    );
    return {
      events: selected
        .map((line) => parseTranscriptEvent(line))
        .filter((event): event is CodeAgentTranscriptEvent => Boolean(event)),
      nextOffset: safeOffset + consumedBytes,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function parseTranscriptEvent(line: string): CodeAgentTranscriptEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isObject(parsed)) return null;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.id !== "string" ||
      typeof parsed.runId !== "string" ||
      typeof parsed.kind !== "string" ||
      typeof parsed.message !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    if (
      parsed.kind !== "user" &&
      parsed.kind !== "system" &&
      parsed.kind !== "note" &&
      parsed.kind !== "artifact" &&
      parsed.kind !== "status"
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      id: parsed.id,
      runId: parsed.runId,
      kind: parsed.kind,
      message: parsed.message,
      createdAt: parsed.createdAt,
      metadata: isObject(parsed.metadata) ? parsed.metadata : undefined,
    };
  } catch {
    return null;
  }
}

function resolveCodeAgentCliInvocation(): { command: string; args: string[] } {
  const currentEntry = process.argv[1];
  if (
    currentEntry &&
    fs.existsSync(currentEntry) &&
    currentEntry.endsWith(".js")
  ) {
    return { command: process.execPath, args: [path.resolve(currentEntry)] };
  }
  const localDist = path.resolve("packages/core/dist/cli/index.js");
  if (fs.existsSync(localDist)) {
    return { command: process.execPath, args: [localDist] };
  }
  return {
    command: "pnpm",
    args: [
      "--filter",
      "@agent-native/core",
      "exec",
      "node",
      "dist/cli/index.js",
    ],
  };
}

function appendRunnerOutput(
  runId: string,
  chunk: Buffer,
  source = "runner-stdout",
) {
  const text = chunk.toString().trim();
  if (!text) return;
  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message: text,
    metadata: { source },
  });
}

function runnerStatus(runId: string) {
  const runner = activeRunners.get(runId);
  return runner
    ? {
        active: true,
        pid: runner.child.pid,
        command: runner.command,
        cwd: runner.cwd,
        startedAt: runner.startedAt,
      }
    : { active: false };
}

function isRemoteStartedRun(
  run: CodeAgentRunRecord,
  relayUrl: string,
): boolean {
  const metadata = run.metadata ?? {};
  const remote = isObject(metadata.remote) ? metadata.remote : {};
  return (
    metadata.source === "remote-connector" ||
    firstStringValue(remote.relayUrl) === relayUrl
  );
}

function resolveCommandCwd(value: unknown): string {
  const cwd = firstStringValue(value);
  return cwd ? path.resolve(cwd) : process.cwd();
}

function normalizeRelayUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return null;
  }
}

function firstStringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function firstTextValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (!Array.isArray(value)) continue;
    const parts = value
      .map((item) =>
        typeof item === "string"
          ? item
          : isObject(item)
            ? (firstStringValue(item.text, item.content, item.message) ?? "")
            : "",
      )
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  return undefined;
}

function titleFromPrompt(prompt: string): string {
  return truncateForDisplay(prompt.replace(/\s+/g, " ").trim(), 80);
}

function truncateForDisplay(value: string, max: number): string {
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
