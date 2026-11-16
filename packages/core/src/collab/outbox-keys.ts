// localStorage key prefixes of the collab client's outbox: updates the server
// has not acknowledged, one entry per connection. The client writes v2 and
// still restores v1, so anything that looks for unsent updates must match
// every prefix in COLLAB_OUTBOX_PREFIXES, or it reads an empty outbox while
// the client holds edits.
export const COLLAB_OUTBOX_PREFIX = "agent-native-collab-outbox-v1:";
export const COLLAB_VERSIONED_OUTBOX_PREFIX = "agent-native-collab-outbox-v2:";
export const COLLAB_OUTBOX_PREFIXES: readonly string[] = [
  COLLAB_OUTBOX_PREFIX,
  COLLAB_VERSIONED_OUTBOX_PREFIX,
];
