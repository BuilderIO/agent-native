import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async (key: string) => store.get(key) ?? null),
  writeAppState: vi.fn(async (key: string, value: Record<string, unknown>) => {
    store.set(key, value);
  }),
  compareAndSetAppState: vi.fn(
    async (
      key: string,
      expected: Record<string, unknown> | null,
      next: Record<string, unknown> | null,
    ) => {
      const current = store.get(key) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      if (next === null) store.delete(key);
      else store.set(key, next);
      return true;
    },
  ),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));

import action from "./claim-ai-request";

const requestedAt = "2026-10-08T12:00:00.000Z";
const identity = {
  recordingId: "rec_1",
  kind: "remove-filler-words" as const,
  requestedAt,
};

function run(operation: "claim" | "consume" | "release", overrides = {}) {
  return action.run(
    action.schema.parse({ operation, ...identity, ...overrides }),
  );
}

describe("claim-ai-request", () => {
  beforeEach(() => {
    store.clear();
    store.set("clips-ai-request-rec_1", {
      kind: "remove-filler-words",
      recordingId: "rec_1",
      requestedAt,
    });
    store.set("clips-ai-request-status-rec_1", {
      kind: "remove-filler-words",
      status: "queued",
      requestedAt,
      updatedAt: requestedAt,
    });
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const results = await Promise.all([run("claim"), run("claim")]);
    expect(results.filter((r) => (r as { claimed: boolean }).claimed)).toEqual([
      { claimed: true },
    ]);
  });

  it("lets a claim through once the previous lease expired", async () => {
    store.set("clips-ai-request-rec_1", {
      ...store.get("clips-ai-request-rec_1"),
      claimedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(run("claim")).resolves.toEqual({ claimed: true });
  });

  it("does not claim a request that was replaced by a newer one", async () => {
    await expect(
      run("claim", { requestedAt: "2026-10-08T11:00:00.000Z" }),
    ).resolves.toEqual({ claimed: false, reason: "missing" });
  });

  it("leaves a newer request in place when consuming a stale one", async () => {
    await expect(
      run("consume", { requestedAt: "2026-10-08T11:00:00.000Z" }),
    ).resolves.toEqual({ consumed: false });
    expect(store.get("clips-ai-request-rec_1")).toMatchObject({ requestedAt });
  });

  it("removes the request and marks its status working on consume", async () => {
    await run("claim");
    await expect(run("consume")).resolves.toEqual({ consumed: true });
    expect(store.has("clips-ai-request-rec_1")).toBe(false);
    expect(store.get("clips-ai-request-status-rec_1")).toMatchObject({
      status: "working",
      requestedAt,
    });
  });

  it("drops a request that can never start and records why", async () => {
    await run("claim");
    await expect(
      run("fail", { message: "Connect an AI provider" }),
    ).resolves.toEqual({ failed: true });
    expect(store.has("clips-ai-request-rec_1")).toBe(false);
    expect(store.get("clips-ai-request-status-rec_1")).toMatchObject({
      status: "failed",
      message: "Connect an AI provider",
    });
  });

  it("releases a claim so another tab can start the request", async () => {
    await run("claim");
    await expect(run("release")).resolves.toEqual({ released: true });
    await expect(run("claim")).resolves.toEqual({ claimed: true });
  });
});
