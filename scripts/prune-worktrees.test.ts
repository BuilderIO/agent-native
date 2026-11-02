import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAgentWorktree,
  keepReason,
  type WorktreeState,
} from "./prune-worktrees.ts";

const safe: WorktreeState = {
  dirty: false,
  locked: false,
  inUse: false,
  idleHours: 48,
  published: true,
};

describe("keepReason", () => {
  it("removes a clean, pushed, idle worktree", () => {
    assert.equal(keepReason(safe, 6), null);
  });
  it("keeps anything that could lose work or is in use", () => {
    for (const s of [
      { dirty: true },
      { locked: true },
      { inUse: true },
      { published: false },
      { idleHours: 1 },
    ]) {
      assert.notEqual(keepReason({ ...safe, ...s }, 6), null);
    }
  });
  it("treats an unreadable publish state as keep, not safe", () => {
    assert.notEqual(keepReason({ ...safe, published: null }, 6), null);
  });
});

describe("isAgentWorktree", () => {
  it("matches only codex and claude worktree dirs", () => {
    assert.ok(
      isAgentWorktree("/Users/a/.codex/worktrees/x/framework", "/Users/a"),
    );
    assert.ok(isAgentWorktree("/r/fw/.claude/worktrees/x", "/Users/a"));
    assert.ok(!isAgentWorktree("/Users/a/Projects/re/wt/crm", "/Users/a"));
  });
});
