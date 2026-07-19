import {
  MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
  MULTI_FRONTIER_IPC_MAX_PAYLOAD_BYTES,
  MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
  redactMultiFrontierSensitiveText,
} from "../../shared/multi-frontier-ipc.js";
import {
  normalizeSubscriptionStatus,
  type SubscriptionStatus,
} from "../../shared/subscription-status.js";
import type { MultiFrontierHelperPolicy } from "./multi-frontier-orchestrator.js";

const MAX_HELPER_DEPTH = 2;
const MAX_HELPER_TASKS = 8;
const MAX_HELPER_TURNS = 20;
const MAX_HELPER_ARTIFACTS = 12;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const SAFE_RUNTIME_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,159}$/;

export type MultiFrontierHelperKind = "research" | "test_analysis" | "review";

/**
 * This is created only from a provider/runtime probe that proved both model
 * selection and a process-enforced read-only workspace. A prompt claim is not
 * enough to make a runtime helper-capable.
 */
export interface MultiFrontierProvenHelperCapability {
  schemaVersion: 1;
  providerId: "codex" | "claude";
  runtime: "codex-cli" | "claude-code";
  runtimeVersion: string;
  requestedModel: string;
  effectiveModel: string;
  modelSelection: "verified";
  workspacePermission: "read_only_enforced";
  verifiedAt: string;
}

export interface MultiFrontierHelperArtifact {
  id: string;
  summary: string;
}

export interface MultiFrontierReadOnlyHelperLaunch {
  collaborationId: string;
  taskId: string;
  providerId: "codex" | "claude";
  runtime: "codex-cli" | "claude-code";
  kind: MultiFrontierHelperKind;
  depth: number;
  requestedModel: string;
  effectiveModel: string;
  workspacePermission: "read_only";
  maxTurns: number;
  prompt: string;
  artifacts: readonly MultiFrontierHelperArtifact[];
  signal: AbortSignal;
}

export interface MultiFrontierReadOnlyHelperResult {
  effectiveModel: string;
  turns: number;
  summary: string;
}

export interface MultiFrontierHelperLaunchRecord {
  collaborationId: string;
  taskId: string;
  providerId: "codex" | "claude";
  runtime: "codex-cli" | "claude-code";
  kind: MultiFrontierHelperKind;
  depth: number;
  requestedModel: string;
  effectiveModel: string;
  quotaUsedPercent: number;
  quotaObservedAt: string;
  status: "started" | "completed" | "failed";
  turns?: number;
  summary?: string;
  message?: string;
  recordedAt: string;
}

export interface MultiFrontierHelperLaunchInput {
  taskId: string;
  kind: MultiFrontierHelperKind;
  depth: number;
  prompt: string;
  artifacts: readonly MultiFrontierHelperArtifact[];
  signal?: AbortSignal;
}

export interface MultiFrontierHelperRuntimeOptions {
  collaborationId: string;
  policy: MultiFrontierHelperPolicy;
  capability: MultiFrontierProvenHelperCapability | null;
  stopOptionalAtPercent: number;
  readSubscriptionStatus(
    providerId: "codex" | "claude",
  ): Promise<SubscriptionStatus | null>;
  spawnReadOnly(
    input: MultiFrontierReadOnlyHelperLaunch,
  ): Promise<MultiFrontierReadOnlyHelperResult>;
  recordLaunch(record: MultiFrontierHelperLaunchRecord): Promise<void> | void;
  now?(): string;
}

/**
 * A main-process-only guard around optional helpers. It deliberately has no
 * editing mode: adding one requires a separately proven fenced lease handoff.
 */
export class MultiFrontierHelperRuntime {
  readonly #options: MultiFrontierHelperRuntimeOptions;
  readonly #taskIds = new Set<string>();
  #startedTasks = 0;

  constructor(options: MultiFrontierHelperRuntimeOptions) {
    assertSafeId(options.collaborationId, "collaboration id");
    validatePolicy(options.policy);
    validateCapability(options.capability, options.policy);
    if (
      !Number.isFinite(options.stopOptionalAtPercent) ||
      options.stopOptionalAtPercent < 0 ||
      options.stopOptionalAtPercent > 100
    ) {
      throw new Error("The optional helper quota threshold is invalid.");
    }
    this.#options = options;
  }

  get available(): boolean {
    const { capability, policy } = this.#options;
    return Boolean(
      capability &&
      policy.delegationAvailable &&
      policy.readOnlyDefault === true &&
      policy.maxDepth > 0 &&
      policy.maxTasks > 0 &&
      policy.maxTurns > 0,
    );
  }

