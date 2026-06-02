import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppStateMock = vi.hoisted(() => vi.fn());
const writeAppStateMock = vi.hoisted(() => vi.fn());
const deleteAppStateMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: readAppStateMock,
  writeAppState: writeAppStateMock,
  deleteAppState: deleteAppStateMock,
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-05-28T00:00:00.000Z"),
}));

import { upsertVariantSlot, wasVariantSlotDismissed } from "./variant-slots.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("variant slot state", () => {
  let appState: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    appState = null;
    readAppStateMock.mockImplementation(async (key: string) => {
      if (key !== "asset-variants") return null;
      return appState ? clone(appState) : null;
    });
    writeAppStateMock.mockImplementation(
      async (key: string, value: Record<string, unknown>) => {
        if (key !== "asset-variants") return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        appState = clone(value);
      },
    );
    deleteAppStateMock.mockResolvedValue(false);
  });

  it("keeps every slot when a batch writes live candidates in parallel", async () => {
    await Promise.all(
      ["slot-1", "slot-2", "slot-3"].map((slotId, index) =>
        upsertVariantSlot({
          runId: `run-${index + 1}`,
          batchId: "batch-1",
          libraryId: "lib-1",
          prompt: "Generate a diagram",
          slotId,
          status: "pending",
        }),
      ),
    );

    expect((appState as any).slots.map((slot: any) => slot.slotId)).toEqual([
      "slot-1",
      "slot-2",
      "slot-3",
    ]);
    await expect(wasVariantSlotDismissed("lib-1", "slot-1")).resolves.toBe(
      false,
    );
    await expect(wasVariantSlotDismissed("lib-1", "slot-2")).resolves.toBe(
      false,
    );
    await expect(wasVariantSlotDismissed("lib-1", "slot-3")).resolves.toBe(
      false,
    );
  });

  it("updates one slot without dropping its siblings", async () => {
    await Promise.all(
      ["slot-1", "slot-2"].map((slotId, index) =>
        upsertVariantSlot({
          runId: `run-${index + 1}`,
          batchId: "batch-1",
          libraryId: "lib-1",
          prompt: "Generate a diagram",
          slotId,
          status: "pending",
        }),
      ),
    );

    await upsertVariantSlot({
      runId: "run-1",
      batchId: "batch-1",
      libraryId: "lib-1",
      prompt: "Generate a diagram",
      slotId: "slot-1",
      status: "ready",
      assetId: "asset-1",
      previewUrl: "/api/assets/asset-1/content",
    });

    expect((appState as any).slots).toEqual([
      expect.objectContaining({
        slotId: "slot-1",
        status: "ready",
        assetId: "asset-1",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      }),
      expect.objectContaining({ slotId: "slot-2", status: "pending" }),
    ]);
  });

  it("starts a fresh live panel when a new prompt begins", async () => {
    await upsertVariantSlot({
      runId: "run-1",
      batchId: "batch-1",
      libraryId: "lib-1",
      prompt: "First prompt",
      slotId: "slot-1",
      status: "ready",
      assetId: "asset-1",
    });

    await upsertVariantSlot({
      runId: "run-2",
      batchId: "batch-2",
      libraryId: "lib-1",
      prompt: "Second prompt",
      slotId: "slot-2",
      status: "pending",
    });

    expect((appState as any).prompt).toBe("Second prompt");
    expect((appState as any).slots).toEqual([
      expect.objectContaining({ slotId: "slot-2", status: "pending" }),
    ]);
  });

  it("starts a fresh live panel for a new batch with the same prompt", async () => {
    await Promise.all(
      ["slot-1", "slot-2"].map((slotId, index) =>
        upsertVariantSlot({
          runId: `run-${index + 1}`,
          batchId: "batch-1",
          libraryId: "lib-1",
          prompt: "Same prompt",
          slotId,
          status: "ready",
          assetId: `asset-${index + 1}`,
        }),
      ),
    );

    await upsertVariantSlot({
      runId: "run-3",
      batchId: "batch-2",
      libraryId: "lib-1",
      prompt: "Same prompt",
      slotId: "slot-1",
      status: "pending",
    });

    expect((appState as any).batchId).toBe("batch-2");
    expect((appState as any).slots).toEqual([
      expect.objectContaining({ slotId: "slot-1", status: "pending" }),
    ]);
  });

  it("keeps distinct prompts together within one generation batch", async () => {
    await upsertVariantSlot({
      runId: "run-1",
      batchId: "batch-1",
      libraryId: "lib-1",
      prompt: "Hero image",
      slotId: "slot-1",
      status: "pending",
    });

    await upsertVariantSlot({
      runId: "run-2",
      batchId: "batch-1",
      libraryId: "lib-1",
      prompt: "Icon set",
      slotId: "slot-2",
      status: "pending",
    });

    expect((appState as any).slots.map((slot: any) => slot.slotId)).toEqual([
      "slot-1",
      "slot-2",
    ]);
  });

  it("starts fresh when generation options change within a scope", async () => {
    await upsertVariantSlot({
      runId: "run-1",
      batchId: "batch-1",
      libraryId: "lib-1",
      presetId: "preset-square",
      prompt: "Same prompt",
      slotId: "slot-1",
      status: "ready",
      assetId: "asset-1",
    });

    await upsertVariantSlot({
      runId: "run-2",
      batchId: "batch-1",
      libraryId: "lib-1",
      presetId: "preset-wide",
      prompt: "Same prompt",
      slotId: "slot-2",
      status: "pending",
    });

    expect((appState as any).presetId).toBe("preset-wide");
    expect((appState as any).slots).toEqual([
      expect.objectContaining({ slotId: "slot-2", status: "pending" }),
    ]);
  });
});
