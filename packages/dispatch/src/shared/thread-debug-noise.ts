// Streamed agent run event types that Thread Debug hides by default. The
// server skips these past the event window and the page filters them out.
export const THREAD_DEBUG_NOISE_EVENT_TYPES = [
  "thinking",
  "text",
  "tool_input_delta",
  "stream_keepalive",
  "activity",
] as const;

export function isThreadDebugNoiseEventType(type: unknown): boolean {
  return (THREAD_DEBUG_NOISE_EVENT_TYPES as readonly unknown[]).includes(type);
}
