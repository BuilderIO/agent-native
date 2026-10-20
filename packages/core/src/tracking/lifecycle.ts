import type {
  AgentNativeActionEventName,
  AgentNativeLifecycleEventName,
} from "../shared/analytics-events.js";
import { track, type TrackingSource } from "./registry.js";

export {
  AGENT_NATIVE_ACTION_EVENTS,
  AGENT_NATIVE_LIFECYCLE_EVENTS,
  type AgentNativeActionEventName,
  type AgentNativeLifecycleEventName,
} from "../shared/analytics-events.js";

export function trackLifecycleEvent(
  name: AgentNativeLifecycleEventName,
  properties?: Record<string, unknown>,
  source?: TrackingSource,
): void {
  track(name, properties, source);
}

export function trackActionEvent(
  name: AgentNativeActionEventName,
  properties: Record<string, unknown>,
  source?: TrackingSource,
): void {
  track(name, properties, source);
}
