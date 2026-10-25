import {
  resolveRunNoProgressTimeoutMs,
  resolveRunSoftTimeoutMs,
} from "../run-manager.js";
import type { StartRunOptions } from "../run-manager.js";
import type { AgentHarnessRunPolicy } from "./types.js";

export function resolveAgentHarnessRunPolicy(
  options: StartRunOptions | undefined,
  defaultEngineName: string,
): AgentHarnessRunPolicy {
  const backgroundFunction = options?.backgroundFunction === true;
  const softTimeoutMs = resolveRunSoftTimeoutMs(options?.softTimeoutMs, {
    useHostedDefault: options?.useHostedSoftTimeoutDefault ?? true,
    backgroundFunction,
  });
  const noProgressTimeoutMs = resolveRunNoProgressTimeoutMs({
    softTimeoutMs,
    backgroundFunction,
    ...(options?.noProgressTimeoutMs !== undefined
      ? { overrideMs: options.noProgressTimeoutMs }
      : {}),
    ...(options?.backgroundNoProgressTimeoutMs !== undefined
      ? { backgroundOverrideMs: options.backgroundNoProgressTimeoutMs }
      : {}),
  });

  return {
    softTimeoutMs,
    noProgressTimeoutMs,
    backgroundFunction,
    recoverChunkBoundaries: options?.recoverChunkBoundaries ?? true,
    engineName: options?.engineName ?? defaultEngineName,
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.attemptCount !== undefined
      ? { attemptCount: options.attemptCount }
      : {}),
  };
}

export function isAgentHarnessRunPolicy(
  value: unknown,
): value is AgentHarnessRunPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.softTimeoutMs === "number" &&
    Number.isFinite(policy.softTimeoutMs) &&
    policy.softTimeoutMs >= 0 &&
    typeof policy.noProgressTimeoutMs === "number" &&
    Number.isFinite(policy.noProgressTimeoutMs) &&
    policy.noProgressTimeoutMs >= 0 &&
    typeof policy.backgroundFunction === "boolean" &&
    typeof policy.recoverChunkBoundaries === "boolean" &&
    typeof policy.engineName === "string" &&
    (policy.model === undefined || typeof policy.model === "string") &&
    (policy.attemptCount === undefined ||
      (typeof policy.attemptCount === "number" &&
        Number.isFinite(policy.attemptCount)))
  );
}

export function agentHarnessFollowUpRunOptions(
  policy: AgentHarnessRunPolicy | null | undefined,
): StartRunOptions {
  if (!policy) {
    return {
      executionLease: true,
      recoverChunkBoundaries: true,
      softTimeoutMs: resolveRunSoftTimeoutMs(undefined, {
        useHostedDefault: true,
      }),
    };
  }

  return {
    executionLease: true,
    softTimeoutMs: policy.softTimeoutMs,
    noProgressTimeoutMs: policy.noProgressTimeoutMs,
    backgroundFunction: policy.backgroundFunction,
    recoverChunkBoundaries: policy.recoverChunkBoundaries,
    engineName: policy.engineName,
    ...(policy.model ? { model: policy.model } : {}),
    ...(policy.attemptCount !== undefined
      ? { attemptCount: policy.attemptCount }
      : {}),
  };
}
