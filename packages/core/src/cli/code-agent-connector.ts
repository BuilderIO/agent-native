import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertValidComputerCommandEnvelope } from "../integrations/computer-supervision.js";
import { serializeBoundedRemoteJson } from "../integrations/remote-json-safety.js";
import type {
  ComputerCommandEnvelope,
  RemoteComputerCapabilities,
  RemoteExecutionCapabilities,
} from "../integrations/remote-types.js";
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
import {
  appendPortalTransferTranscript,
  parsePortalTransferContext,
  type PortalTransferContext,
} from "./portal-transfer.js";
import {
  loadPortalEnvironment,
  preparePortalWorkspace,
  parsePortalHandoff,
  type PortalEnvironment,
  type PortalWorkspace,
} from "./portal-workspace.js";

export interface RemoteCodeAgentDeviceConfig {
  token: string;
  relayUrl?: string;
  deviceId?: string;
  deviceName?: string;
  /** Default host-local workspace used when a command omits cwd. */
  workspacePath?: string;
  pollIntervalMs?: number;
}

export interface RunCodeAgentConnectorOptions {
  relayUrl?: string;
  output?: NodeJS.WritableStream;
  signal?: AbortSignal;
  once?: boolean;
}

export interface LocalComputerBridgeConfig {
  url: string;
  token: string;
  capabilities: RemoteComputerCapabilities;
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
const COMPUTER_BRIDGE_URL_ENV = "AGENT_NATIVE_COMPUTER_BRIDGE_URL";
const COMPUTER_BRIDGE_TOKEN_ENV = "AGENT_NATIVE_COMPUTER_BRIDGE_TOKEN";
const COMPUTER_CAPABILITIES_ENV = "AGENT_NATIVE_COMPUTER_CAPABILITIES";
const REMOTE_ENGINES_ENV = "AGENT_NATIVE_REMOTE_ENGINES";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 30_000;
const MAX_TRANSCRIPT_EVENTS_PER_BATCH = 50;

const activeRunners = new Map<string, RunnerProcess>();

export const DEFAULT_REMOTE_EXECUTION_CAPABILITIES: RemoteExecutionCapabilities =
  {
    backend: "desktop",
    workloads: ["code-agent", "scheduled-code"],
    engines: ["codex-cli", "claude-cli", "pi-cli", "opencode-cli"],
    acceptsScheduledWork: true,
    acceptsPortalHandoffs: true,
    persistence: "local-files",
    adapters: ["agent-native-code"],
  };

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
      workspacePath: firstStringValue(
        raw.workspacePath,
        raw.workspace,
        raw.cwd,
        raw.projectPath,
      ),
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
  private readonly terminalCommandIds = new Set<string>();
  private stopped = false;
  private readonly computerBridge = loadLocalComputerBridgeConfig();

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
      if (this.computerBridge) {
        await callLocalComputerBridgeTool(
          this.computerBridge,
          "computer_revoke_control",
          { reason: "connector-stopped" },
        ).catch(() => undefined);
      }
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
        computerCapabilities: this.computerBridge?.capabilities ?? {},
        executionCapabilities: remoteExecutionCapabilities(),
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
      case "computer-operation":
        return this.computerOperation(command);
      case "status":
        return this.status(command);
      default:
        return {
          ok: false,
          error: `Unsupported remote command kind: ${command.kind}`,
        };
    }
  }

  private async computerOperation(command: RemoteCommand) {
    return dispatchComputerOperationToLocalBridge(
      this.computerBridge,
      command.params.envelope,
    );
  }

  private async createRun(command: RemoteCommand) {
    const prompt = firstTextValue(
      command.params.prompt,
      command.params.message,
      command.params.input,
    );
    if (!prompt) {
      return { ok: false, error: "Missing prompt." };
    }
    const goalId = firstStringValue(command.params.goalId) ?? "task";
    const metadata = isObject(command.params.metadata)
      ? command.params.metadata
      : {};
    let portalTransfer: PortalTransferContext | null = null;
    try {
      portalTransfer = parsePortalTransferContext(metadata.portalTransfer);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    let cwd = resolveCommandCwd(
      command.params.cwd ?? this.config.workspacePath,
    );
    let portalWorkspace: PortalWorkspace | undefined;
    let portalEnvironment: PortalEnvironment | undefined;
    if (metadata.portal !== undefined) {
      try {
        portalWorkspace = await preparePortalWorkspace({
          handoff: parsePortalHandoff(metadata.portal),
          workspacePath: this.config.workspacePath,
        });
        portalEnvironment = loadPortalEnvironment(
          portalWorkspace.environmentRoot,
        );
        cwd = portalWorkspace.workspacePath;
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const requestedRunId = firstStringValue(command.params.runId);
    if (portalWorkspace && requestedRunId && !isSafeRunId(requestedRunId)) {
      return { ok: false, error: "Portal run id is invalid." };
    }
    if (portalTransfer && (!portalWorkspace || !requestedRunId)) {
      return {
        ok: false,
        error:
          "Portal transfer context requires a Portal run id and workspace.",
      };
    }
    if (portalWorkspace && requestedRunId) {
      const existing = getCodeAgentRunRecord(requestedRunId);
      const existingRemote = isObject(existing?.metadata?.remote)
        ? existing.metadata.remote
        : {};
      if (
        existing &&
        firstStringValue(existingRemote.commandId) === command.id
      ) {
        this.remoteRunIds.add(existing.id);
        this.transcriptCursors.set(existing.id, { offset: 0, seq: 0 });
        if (!activeRunners.has(existing.id)) {
          this.spawnRunner(
            existing.id,
            existing.cwd,
            existing.permissionMode,
            portalEnvironment?.values,
          );
        }
        return { ok: true, runId: existing.id, run: existing, resumed: true };
      }
      const existingTransfer = isObject(existing?.metadata?.portalTransfer)
        ? existing.metadata.portalTransfer
        : undefined;
      if (
        portalTransfer &&
        existing &&
        firstStringValue(existingTransfer?.sourceRunId) ===
          portalTransfer.sourceRunId
      ) {
        this.remoteRunIds.add(existing.id);
        this.transcriptCursors.set(existing.id, { offset: 0, seq: 0 });
        if (!activeRunners.has(existing.id)) {
          this.spawnRunner(
            existing.id,
            existing.cwd,
            existing.permissionMode,
            portalEnvironment?.values,
          );
        }
        return { ok: true, runId: existing.id, run: existing, resumed: true };
      }
    }
    const permissionMode =
      normalizeCodeAgentPermissionMode(command.params.permissionMode) ??
      "full-auto";
    const engine = firstStringValue(command.params.engine);
    const model = firstStringValue(command.params.model);
    const effort = firstStringValue(
      command.params.effort,
      command.params.reasoningEffort,
    );
    const metadataWithoutTransfer = { ...metadata };
    delete metadataWithoutTransfer.portalTransfer;
    const run = createCodeAgentRunRecord({
      ...(portalWorkspace && requestedRunId ? { id: requestedRunId } : {}),
      goalId,
      title: firstStringValue(command.params.title) ?? titleFromPrompt(prompt),
      subtitle: portalWorkspace
        ? `Portal on ${this.config.deviceName ?? "paired computer"}`
        : "Remote coding task",
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
        ...(portalTransfer
          ? [
              {
                label: "Context",
                value: `Imported ${portalTransfer.events.length} transcript events`,
              },
            ]
          : []),
        ...(portalWorkspace
          ? [
              {
                label: "Workspace",
                value: `Portal · ${portalWorkspace.workspacePath}`,
              },
              {
                label: "Environment",
                value: portalEnvironment?.files.length
                  ? `Loaded ${portalEnvironment.files.join(", ")}`
                  : "Using paired computer environment",
              },
            ]
          : []),
      ],
      metadata: {
        ...metadataWithoutTransfer,
        prompt,
        source: "remote-connector",
        engine,
        model,
        effort,
        remote: {
          commandId: command.id,
          deviceId: this.config.deviceId,
          relayUrl: this.relayUrl,
          ...(portalWorkspace ? { remoteRunId: run.id } : {}),
        },
        ...(portalWorkspace
          ? {
              portal: portalWorkspace.handoff,
              executionResidence: {
                schemaVersion: 1,
                kind: "portal",
                hostId: this.config.deviceId,
                hostLabel: this.config.deviceName ?? os.hostname(),
                workspacePath: portalWorkspace.workspacePath,
                sourceBranch: portalWorkspace.handoff.sourceBranch,
                sourceCommit: portalWorkspace.handoff.commit,
                handoffId: portalWorkspace.handoff.handoffId,
                envPolicy: portalWorkspace.handoff.envPolicy,
                environmentFiles: portalEnvironment?.files ?? [],
                environmentLoadedAt: new Date().toISOString(),
              },
            }
          : {}),
        ...(portalTransfer
          ? {
              portalTransfer: {
                schemaVersion: 1,
                sourceRunId: portalTransfer.sourceRunId,
                ...(portalTransfer.sourceStatus
                  ? { sourceStatus: portalTransfer.sourceStatus }
                  : {}),
                ...(portalTransfer.sourcePhase
                  ? { sourcePhase: portalTransfer.sourcePhase }
                  : {}),
                eventCount: portalTransfer.events.length,
                transferredAt: new Date().toISOString(),
              },
            }
          : {}),
      },
    });

    if (portalTransfer) {
      appendPortalTransferTranscript(portalTransfer, run.id);
      appendCodeAgentTranscriptEvent({
        runId: run.id,
        kind: "user",
        message: prompt,
        metadata: {
          source: "portal-transfer-continuation",
          commandId: command.id,
          sourceRunId: portalTransfer.sourceRunId,
        },
      });
    } else {
      appendCodeAgentTranscriptEvent({
        runId: run.id,
        kind: "user",
        message: prompt,
        metadata: { source: "remote-initial-prompt", commandId: command.id },
      });
    }
    appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "status",
      message: "Remote Agent-Native Code run queued.",
      metadata: { status: "queued", phase: "queued", commandId: command.id },
    });
    this.remoteRunIds.add(run.id);
    this.transcriptCursors.set(run.id, { offset: 0, seq: 0 });
    this.spawnRunner(run.id, cwd, permissionMode, portalEnvironment?.values);
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

  private async stop(command: RemoteCommand) {
    const runId = firstStringValue(command.params.runId);
    const taskId = firstStringValue(command.params.taskId);
    let revokeError: string | undefined;
    if (this.computerBridge) {
      try {
        await callLocalComputerBridgeTool(
          this.computerBridge,
          "computer_revoke_control",
          { taskId, runId, reason: "remote-stop" },
        );
      } catch (error) {
        revokeError = error instanceof Error ? error.message : String(error);
      }
    } else if (taskId || command.params.computer === true) {
      revokeError = "Local authenticated computer bridge is unavailable.";
    }
    if (!runId) {
      return taskId
        ? {
            ok: !revokeError,
            taskId,
            revoked: !revokeError,
            error: revokeError,
          }
        : { ok: false, error: "Missing runId." };
    }
    const run = getCodeAgentRunRecord(runId);
    if (!run) {
      return {
        ok: !revokeError && Boolean(this.computerBridge),
        runId,
        revoked: !revokeError && Boolean(this.computerBridge),
        error: revokeError ?? `Run not found: ${runId}`,
      };
    }
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
    return {
      ok: !killError && !revokeError,
      runId,
      run: updated,
      killed,
      controlRevoked: !revokeError && Boolean(this.computerBridge),
      error: revokeError ?? killError,
    };
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
    portalEnvironment?: Record<string, string>,
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
          ...portalEnvironment,
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
      if (batch.events.length > 0) {
        await this.postJson("/_agent-native/integrations/remote/run-events", {
          deviceId: this.config.deviceId,
          remoteRunId: runId,
          cursor: { offset: batch.nextOffset },
          events: batch.events.map((event, index) => ({
            seq: cursor.seq + index,
            event,
          })),
        });
      }
      this.transcriptCursors.set(runId, {
        offset: batch.nextOffset,
        seq: cursor.seq + batch.events.length,
      });
      await this.reportRemoteRunTerminal(runId);
    }
  }

  private async reportRemoteRunTerminal(runId: string): Promise<void> {
    const run = getCodeAgentRunRecord(runId);
    if (!run || (run.status !== "completed" && run.status !== "errored")) {
      return;
    }
    const remote = isObject(run.metadata?.remote) ? run.metadata.remote : {};
    const commandId = firstStringValue(remote.commandId);
    if (!commandId || this.terminalCommandIds.has(commandId)) return;
    const errorMessage = firstStringValue(
      run.metadata?.error,
      run.metadata?.runnerError,
    );
    await this.postJson("/_agent-native/integrations/remote/result", {
      deviceId: this.config.deviceId,
      commandId,
      kind: "create-run",
      ok: run.status === "completed",
      status: run.status === "completed" ? "completed" : "failed",
      result: {
        ok: run.status === "completed",
        run,
      },
      errorMessage:
        run.status === "errored"
          ? (errorMessage ?? "Remote code-agent run failed.")
          : undefined,
    });
    this.terminalCommandIds.add(commandId);
  }

  private async postCommandResult(
    command: RemoteCommand,
    result: Record<string, unknown>,
  ) {
    let safeResult: Record<string, unknown>;
    try {
      safeResult = boundedConnectorResult(result);
    } catch (error) {
      safeResult = {
        ok: false,
        error:
          error instanceof Error
            ? `Connector result rejected: ${error.message}`
            : "Connector result rejected as unsafe.",
      };
    }
    const isAcceptedCreateRun =
      normalizeKind(command.kind) === "create-run" && safeResult.ok !== false;
    await this.postJson("/_agent-native/integrations/remote/result", {
      deviceId: this.config.deviceId,
      commandId: command.id,
      kind: command.kind,
      ok: safeResult.ok !== false,
      status:
        safeResult.ok === false
          ? "failed"
          : isAcceptedCreateRun
            ? "running"
            : "completed",
      result: safeResult,
      errorMessage:
        typeof safeResult.error === "string" ? safeResult.error : undefined,
    });
  }

  private async postJson(pathname: string, body: unknown): Promise<unknown> {
    const url = new URL(pathname, this.relayUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "x-agent-native-device-token": this.config.token,
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

function isSafeRunId(value: string): boolean {
  return value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function remoteExecutionCapabilities(): RemoteExecutionCapabilities {
  const configured = process.env[REMOTE_ENGINES_ENV]
    ?.split(",")
    .map((engine) => engine.trim())
    .filter(Boolean);
  return {
    ...DEFAULT_REMOTE_EXECUTION_CAPABILITIES,
    ...(configured?.length
      ? { engines: [...new Set(configured)].slice(0, 32) }
      : {}),
  };
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

export function loadLocalComputerBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LocalComputerBridgeConfig | null {
  const rawUrl = firstStringValue(env[COMPUTER_BRIDGE_URL_ENV]);
  const token = firstStringValue(env[COMPUTER_BRIDGE_TOKEN_ENV]);
  const rawCapabilities = firstStringValue(env[COMPUTER_CAPABILITIES_ENV]);
  if (!rawUrl || !token || !rawCapabilities) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]")
  ) {
    return null;
  }
  try {
    const value = JSON.parse(rawCapabilities) as unknown;
    const capabilities = normalizeComputerCapabilities(value);
    if (!hasComputerCapability(capabilities)) return null;
    return { url: url.toString(), token, capabilities };
  } catch {
    return null;
  }
}

export async function callLocalComputerBridgeTool(
  config: LocalComputerBridgeConfig,
  toolName: "computer_operation" | "computer_revoke_control",
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(config.url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `computer-bridge-${Date.now()}`,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Local computer bridge returned ${response.status}`);
  }
  const text = await response.text();
  const payload = parseMcpResponse(text);
  if (!isObject(payload)) {
    throw new Error("Local computer bridge returned an invalid response");
  }
  if (payload.error) {
    const error = isObject(payload.error) ? payload.error : {};
    throw new Error(
      firstStringValue(error.message) ?? "Local computer bridge rejected call",
    );
  }
  return boundedJsonValue(payload.result, "Local computer bridge result");
}

export async function dispatchComputerOperationToLocalBridge(
  config: LocalComputerBridgeConfig | null,
  rawEnvelope: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (!config) {
    throw new Error("Local authenticated computer bridge is unavailable.");
  }
  const envelope = await assertValidComputerCommandEnvelope(rawEnvelope);
  const result = await callLocalComputerBridgeTool(
    config,
    "computer_operation",
    { envelope },
    fetchImpl,
  );
  return boundedConnectorResult({
    ok: true,
    taskId: envelope.taskId,
    runId: envelope.runId,
    sequence: envelope.sequence,
    idempotencyKey: envelope.idempotencyKey,
    actionHash: envelope.approval.actionHash,
    operationClass: envelope.operationClass,
    bridgeResult: result,
  });
}

function normalizeComputerCapabilities(
  value: unknown,
): RemoteComputerCapabilities {
  if (!isObject(value)) return {};
  const browser = isObject(value.browser) ? value.browser : null;
  const desktop = isObject(value.desktop) ? value.desktop : null;
  return {
    ...(browser
      ? {
          browser: {
            observe: browser.observe === true,
            control: browser.control === true,
            provider: firstStringValue(browser.provider) ?? null,
            version: firstStringValue(browser.version) ?? null,
          },
        }
      : {}),
    ...(desktop
      ? {
          desktop: {
            observe: desktop.observe === true,
            control: desktop.control === true,
            accessibility: desktop.accessibility === true,
            screenCapture: desktop.screenCapture === true,
            provider: firstStringValue(desktop.provider) ?? null,
            version: firstStringValue(desktop.version) ?? null,
          },
        }
      : {}),
  };
}

function hasComputerCapability(
  capabilities: RemoteComputerCapabilities,
): boolean {
  return Boolean(
    capabilities.browser?.observe ||
    capabilities.browser?.control ||
    capabilities.desktop?.observe ||
    capabilities.desktop?.control,
  );
}

function parseMcpResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Local computer bridge returned no response");
  if (!trimmed.startsWith("data:")) return JSON.parse(trimmed);
  const data = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .at(-1);
  if (!data) throw new Error("Local computer bridge returned no MCP result");
  return JSON.parse(data);
}

function boundedJsonValue(value: unknown, label: string): unknown {
  return JSON.parse(
    serializeBoundedRemoteJson(value ?? null, {
      label,
      maxBytes: 128_000,
    }),
  );
}

function boundedConnectorResult(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = boundedJsonValue(value, "Remote connector result");
  if (!isObject(parsed)) {
    throw new Error("Remote connector result must be an object");
  }
  return parsed;
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
