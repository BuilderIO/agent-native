import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  labEnabled: true,
  source: "choice" as "choice" | "legacy" | "default",
  saved: null as Record<string, unknown> | null,
  contexts: [] as unknown[],
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
  runWithRequestContext: (context: unknown, run: () => unknown) => {
    state.contexts.push(context);
    return run();
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async () => state.saved,
  writeAppState: async (_key: string, value: Record<string, unknown>) => {
    state.saved = value;
  },
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
  snapshotRichRecordingPolicy,
  richRecordingStopped,
  snapshotUploadRecoveryPolicy,
  stopRichRecording,
} from "./recording-policy";

describe("richRecordingStopped", () => {
  it("reads the owner's saved stop in the caller's transaction", async () => {
    const client = new PGlite();
    try {
      await client.exec(
        'CREATE TABLE "application_state" ("session_id" text NOT NULL, "key" text NOT NULL, "value" text NOT NULL, "updated_at" bigint NOT NULL);',
      );
      const db = drizzle(client);
      const stopped = () =>
        db.transaction((tx) =>
          richRecordingStopped(tx as never, "Owner@example.com", "rec-1"),
        );
      expect(await stopped()).toBe(false);
      await client.query("INSERT INTO application_state VALUES ($1,$2,$3,0)", [
        "owner@example.com",
        "recording-rich-policy-rec-1",
        JSON.stringify({ version: 1, rich: true }),
      ]);
      expect(await stopped()).toBe(false);
      await client.query(
        "UPDATE application_state SET value=$1 WHERE key='recording-rich-policy-rec-1'",
        [JSON.stringify({ version: 1, rich: false })],
      );
      expect(await stopped()).toBe(true);
      // Only the owner's saved state counts.
      expect(
        await db.transaction((tx) =>
          richRecordingStopped(tx as never, "other@example.com", "rec-1"),
        ),
      ).toBe(false);
    } finally {
      await client.close();
    }
  });
});

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

describe("rich recording policy snapshot", () => {
  beforeEach(() => {
    state.labEnabled = true;
    state.source = "choice";
    state.saved = null;
  });

  it("keeps a recording's tracks after Labs is switched Off", async () => {
    expect(
      await snapshotRichRecordingPolicy("owner@example.com", "org-1", "rec-1"),
    ).toBe(true);
    expect(state.saved).toEqual({ version: 1, rich: true });
    state.labEnabled = false;
    expect(
      await snapshotRichRecordingPolicy("owner@example.com", "org-1", "rec-1"),
    ).toBe(true);
  });

  it("stops a recording's tracks for good, saved as its owner", async () => {
    expect(
      await snapshotRichRecordingPolicy("owner@example.com", "org-1", "rec-3"),
    ).toBe(true);

    await stopRichRecording(" Owner@Example.com ", "rec-3");

    expect(state.contexts[state.contexts.length - 1]).toEqual({
      userEmail: "owner@example.com",
    });
    expect(
      await snapshotRichRecordingPolicy("owner@example.com", "org-1", "rec-3"),
    ).toBe(false);
  });

  it("leaves the org out of the lab read when there is none", async () => {
    await snapshotRichRecordingPolicy("owner@example.com", undefined, "rec-4");

    expect(state.contexts[state.contexts.length - 1]).toEqual({
      userEmail: "owner@example.com",
    });
  });

  it("keeps tracks off for a recording made with the lab off", async () => {
    state.labEnabled = false;
    expect(
      await snapshotRichRecordingPolicy("owner@example.com", "org-1", "rec-2"),
    ).toBe(false);
    state.labEnabled = true;
    expect(
      await snapshotRichRecordingPolicy("owner@example.com", "org-1", "rec-2"),
    ).toBe(false);
  });
});
