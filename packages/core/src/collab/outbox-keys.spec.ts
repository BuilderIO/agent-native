import { describe, expect, it } from "vitest";

import {
  COLLAB_OUTBOX_PREFIX,
  COLLAB_OUTBOX_PREFIXES,
  COLLAB_VERSIONED_OUTBOX_PREFIX,
} from "./outbox-keys.js";

describe("collab outbox keys", () => {
  // Tabs that closed with unsent edits left them under these keys; renaming
  // one strands those edits in browsers that already hold them.
  it("keeps the keys stored outboxes already use", () => {
    expect(COLLAB_OUTBOX_PREFIX).toBe("agent-native-collab-outbox-v1:");
    expect(COLLAB_VERSIONED_OUTBOX_PREFIX).toBe(
      "agent-native-collab-outbox-v2:",
    );
    expect(COLLAB_OUTBOX_PREFIXES).toEqual([
      COLLAB_OUTBOX_PREFIX,
      COLLAB_VERSIONED_OUTBOX_PREFIX,
    ]);
  });
});
