import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTransactionalEmailStore } from "./transactional-email-store";

const roots: string[] = [];

async function testRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-email-store-"));
  roots.push(root);
  return root;
}

function filenameFor(logicalKey: string): string {
  return `${createHash("sha256").update(logicalKey).digest("hex")}.json`;
}

const firstViewPayload = {
  type: "first-view" as const,
  recipient: "viewer@example.com",
  recordingIds: ["recording-1"],
  shareId: "share-1",
  requestedBy: "owner@example.com",
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("transactional email store", () => {
  it("uses exclusive creation to make enqueue idempotent", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({ root });

    const results = await Promise.all([
      store.enqueue("first-view:share-1", firstViewPayload),
      store.enqueue("first-view:share-1", firstViewPayload),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].job).toEqual(results[1].job);
    expect(await store.listJobs()).toHaveLength(1);
    expect(
      await readFile(
        path.join(root, "jobs", filenameFor("first-view:share-1")),
        "utf8",
      ),
    ).toContain("first-view:share-1");
  });

  it("never exposes an interrupted initial publication as a final job", async () => {
    const root = await testRoot();
    const interruptedStore = createTransactionalEmailStore({
      root,
      testHooks: {
        afterInitialJobTempSynced: async () => {
          throw new Error("simulated publication interruption");
        },
      },
    });

    await expect(
      interruptedStore.enqueue("first-view:share-1", firstViewPayload),
    ).rejects.toThrow("simulated publication interruption");
    await expect(interruptedStore.listJobs()).resolves.toEqual([]);
    expect(await readdir(path.join(root, "jobs"))).toEqual([]);

    const recoveredStore = createTransactionalEmailStore({ root });
    await expect(
      recoveredStore.enqueue("first-view:share-1", firstViewPayload),
    ).resolves.toMatchObject({ created: true });
    await expect(recoveredStore.listJobs()).resolves.toHaveLength(1);
  });

  it("validates payload shape and never accepts transcript excerpts", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({ root });

    await expect(
      store.enqueue("two-clips:owner", {
        type: "two-clips",
        recipient: "owner@example.com",
        recordingIds: ["recording-1"],
      }),
    ).rejects.toThrow();

    await expect(
      store.enqueue("first-import:owner@example.com", {
        type: "first-import",
        recipient: "owner@example.com",
        recordingIds: ["recording-1", "recording-2"],
      }),
    ).rejects.toThrow();

    await expect(
      store.enqueue("first-view:transcript", {
        ...firstViewPayload,
        transcriptExcerpt: "This must not be persisted",
      } as typeof firstViewPayload),
    ).rejects.toThrow();
    expect(await store.listJobs()).toEqual([]);
  });

  it("rejects corrupted and schema-invalid job files", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({ root });
    await store.enqueue("first-view:share-1", firstViewPayload);
    const file = path.join(root, "jobs", filenameFor("first-view:share-1"));

    await writeFile(file, "{not-json", "utf8");
    await expect(store.readJob("first-view:share-1")).rejects.toThrow(
      "Invalid transactional email job JSON",
    );

    await writeFile(
      file,
      JSON.stringify({ logicalKey: "first-view:share-1", state: "unknown" }),
      "utf8",
    );
    await expect(store.listJobs()).rejects.toThrow(
      "Invalid transactional email job",
    );
  });

  it("allows only explicit state transitions and atomically claims AI work", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({ root });
    await store.enqueue("first-view:share-1", firstViewPayload, "awaiting_ai");

    await expect(
      store.transition("first-view:share-1", ["awaiting_ai"], "sent"),
    ).rejects.toThrow("Invalid transactional email transition");

    const [firstClaim, secondClaim] = await Promise.all([
      store.claimNextAwaitingAi(),
      store.claimNextAwaitingAi(),
    ]);
    expect([firstClaim, secondClaim].filter(Boolean)).toHaveLength(1);
    expect((firstClaim ?? secondClaim)?.state).toBe("ai_dispatched");

    const ready = await store.transition(
      "first-view:share-1",
      ["ai_dispatched"],
      "ready",
      { generatedSummary: "A concise generated summary." },
    );
    expect(ready).toMatchObject({
      state: "ready",
      generatedSummary: "A concise generated summary.",
      leaseUntil: null,
    });
    expect(ready?.readyAt).toBeTruthy();
    await expect(
      store.transition("first-view:share-1", ["pending"], "cancelled"),
    ).resolves.toBeNull();
  });

  it("allows one claimant-scoped AI completion without reclaiming", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({ root });
    await store.enqueue(
      "two-clips:recipient@example.com",
      {
        type: "two-clips",
        recipient: "recipient@example.com",
        recordingIds: ["recording-1", "recording-2"],
        requestedBy: "sender@example.com",
      },
      "awaiting_ai",
    );

    await expect(
      store.claimAwaitingAi(
        "two-clips:recipient@example.com",
        "claimant@example.com",
      ),
    ).resolves.toMatchObject({
      state: "ai_dispatched",
      aiClaimedBy: "claimant@example.com",
    });
    await expect(
      store.claimAwaitingAi(
        "two-clips:recipient@example.com",
        "other@example.com",
      ),
    ).resolves.toBeNull();
    await expect(
      store.completeClaimedAi(
        "two-clips:recipient@example.com",
        "other@example.com",
        "One sentence.",
      ),
    ).resolves.toBeNull();
    await expect(
      store.completeClaimedAi(
        "two-clips:recipient@example.com",
        "claimant@example.com",
        "One sentence.",
      ),
    ).resolves.toMatchObject({
      state: "ready",
      generatedSummary: "One sentence.",
    });
  });

  it("reclaims only stale AI dispatches", async () => {
    const root = await testRoot();
    let currentTime = new Date("2026-08-01T12:00:00.000Z");
    const store = createTransactionalEmailStore({
      root,
      now: () => currentTime,
    });
    const logicalKey = "two-clips:recipient@example.com";
    await store.enqueue(
      logicalKey,
      {
        type: "two-clips",
        recipient: "recipient@example.com",
        recordingIds: ["recording-1", "recording-2"],
        requestedBy: "sender@example.com",
      },
      "awaiting_ai",
    );
    await store.claimAwaitingAi(logicalKey, "first@example.com");

    await expect(
      store.reclaimStaleAiDispatch(
        logicalKey,
        "second@example.com",
        new Date("2026-08-01T11:59:59.999Z"),
      ),
    ).resolves.toBeNull();

    currentTime = new Date("2026-08-01T12:30:00.000Z");
    await expect(
      store.reclaimStaleAiDispatch(
        logicalKey,
        "second@example.com",
        new Date("2026-08-01T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ai_dispatched",
      aiClaimedBy: "second@example.com",
      aiDispatchedAt: "2026-08-01T12:30:00.000Z",
    });
  });

  it("acquires a sending lease and reclaims only expired leases", async () => {
    const root = await testRoot();
    let currentTime = new Date("2026-08-01T12:00:00.000Z");
    const store = createTransactionalEmailStore({
      root,
      now: () => currentTime,
    });
    await store.enqueue("first-view:share-1", firstViewPayload);
    await store.transition("first-view:share-1", ["pending"], "ready");

    const firstLease = await store.acquireSendingLease(
      "first-view:share-1",
      60_000,
    );
    expect(firstLease).toMatchObject({
      state: "sending",
      attempts: 1,
      leaseUntil: "2026-08-01T12:01:00.000Z",
      leaseToken: expect.any(String),
    });
    const firstLeaseToken = firstLease?.leaseToken;
    expect(firstLeaseToken).toBeTruthy();

    currentTime = new Date("2026-08-01T12:00:59.999Z");
    await expect(
      store.acquireSendingLease("first-view:share-1", 60_000),
    ).resolves.toBeNull();

    currentTime = new Date("2026-08-01T12:01:00.000Z");
    const reclaimed = await store.acquireSendingLease(
      "first-view:share-1",
      30_000,
    );
    expect(reclaimed).toMatchObject({
      state: "sending",
      attempts: 2,
      leaseUntil: "2026-08-01T12:01:30.000Z",
      leaseToken: expect.any(String),
    });
    const reclaimedLeaseToken = reclaimed?.leaseToken;
    expect(reclaimedLeaseToken).toBeTruthy();
    expect(reclaimedLeaseToken).not.toBe(firstLeaseToken);

    await expect(
      store.transition("first-view:share-1", ["sending"], "sent"),
    ).resolves.toBeNull();
    for (const nextState of ["sent", "ready", "failed", "cancelled"] as const) {
      await expect(
        store.transitionSending(
          "first-view:share-1",
          firstLeaseToken!,
          nextState,
          nextState === "failed" ? { lastError: "stale failure" } : {},
        ),
      ).resolves.toBeNull();
    }
    await expect(store.readJob("first-view:share-1")).resolves.toMatchObject({
      state: "sending",
      leaseToken: reclaimedLeaseToken,
    });

    const sent = await store.transitionSending(
      "first-view:share-1",
      reclaimedLeaseToken!,
      "sent",
    );
    expect(sent).toMatchObject({
      state: "sent",
      leaseUntil: null,
      leaseToken: null,
    });
    expect(sent?.sentAt).toBe("2026-08-01T12:01:00.000Z");
  });

  it("recovers a stale filesystem lock after a crashed writer", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({ root });
    await store.enqueue("first-view:share-1", firstViewPayload);
    const locksDirectory = path.join(root, "locks");
    await mkdir(locksDirectory, { recursive: true });
    const lock = path.join(
      locksDirectory,
      `${createHash("sha256").update("first-view:share-1").digest("hex")}.lock`,
    );
    await writeFile(lock, "", "utf8");
    const staleTime = new Date(Date.now() - 31_000);
    await utimes(lock, staleTime, staleTime);

    await expect(
      store.transition("first-view:share-1", ["pending"], "ready"),
    ).resolves.toMatchObject({ state: "ready" });
  });

  it("recovers a stale takeover marker after a crashed reclaimer", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({ root });
    await store.enqueue("first-view:share-1", firstViewPayload);
    const locksDirectory = path.join(root, "locks");
    const lock = path.join(
      locksDirectory,
      `${createHash("sha256").update("first-view:share-1").digest("hex")}.lock`,
    );
    const takeover = `${lock}.takeover`;
    await writeFile(takeover, "crashed reclaimer", "utf8");
    const staleTime = new Date(Date.now() - 31_000);
    await utimes(takeover, staleTime, staleTime);

    await expect(
      store.transition("first-view:share-1", ["pending"], "ready"),
    ).resolves.toMatchObject({ state: "ready" });
    expect(await readdir(locksDirectory)).toEqual([]);
  });

  it("allows only one of two stale-lock reclaimers to enter", async () => {
    const root = await testRoot();
    const setupStore = createTransactionalEmailStore({ root });
    await setupStore.enqueue("first-view:share-1", firstViewPayload);
    const locksDirectory = path.join(root, "locks");
    await mkdir(locksDirectory, { recursive: true });
    const lock = path.join(
      locksDirectory,
      `${createHash("sha256").update("first-view:share-1").digest("hex")}.lock`,
    );
    await writeFile(lock, "stale owner", "utf8");
    const staleTime = new Date(Date.now() - 31_000);
    await utimes(lock, staleTime, staleTime);

    let releaseFirstSnapshot: (() => void) | undefined;
    const firstSnapshotPaused = new Promise<void>((resolve) => {
      releaseFirstSnapshot = resolve;
    });
    let firstSawStaleLock: (() => void) | undefined;
    const firstSawStaleLockPromise = new Promise<void>((resolve) => {
      firstSawStaleLock = resolve;
    });
    let entered = 0;
    const firstStore = createTransactionalEmailStore({
      root,
      testHooks: {
        afterStaleLockSnapshot: async () => {
          firstSawStaleLock?.();
          await firstSnapshotPaused;
        },
        afterJobLockAcquired: async () => {
          entered += 1;
        },
      },
    });
    const secondStore = createTransactionalEmailStore({
      root,
      testHooks: {
        afterJobLockAcquired: async () => {
          entered += 1;
        },
      },
    });

    const first = firstStore.transition(
      "first-view:share-1",
      ["pending"],
      "ready",
    );
    await firstSawStaleLockPromise;
    const second = await secondStore.transition(
      "first-view:share-1",
      ["pending"],
      "ready",
    );
    releaseFirstSnapshot?.();

    await expect(first).resolves.toMatchObject({ state: "ready" });
    expect(second).toBeNull();
    expect(entered).toBe(1);
    expect(await readdir(locksDirectory)).toEqual([]);
  });

  it("releases a held lock after a fresh contender exits", async () => {
    const root = await testRoot();
    const setupStore = createTransactionalEmailStore({ root });
    await setupStore.enqueue("first-view:share-1", firstViewPayload);

    let releaseHolder: (() => void) | undefined;
    const holderPaused = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    let holderAcquired: (() => void) | undefined;
    const holderAcquiredPromise = new Promise<void>((resolve) => {
      holderAcquired = resolve;
    });
    const holderStore = createTransactionalEmailStore({
      root,
      testHooks: {
        afterJobLockAcquired: async () => {
          holderAcquired?.();
          await holderPaused;
        },
      },
    });

    let releaseContender: (() => void) | undefined;
    const contenderPaused = new Promise<void>((resolve) => {
      releaseContender = resolve;
    });
    let freshContention: (() => void) | undefined;
    const freshContentionPromise = new Promise<void>((resolve) => {
      freshContention = resolve;
    });
    const contenderStore = createTransactionalEmailStore({
      root,
      testHooks: {
        afterFreshLockContention: async () => {
          freshContention?.();
          await contenderPaused;
        },
      },
    });

    const holder = holderStore.transition(
      "first-view:share-1",
      ["pending"],
      "ready",
    );
    await holderAcquiredPromise;
    const contender = contenderStore.transition(
      "first-view:share-1",
      ["pending"],
      "ready",
    );
    await freshContentionPromise;

    releaseHolder?.();
    await expect(holder).resolves.toMatchObject({ state: "ready" });
    releaseContender?.();
    await expect(contender).resolves.toBeNull();
    await expect(
      setupStore.transition("first-view:share-1", ["ready"], "cancelled"),
    ).resolves.toMatchObject({ state: "cancelled" });
  });

  it("does not release a replacement lock owned by a stale reclaimer", async () => {
    const root = await testRoot();
    const setupStore = createTransactionalEmailStore({ root });
    await setupStore.enqueue("first-view:share-1", firstViewPayload);
    const lock = path.join(
      root,
      "locks",
      `${createHash("sha256").update("first-view:share-1").digest("hex")}.lock`,
    );

    let releaseOriginal: (() => void) | undefined;
    const originalPaused = new Promise<void>((resolve) => {
      releaseOriginal = resolve;
    });
    let originalAcquired: (() => void) | undefined;
    const originalAcquiredPromise = new Promise<void>((resolve) => {
      originalAcquired = resolve;
    });
    const originalStore = createTransactionalEmailStore({
      root,
      testHooks: {
        afterJobLockAcquired: async () => {
          originalAcquired?.();
          await originalPaused;
        },
      },
    });
    const original = originalStore.transition(
      "first-view:share-1",
      ["pending"],
      "ready",
    );
    await originalAcquiredPromise;
    const staleTime = new Date(Date.now() - 31_000);
    await utimes(lock, staleTime, staleTime);

    let releaseReplacement: (() => void) | undefined;
    const replacementPaused = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    let replacementAcquired: (() => void) | undefined;
    const replacementAcquiredPromise = new Promise<void>((resolve) => {
      replacementAcquired = resolve;
    });
    const replacementStore = createTransactionalEmailStore({
      root,
      testHooks: {
        afterJobLockAcquired: async () => {
          replacementAcquired?.();
          await replacementPaused;
        },
      },
    });
    const replacement = replacementStore.transition(
      "first-view:share-1",
      ["pending"],
      "ready",
    );
    await replacementAcquiredPromise;

    releaseOriginal?.();
    await expect(original).resolves.toBeNull();
    await expect(
      setupStore.transition("first-view:share-1", ["pending"], "cancelled"),
    ).resolves.toBeNull();

    releaseReplacement?.();
    await expect(replacement).resolves.toMatchObject({ state: "ready" });
  });

  it("creates enabledAt exclusively and preserves the first timestamp", async () => {
    const root = await testRoot();
    const firstStore = createTransactionalEmailStore({
      root,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });
    const laterStore = createTransactionalEmailStore({
      root,
      now: () => new Date("2026-08-02T11:00:00.000Z"),
    });

    const [first, second] = await Promise.all([
      firstStore.ensureEnabledAt(),
      laterStore.ensureEnabledAt(),
    ]);

    expect(first).toEqual(second);
    expect(await laterStore.ensureEnabledAt()).toEqual(first);
    expect(await firstStore.readConfig()).toEqual(first);
  });

  it("converges an unsent first-import job on the canonical recording", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({ root });
    await store.enqueue("first-import:owner@example.com", {
      type: "first-import",
      recipient: "owner@example.com",
      recordingIds: ["recording-newer"],
      requestedBy: "owner@example.com",
    });
    await store.transition(
      "first-import:owner@example.com",
      ["pending"],
      "cancelled",
    );

    const converged = await store.enqueueOrConvergeFirstImport(
      "owner@example.com",
      "recording-older",
      "owner@example.com",
    );

    expect(converged).toMatchObject({
      created: false,
      job: {
        state: "pending",
        recordingIds: ["recording-older"],
        attempts: 0,
        cancelledAt: undefined,
      },
    });
  });

  it("validates and atomically persists the reconciliation cursor", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({
      root,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });
    await store.ensureEnabledAt();

    await expect(
      store.updateReconciliationCursor("reminderCursor", {
        createdAt: "2026-08-03T10:00:00.000Z",
        id: "share-100",
      }),
    ).resolves.toEqual({
      enabledAt: "2026-08-02T10:00:00.000Z",
      reminderCursor: {
        createdAt: "2026-08-03T10:00:00.000Z",
        id: "share-100",
      },
    });

    await expect(
      store.updateReconciliationCursor("reminderCursor", {
        createdAt: "invalid",
        id: "",
      }),
    ).rejects.toThrow();
    expect(await store.readConfig()).toEqual({
      enabledAt: "2026-08-02T10:00:00.000Z",
      reminderCursor: {
        createdAt: "2026-08-03T10:00:00.000Z",
        id: "share-100",
      },
    });
  });

  it("rejects corrupted enabledAt configuration instead of replacing it", async () => {
    const root = await testRoot();
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "config.json"), "{}", "utf8");
    const store = createTransactionalEmailStore({ root });

    await expect(store.ensureEnabledAt()).rejects.toThrow(
      "Invalid transactional email config",
    );
    expect(await readFile(path.join(root, "config.json"), "utf8")).toBe("{}");
  });
});
