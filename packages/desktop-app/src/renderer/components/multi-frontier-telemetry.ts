import { trackEvent } from "@agent-native/core/client";

import type {
  MultiFrontierProviderId,
  MultiFrontierRendererState,
} from "../../../shared/multi-frontier-ipc.js";
import type { SubscriptionStatus } from "../../../shared/subscription-status.js";

type MultiFrontierLifecycleEvent =
  | {
      kind: "mode_activation";
      autoContinueAfterAgreement: boolean;
    }
  | {
      kind: "phase";
      phase: MultiFrontierRendererState["phase"];
      round: number;
      approvalState: MultiFrontierRendererState["approvalState"];
      autoContinueAfterAgreement: boolean;
      checkpointCount: number;
      reviewCount: number;
      requiresPlanningPrompt: boolean;
    }
  | {
      kind: "provider_status";
      providerId: MultiFrontierProviderId;
      connectionState: SubscriptionStatus["connectionState"];
      telemetryState: SubscriptionStatus["telemetry"]["state"];
      hasRateLimits: boolean;
      hasLiveUpdates: boolean;
    }
  | {
      kind: "action";
      action:
        | "start"
        | "go"
        | "pause"
        | "resume"
        | "cancel"
        | "re-review"
        | "role-swap";
    }
  | {
      kind: "failure";
      category: "auth" | "quota" | "provider" | "unknown";
    };

export function trackMultiFrontierLifecycle(
  event: MultiFrontierLifecycleEvent,
): void {
  trackEvent("multi_frontier_lifecycle", snakeCaseKeys(event));
}

export function multiFrontierFailureCategory(
  message: string | undefined,
): Extract<MultiFrontierLifecycleEvent, { kind: "failure" }>["category"] {
  if (!message) return "unknown";
  if (/quota|rate[ -]?limit|usage limit/i.test(message)) return "quota";
  if (/auth|login|sign[ -]?in|subscription|connect/i.test(message)) {
    return "auth";
  }
  return "provider";
}

function snakeCaseKeys(
  event: MultiFrontierLifecycleEvent,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value,
    ]),
  );
}