  async launch(
    input: MultiFrontierHelperLaunchInput,
  ): Promise<MultiFrontierReadOnlyHelperResult> {
    const capability = this.#options.capability;
    if (!this.available || !capability) {
      throw new Error(
        "Optional helpers are unavailable until the provider runtime is proven.",
      );
    }
    validateLaunchInput(input, this.#options.policy);
    if (this.#taskIds.has(input.taskId)) {
      throw new Error("A helper task id may be launched only once.");
    }
    if (this.#startedTasks >= this.#options.policy.maxTasks) {
      throw new Error("The optional helper task cap has been reached.");
    }

    const quota = await this.#readLiveQuota(capability.providerId);
    if (quota.usedPercent >= this.#options.stopOptionalAtPercent) {
      throw new Error(
        "Optional helpers are paused because the provider-reported quota is near its limit.",
      );
    }
    if (input.signal?.aborted) throw abortError();

    const controller = new AbortController();
    const detachAbort = forwardAbort(input.signal, controller);
    const recordBase = {
      collaborationId: this.#options.collaborationId,
      taskId: input.taskId,
      providerId: capability.providerId,
      runtime: capability.runtime,
      kind: input.kind,
      depth: input.depth,
      requestedModel: capability.requestedModel,
      effectiveModel: capability.effectiveModel,
      quotaUsedPercent: quota.usedPercent,
      quotaObservedAt: quota.observedAt,
    } as const;

    this.#taskIds.add(input.taskId);
    this.#startedTasks += 1;
    try {
      await this.#options.recordLaunch({
        ...recordBase,
        status: "started",
        recordedAt: this.#now(),
      });
      const result = await this.#options.spawnReadOnly({
        collaborationId: this.#options.collaborationId,
        taskId: input.taskId,
        providerId: capability.providerId,
        runtime: capability.runtime,
        kind: input.kind,
        depth: input.depth,
        requestedModel: capability.requestedModel,
        effectiveModel: capability.effectiveModel,
        workspacePermission: "read_only",
        maxTurns: this.#options.policy.maxTurns,
        prompt: input.prompt,
        artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
        signal: controller.signal,
      });
      if (result.effectiveModel !== capability.effectiveModel) {
        throw new Error("The helper runtime did not confirm the proven model.");
      }
      if (
        !Number.isSafeInteger(result.turns) ||
        result.turns < 1 ||
        result.turns > this.#options.policy.maxTurns
      ) {
        throw new Error("The helper runtime exceeded its turn contract.");
      }
      const summary = boundedSafeText(result.summary, "helper summary");
      await this.#options.recordLaunch({
        ...recordBase,
        status: "completed",
        turns: result.turns,
        summary,
        recordedAt: this.#now(),
      });
      return {
        effectiveModel: result.effectiveModel,
        turns: result.turns,
        summary,
      };
    } catch (error) {
      await this.#recordFailure(recordBase, error);
      throw error;
    } finally {
      detachAbort();
    }
  }

  async #readLiveQuota(
    providerId: "codex" | "claude",
  ): Promise<{ usedPercent: number; observedAt: string }> {
    const status = normalizeSubscriptionStatus(
      await this.#options.readSubscriptionStatus(providerId),
    );
    if (
      !status ||
      status.providerId !== providerId ||
      status.connectionState !== "connected" ||
      status.telemetry.state !== "live" ||
      !status.telemetry.capabilities.rateLimits ||
      !status.telemetry.updatedAt
    ) {
      throw new Error(
        "Optional helpers require fresh provider-reported quota telemetry.",
      );
    }
    const used = status.telemetry.meters
      .filter(
        (meter) =>
          meter.state === "available" &&
          typeof meter.usedPercent === "number" &&
          Number.isFinite(meter.usedPercent),
      )
      .map((meter) => meter.usedPercent!);
    if (used.length === 0) {
      throw new Error(
        "Optional helpers require a usable provider-reported quota meter.",
      );
    }
    return {
      usedPercent: Math.max(...used),
      observedAt: status.telemetry.updatedAt,
    };
  }

  async #recordFailure(
    base: Omit<MultiFrontierHelperLaunchRecord, "status" | "recordedAt">,
    error: unknown,
  ): Promise<void> {
    try {
      await this.#options.recordLaunch({
        ...base,
        status: "failed",
        message: safeErrorMessage(error),
        recordedAt: this.#now(),
      });
    } catch {
      // The original launch failure remains the authoritative outcome.
    }
  }

  #now(): string {
    const now = this.#options.now?.() ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(now))) {
      throw new Error(
        "The helper runtime clock returned an invalid timestamp.",
      );
    }
    return now;
  }
}

