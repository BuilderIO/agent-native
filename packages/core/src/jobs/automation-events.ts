import { createHash } from "node:crypto";

import { credentialStateForErrorCode } from "../agent/engine/credential-state.js";
import { trackingIdentityProperties } from "../observability/tracking-identity.js";
import { countCredentialState } from "../tracking/failure-counters.js";
import { track } from "../tracking/registry.js";
import type { AutomationFailure } from "./automation-outcome.js";

/**
 * Pauses and automatic resumes as events, so "how many automations did the
 * framework stop, and for what" is a query. Both are rare by construction (a
 * pause needs a streak of identical failures, a resume needs a recovery), so
 * they are tracked one by one rather than aggregated.
 *
 * The automation is identified by a hash of its name, never the name: the name
 * is user-authored text. `automation_hash` is the first 12 hex characters of
 * sha256("<app>|<name>"); the failure capture carries the plain name in
 * `extra.failureContext.automationName`, so a hash seen in a chart is matched
 * by hashing the names an app lists.
 */
export const AUTOMATION_EVENTS = {
  paused: "automation_paused",
  resumed: "automation_resumed",
} as const;

export function automationHash(name: string): string {
  const app = trackingIdentityProperties().app ?? "";
  return createHash("sha256")
    .update(`${app}|${name}`)
    .digest("hex")
    .slice(0, 12);
}

function emit(event: string, properties: Record<string, unknown>): void {
  try {
    track(event, { ...trackingIdentityProperties(), ...properties });
    // coercion-ok: telemetry emission is best-effort and has no caller-visible value
  } catch {
    // Reporting a pause must never change what the scheduler does about it.
  }
}

export function trackAutomationPaused(input: {
  name: string;
  failure: AutomationFailure;
  consecutiveFailures: number;
  surface: "scheduler" | "trigger" | "preflight";
}): void {
  emit(AUTOMATION_EVENTS.paused, {
    automation_hash: automationHash(input.name),
    error_code: input.failure.code,
    failure_kind: input.failure.precondition ? "precondition" : "runtime",
    consecutive_failures: input.consecutiveFailures,
    surface: input.surface,
  });
}

export function trackAutomationResumed(input: {
  name: string;
  via: "credential_recovered" | "successful_run";
}): void {
  emit(AUTOMATION_EVENTS.resumed, {
    automation_hash: automationHash(input.name),
    via: input.via,
  });
}

/**
 * A failure whose code is a credential state reached the automation's owner
 * (the run could not authenticate). Counted per window, not per run.
 */
export function countAutomationCredentialState(code: string): void {
  const state = credentialStateForErrorCode(code);
  if (state) countCredentialState(state, "automation");
}
