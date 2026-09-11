/**
 * @agent-native/scheduling
 *
 * Root entry — re-exports shared types and constants only.
 * Subpath imports are the primary API surface:
 *
 *   import { eventTypes, bookings } from "@agent-native/scheduling/schema";
 *   import { computeAvailableSlots } from "@agent-native/scheduling/core";
 *   import { useSlots } from "@agent-native/scheduling/react";
 */

export * from "./shared/index.js";
export { MANIFEST } from "./manifest.js";
export { VERSION } from "./version.js";