function validatePolicy(policy: MultiFrontierHelperPolicy): void {
  if (
    policy.readOnlyDefault !== true ||
    !Number.isSafeInteger(policy.maxDepth) ||
    policy.maxDepth < 0 ||
    policy.maxDepth > MAX_HELPER_DEPTH ||
    !Number.isSafeInteger(policy.maxTasks) ||
    policy.maxTasks < 0 ||
    policy.maxTasks > MAX_HELPER_TASKS ||
    !Number.isSafeInteger(policy.maxTurns) ||
    policy.maxTurns < 0 ||
    policy.maxTurns > MAX_HELPER_TURNS
  ) {
    throw new Error("Invalid bounded helper policy.");
  }
  if (
    policy.delegationAvailable &&
    (!safeModel(policy.requestedModel) || !safeModel(policy.effectiveModel))
  ) {
    throw new Error(
      "Available helpers require requested and effective models.",
    );
  }
}

function validateCapability(
  capability: MultiFrontierProvenHelperCapability | null,
  policy: MultiFrontierHelperPolicy,
): void {
  if (!capability) return;
  if (
    capability.schemaVersion !== 1 ||
    (capability.providerId !== "codex" && capability.providerId !== "claude") ||
    (capability.providerId === "codex" && capability.runtime !== "codex-cli") ||
    (capability.providerId === "claude" &&
      capability.runtime !== "claude-code") ||
    !SAFE_RUNTIME_VERSION.test(capability.runtimeVersion) ||
    !safeModel(capability.requestedModel) ||
    !safeModel(capability.effectiveModel) ||
    capability.modelSelection !== "verified" ||
    capability.workspacePermission !== "read_only_enforced" ||
    Number.isNaN(Date.parse(capability.verifiedAt))
  ) {
    throw new Error("The provider helper capability is not safely proven.");
  }
  if (
    !policy.delegationAvailable ||
    policy.requestedModel !== capability.requestedModel ||
    policy.effectiveModel !== capability.effectiveModel
  ) {
    throw new Error(
      "The provider helper capability does not match the configured policy.",
    );
  }
}

function validateLaunchInput(
  input: MultiFrontierHelperLaunchInput,
  policy: MultiFrontierHelperPolicy,
): void {
  assertSafeId(input.taskId, "helper task id");
  if (
    input.kind !== "research" &&
    input.kind !== "test_analysis" &&
    input.kind !== "review"
  ) {
    throw new Error(
      "Editing helpers require a separately fenced lease handoff.",
    );
  }
  if (
    !Number.isSafeInteger(input.depth) ||
    input.depth < 1 ||
    input.depth > policy.maxDepth
  ) {
    throw new Error("The helper delegation depth exceeds its policy.");
  }
  assertCleanBoundedText(
    input.prompt,
    MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
    "helper prompt",
  );
  if (input.artifacts.length > MAX_HELPER_ARTIFACTS) {
    throw new Error("Too many bounded artifacts were provided to a helper.");
  }
  const artifactIds = new Set<string>();
  for (const artifact of input.artifacts) {
    assertSafeId(artifact.id, "helper artifact id");
    if (artifactIds.has(artifact.id)) {
      throw new Error("Helper artifact ids must be unique.");
    }
    artifactIds.add(artifact.id);
    assertCleanBoundedText(
      artifact.summary,
      MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
      "helper artifact summary",
    );
  }
  if (
    Buffer.byteLength(
      JSON.stringify({ prompt: input.prompt, artifacts: input.artifacts }),
    ) > MULTI_FRONTIER_IPC_MAX_PAYLOAD_BYTES
  ) {
    throw new Error("The helper payload exceeds its byte limit.");
  }
}

function assertCleanBoundedText(
  value: unknown,
  maxBytes: number,
  label: string,
): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The ${label} must be non-empty.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`The ${label} exceeds its byte limit.`);
  }
  if (redactMultiFrontierSensitiveText(value) !== value) {
    throw new Error(`The ${label} contains sensitive text.`);
  }
}

function boundedSafeText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The ${label} must be non-empty.`);
  }
  const redacted = redactMultiFrontierSensitiveText(value);
  return Buffer.from(redacted, "utf8")
    .subarray(0, MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES)
    .toString("utf8");
}

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Helper launch failed.";
  return boundedSafeText(message, "helper failure");
}

function safeModel(value: string | null): value is string {
  return typeof value === "string" && SAFE_MODEL.test(value);
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Invalid ${label}.`);
}

function forwardAbort(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!signal) return () => {};
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function abortError(): Error {
  const error = new Error("The helper launch was aborted.");
  error.name = "AbortError";
  return error;
}
