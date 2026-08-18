import {
  enqueueRemoteCommand,
  getRemoteCommand,
  getRemoteCommandByIdempotencyKey,
} from "../integrations/remote-commands-store.js";
import {
  getRemoteDeviceForOwner,
  getRemoteExecutionCapabilities,
} from "../integrations/remote-devices-store.js";
import type {
  RemoteCommand,
  RemoteDevice,
} from "../integrations/remote-types.js";
import {
  organizationResourceOwner,
  resourceGetByPath,
  resourcePutIfCurrent,
  type Resource,
} from "../resources/store.js";
import {
  buildJobResourceContent,
  parseJobResource,
  type JobFrontmatter,
} from "./frontmatter.js";
import { finishAutomationRun, startAutomationRun } from "./run-history.js";

/** A remote run is allowed to be long-lived, but never indefinitely invisible. */
export const REMOTE_AUTOMATION_MAX_ACTIVE_MS = 24 * 60 * 60_000;

export type RemoteAutomationState =
  | "not-remote"
  | "active"
  | "completed"
  | "failed";

export interface RemoteAutomationStatus {
  state: RemoteAutomationState;
  command?: RemoteCommand;
  error?: string;
}

export interface RemoteAutomationDispatchInput {
  resource: Resource;
  meta: JobFrontmatter;
  body: string;
  ownerEmail: string;
  orgId?: string;
  appId?: string;
  prompt: string;
  title: string;
  historyId?: string;
  /** Whether completing this remote dispatch should advance its cron schedule. */
  advanceSchedule?: boolean;
  now?: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function automationName(path: string): string {
  return path.replace(/^jobs\//, "").replace(/\.md$/, "");
}

function remoteRequestId(
  resource: Resource,
  meta: JobFrontmatter,
  now: Date,
): string {
  const runAt = meta.lastRun || now.toISOString();
  return `remote-automation:${resource.owner}:${resource.path}:${runAt}`.slice(
    0,
    512,
  );
}

function assertRemoteHostCanRun(
  device: RemoteDevice,
  meta: JobFrontmatter,
): void {
  if (device.status !== "active") {
    throw new Error(`Execution host "${device.label}" is revoked or inactive.`);
  }
  const capabilities = getRemoteExecutionCapabilities(device);
  if (!capabilities) return;
  if (capabilities.acceptsScheduledWork !== true) {
    throw new Error(
      `Execution host "${device.label}" does not accept scheduled work.`,
    );
  }
  if (
    capabilities.workloads?.length &&
    !capabilities.workloads.includes("scheduled-code")
  ) {
    throw new Error(
      `Execution host "${device.label}" does not advertise scheduled-code work.`,
    );
  }
  if (
    meta.executionEngine &&
    capabilities.engines?.length &&
    !capabilities.engines.includes(meta.executionEngine)
  ) {
    throw new Error(
      `Execution host "${device.label}" does not advertise engine "${meta.executionEngine}".`,
    );
  }
}

async function resolveRemoteHost(input: {
  hostId: string;
  ownerEmail: string;
  orgId?: string;
}): Promise<RemoteDevice> {
  const device = await getRemoteDeviceForOwner({
    id: input.hostId,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
  });
  if (!device) {
    throw new Error(
      `Execution host "${input.hostId}" is not paired with this account and organization.`,
    );
  }
  return device;
}

function remoteRunIdFromCommand(command: RemoteCommand): string | undefined {
  const result = isRecord(command.result) ? command.result : undefined;
  const nested = isRecord(result?.result) ? result.result : result;
  const run = isRecord(nested?.run) ? nested.run : undefined;
  return readString(run?.id, run?.runId);
}

/**
 * Queue one host-targeted automation. The request key is derived from the
 * persisted start timestamp, so a worker crash between the queue write and
 * resource bookkeeping cannot create a second remote run.
 */
export async function dispatchRemoteAutomation(
  input: RemoteAutomationDispatchInput,
): Promise<{
  command: RemoteCommand;
  requestId: string;
  automationRunId?: string;
}> {
  const now = input.now ?? new Date();
  const hostId = input.meta.executionHostId?.trim();
  if (!hostId) throw new Error("A remote automation requires executionHostId.");
  const device = await resolveRemoteHost({
    hostId,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
  });
  assertRemoteHostCanRun(device, input.meta);

  const latest = await resourceGetByPath(
    input.resource.owner,
    input.resource.path,
  );
  if (!latest || latest.id !== input.resource.id) {
    throw new Error("The automation changed before remote dispatch.");
  }
  const parsed = parseJobResource(latest.content);
  if (parsed.meta.lastStatus !== "running") {
    throw new Error("The automation is no longer marked as running.");
  }
  const requestId =
    parsed.meta.remoteRequestId ||
    input.meta.remoteRequestId ||
    remoteRequestId(latest, parsed.meta, now);

  let currentResource = latest;
  let currentMeta = parsed.meta;
  if (!currentMeta.remoteRequestId) {
    const withRequest = { ...currentMeta, remoteRequestId: requestId };
    const claimed = await resourcePutIfCurrent({
      owner: latest.owner,
      path: latest.path,
      content: buildJobResourceContent(withRequest, parsed.body),
      expectedId: latest.id,
      expectedUpdatedAt: latest.updatedAt,
      expectedContent: latest.content,
    });
    if (!claimed)
      throw new Error("The automation changed before remote dispatch.");
    currentResource = claimed;
    currentMeta = withRequest;
  }

  let automationRunId = input.historyId || currentMeta.remoteAutomationRunId;
  let createdHistory = false;
  if (!automationRunId) {
    try {
      const historyOwner = input.orgId
        ? organizationResourceOwner(input.orgId)
        : input.resource.owner === "__shared__"
          ? input.ownerEmail
          : input.resource.owner;
      automationRunId = await startAutomationRun({
        owner: historyOwner,
        automation: automationName(input.resource.path),
        path: input.resource.path,
        scope: input.orgId ? "organization" : "personal",
        orgId: input.orgId ?? null,
        appId: input.appId,
      });
      createdHistory = true;
    } catch (error) {
      console.warn(
        `[automations] Could not open remote history for "${input.resource.path}"; queueing without it:`,
        error,
      );
      automationRunId = undefined;
    }
  }

  try {
    const command = await enqueueRemoteCommand({
      deviceId: device.id,
      ownerEmail: input.ownerEmail,
      orgId: input.orgId ?? null,
      kind: "create-run",
      idempotencyKey: requestId,
      platform: "automation",
      externalThreadId: `automation:${automationName(input.resource.path)}`,
      params: {
        prompt: input.prompt,
        title: input.title,
        cwd: currentMeta.executionCwd,
        goalId: `automation:${automationName(input.resource.path)}`,
        permissionMode: "full-auto",
        engine: currentMeta.executionEngine,
        model: currentMeta.model,
        workload: "scheduled-code",
        metadata: {
          source: "scheduled-automation",
          automation: {
            name: automationName(input.resource.path),
            path: input.resource.path,
            runAt: currentMeta.lastRun,
          },
          ...(automationRunId ? { automationRunId } : {}),
        },
      },
    });

    const nextMeta: JobFrontmatter = {
      ...currentMeta,
      remoteRequestId: requestId,
      remoteCommandId: command.id,
      remoteRunId: remoteRunIdFromCommand(command),
      remoteAutomationRunId: automationRunId,
      remoteAdvanceSchedule: input.advanceSchedule !== false,
    };
    const persisted = await resourcePutIfCurrent({
      owner: currentResource.owner,
      path: currentResource.path,
      content: buildJobResourceContent(nextMeta, parsed.body),
      expectedId: currentResource.id,
      expectedUpdatedAt: currentResource.updatedAt,
      expectedContent: currentResource.content,
    });
    if (!persisted) {
      console.warn(
        `[automations] Remote command ${command.id} was queued but the automation bookkeeping changed concurrently.`,
      );
    }
    return { command, requestId, automationRunId };
  } catch (error) {
    if (createdHistory && automationRunId) {
      await finishAutomationRun(
        automationRunId,
        "error",
        error instanceof Error ? error.message : "Remote dispatch failed.",
      ).catch(() => undefined);
    }
    throw error;
  }
}

export async function getRemoteAutomationStatus(input: {
  meta: JobFrontmatter;
  ownerEmail: string;
  orgId?: string;
  now?: Date;
}): Promise<RemoteAutomationStatus> {
  if (!input.meta.executionHostId) return { state: "not-remote" };
  if (!input.meta.remoteRequestId) {
    return {
      state: "failed",
      error: "Remote dispatch bookkeeping is missing its request id.",
    };
  }
  const device = await resolveRemoteHost({
    hostId: input.meta.executionHostId,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
  });
  if (device.status !== "active") {
    return {
      state: "failed",
      error: `Execution host "${device.label}" is revoked or inactive.`,
    };
  }
  const command = input.meta.remoteCommandId
    ? await getRemoteCommand(input.meta.remoteCommandId)
    : await getRemoteCommandByIdempotencyKey({
        deviceId: device.id,
        idempotencyKey: input.meta.remoteRequestId,
      });
  if (
    command &&
    (command.deviceId !== device.id ||
      command.ownerEmail !== input.ownerEmail ||
      command.orgId !== (input.orgId ?? null))
  ) {
    return {
      state: "failed",
      error: "Remote dispatch bookkeeping failed its host ownership check.",
    };
  }
  if (!command) {
    const startedAt = input.meta.lastRun
      ? Date.parse(input.meta.lastRun)
      : Number.NaN;
    const age = (input.now ?? new Date()).getTime() - startedAt;
    return age >= REMOTE_AUTOMATION_MAX_ACTIVE_MS
      ? {
          state: "failed",
          error: "Remote dispatch did not produce a command within 24 hours.",
        }
      : { state: "active" };
  }
  if (command.status === "failed") {
    return {
      state: "failed",
      command,
      error: command.errorMessage ?? "The remote command failed.",
    };
  }
  if (command.status !== "completed") {
    const activeAt =
      command.updatedAt || command.claimedAt || command.createdAt;
    const age = (input.now ?? new Date()).getTime() - activeAt;
    if (Number.isFinite(age) && age >= REMOTE_AUTOMATION_MAX_ACTIVE_MS) {
      return {
        state: "failed",
        command,
        error: "The remote command remained active for more than 24 hours.",
      };
    }
    return { state: "active", command };
  }

  const result = isRecord(command.result) ? command.result : undefined;
  const nested = isRecord(result?.result) ? result.result : result;
  if (nested?.ok === false) {
    return {
      state: "failed",
      command,
      error:
        command.errorMessage ??
        readString(nested.error) ??
        "Remote run failed.",
    };
  }
  const run = isRecord(nested?.run) ? nested.run : undefined;
  const runStatus = readString(run?.status);
  if (runStatus === "completed") return { state: "completed", command };
  if (runStatus === "errored" || runStatus === "paused") {
    return {
      state: "failed",
      command,
      error:
        readString(run?.error, run?.errorMessage) ??
        command.errorMessage ??
        `Remote run ended with status ${runStatus}.`,
    };
  }
  if (runStatus === "needs-approval") return { state: "active", command };
  // A future container/Kubernetes adapter may complete a command without
  // exposing the desktop run shape. Its terminal command is still authoritative.
  return { state: "completed", command };
}

export async function finishRemoteAutomationHistory(
  meta: Pick<JobFrontmatter, "remoteAutomationRunId">,
  state: "completed" | "failed",
  error?: string,
): Promise<void> {
  if (!meta.remoteAutomationRunId) return;
  await finishAutomationRun(
    meta.remoteAutomationRunId,
    state === "completed" ? "success" : "error",
    error,
  );
}
