import { describe, it, expect } from "vitest";

import { isCheckpointRestorePath } from "./route-match.js";

describe("isCheckpointRestorePath", () => {
  it("matches the mount-relative path the shim normally produces", () => {
    expect(isCheckpointRestorePath("/restore")).toBe(true);
    expect(isCheckpointRestorePath("restore")).toBe(true);
  });

  it("matches the unstripped path when the shim cannot rewrite event.url", () => {
    expect(
      isCheckpointRestorePath("/_agent-native/agent-chat/checkpoints/restore"),
    ).toBe(true);
    expect(
      isCheckpointRestorePath(
        "/app/_agent-native/agent-chat/checkpoints/restore?x=1",
      ),
    ).toBe(true);
  });

  it("does not match the checkpoint list route", () => {
    expect(isCheckpointRestorePath("/")).toBe(false);
    expect(isCheckpointRestorePath("/?threadId=t1")).toBe(false);
    expect(
      isCheckpointRestorePath(
        "/_agent-native/agent-chat/checkpoints?threadId=t1",
      ),
    ).toBe(false);
  });

  it("does not match unrelated paths that merely contain the word", () => {
    expect(isCheckpointRestorePath("/restore-deck-version")).toBe(false);
    expect(isCheckpointRestorePath("/threads/restorer")).toBe(false);
    expect(isCheckpointRestorePath(undefined)).toBe(false);
  });
});
