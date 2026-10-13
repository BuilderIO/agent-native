// Toolkit's core peer range includes releases without
// @agent-native/core/client/session-replay-privacy, so it repeats core's replay
// markers instead of importing them. Its spec asserts core's attribute names.
export const SESSION_REPLAY_MASK_PROPS = { "data-an-mask": "" } as const;
export const SESSION_REPLAY_BLOCK_PROPS = { "data-an-block": "" } as const;
