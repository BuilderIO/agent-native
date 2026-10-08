import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  labEnabled: true,
  source: "choice" as "choice" | "legacy" | "default",
  saved: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/labs/server", () => ({
  getUserLabState: async () => ({
    enabled: state.labEnabled,
    source: state.source,
    legacyValues:
      state.source === "legacy"
        ? {
            useCustomSCKPipeline: false,
            customSCKPipelineLiveUploadEnabled: false,
            uploadRetryResume: false,
          }
        : undefined,
  }),
}));
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async () => state.saved,
  compareAndSetAppState: async (
    _key: string,
    expected: unknown,
    next: Record<string, unknown>,
  ) => {
    if (state.saved !== expected) return false;
    state.saved = next;
    return true;
  },
}));

import {
  getUploadRecoveryPolicy,
  snapshotUploadRecoveryPolicy,
} from "./recording-policy";

describe("recording upload policy snapshot", () => {
  beforeEach(() => {
    state.labEnabled = true;
    state.source = "choice";
    state.saved = null;
  });

  it("keeps an active upload recoverable after Labs is switched Off", async () => {
    expect(
      await snapshotUploadRecoveryPolicy("owner@example.com", "org-1", "rec-1"),
    ).toBe(true);
    state.labEnabled = false;
    expect(
      await getUploadRecoveryPolicy("owner@example.com", "org-1", "rec-1"),
    ).toBe(true);
    expect(
      await snapshotUploadRecoveryPolicy("owner@example.com", "org-1", "rec-1"),
    ).toBe(true);
  });

  it("uses Off for a new recording", async () => {
    state.labEnabled = false;
    expect(
      await snapshotUploadRecoveryPolicy("owner@example.com", "org-1", "rec-2"),
    ).toBe(false);
    state.labEnabled = true;
    expect(
      await getUploadRecoveryPolicy("owner@example.com", "org-1", "rec-2"),
    ).toBe(false);
  });

  it("preserves a pre-migration active upload after an explicit Off", async () => {
    state.labEnabled = false;
    expect(
      await getUploadRecoveryPolicy("owner@example.com", "org-1", "rec-1"),
    ).toBe(true);
    expect(
      await snapshotUploadRecoveryPolicy(
        "owner@example.com",
        "org-1",
        "rec-1",
        true,
      ),
    ).toBe(true);
  });

  it("keeps inherited legacy Off for an unmigrated recording", async () => {
    state.labEnabled = false;
    state.source = "legacy";
    expect(
      await getUploadRecoveryPolicy("owner@example.com", "org-1", "rec-1"),
    ).toBe(false);
  });

  it("rejects an unreadable saved policy", async () => {
    state.saved = { version: 1, recovery: "yes" };
    await expect(
      getUploadRecoveryPolicy("owner@example.com", "org-1", "rec-1"),
    ).rejects.toThrow("Stored recording recovery policy is unreadable");
  });
});
