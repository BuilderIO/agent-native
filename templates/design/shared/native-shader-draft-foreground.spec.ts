import { describe, expect, it } from "vitest";

import {
  nativeDraftForegroundStateSchema,
  nativeDraftTerminalSchema,
  publicNativeDraftState,
} from "./native-shader-draft-foreground";

const state = {
  schemaVersion: 1 as const,
  requestId: "f7619969-b6d9-4a10-9aa7-c7d30739df53",
  designId: "design-owned",
  fileId: "screen-owned",
  nodeId: "node-owned",
  instanceId: "instance-owned",
  tabId: "tab-owned",
  expectedVersionHash: "100:abc",
  baseExecutionHash: "a".repeat(64),
  draftExecutionHash: "b".repeat(64),
  command: "preview" as const,
  draftRef: "attachment:private-handle",
  seed: 77,
  time: 1,
  status: "pending" as const,
  issuedAt: 100,
  expiresAt: 90_100,
};

describe("native shader draft foreground state", () => {
  it("keeps an opaque attachment in scoped state but omits it from agent-visible results", () => {
    const stored = nativeDraftForegroundStateSchema.parse(state);
    expect(stored.draftRef).toBe(state.draftRef);
    const returned = publicNativeDraftState(stored);
    expect(returned).not.toHaveProperty("draftRef");
    expect(returned.draftExecutionHash).toBe("b".repeat(64));
  });

  it("rejects oversized attachments and unbounded located diagnostics", () => {
    expect(
      nativeDraftForegroundStateSchema.safeParse({
        ...state,
        draftRef: "x".repeat(4097),
      }).success,
    ).toBe(false);
    expect(
      nativeDraftTerminalSchema.safeParse({
        status: "error",
        displayed: "draft-last-good",
        diagnostics: Array.from({ length: 17 }, (_, n) => ({
          code: `gpu-${n}`,
          message: "compile-failed",
          severity: "error",
          line: n + 1,
        })),
      }).success,
    ).toBe(false);
  });

  it("rejects a ready result that does not identify a displayed frame", () => {
    expect(
      nativeDraftTerminalSchema.safeParse({
        status: "ready",
        displayed: "none",
        diagnostics: [],
      }).success,
    ).toBe(false);
    expect(
      nativeDraftTerminalSchema.safeParse({
        status: "last-good",
        displayed: "draft-last-good",
        diagnostics: [
          {
            code: "wgsl",
            message: "compile-failed",
            severity: "error",
            passId: "blur",
            line: 2,
            column: 61,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
