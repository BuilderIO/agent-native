import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
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
      store.claimAwaitingAi("first-view:share-1", "viewer@example.com"),
      store.claimAwaitingAi("first-view:share-1", "viewer@example.com"),
    ]);
    expect([firstClaim, secondClaim].filter(Boolean)).toHaveLength(1);
    expect(firstClaim ?? secondClaim).toMatchObject({
      state: "ai_dispatched",
      aiClaimedBy: "viewer@example.com",
    });

    await expect(
      store.completeClaimedAi(
        "first-view:share-1",
        "other@example.com",
        "Wrong claimant.",
      ),
    ).resolves.toBeNull();
    const ready = await store.completeClaimedAi(
      "first-view:share-1",
      "VIEWER@example.com",
      "A concise generated summary.",
    );
    expect(ready).toMatchObject({
      state: "ready",
      aiClaimedBy: "viewer@example.com",
      generatedSummary: "A concise generated summary.",
      leaseUntil: null,
    });
    expect(ready?.readyAt).toBeTruthy();
    await expect(
      store.transition("first-view:share-1", ["pending"], "cancelled"),
    ).resolves.toBeNull();
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
    });

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
    });

    const sent = await store.transition(
      "first-view:share-1",
      ["sending"],
      "sent",
    );
    expect(sent).toMatchObject({ state: "sent", leaseUntil: null });
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

  it("validates and atomically persists the reconciliation cursor", async () => {
    const root = await testRoot();
    const store = createTransactionalEmailStore({
      root,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });
    await store.ensureEnabledAt();

    await expect(
      store.updateReconciliationCursor({
        createdAt: "2026-08-03T10:00:00.000Z",
        id: "share-100",
      }),
    ).resolves.toEqual({
      enabledAt: "2026-08-02T10:00:00.000Z",
      reconciliationCursor: {
        createdAt: "2026-08-03T10:00:00.000Z",
        id: "share-100",
      },
    });

    await expect(
      store.updateReconciliationCursor({ createdAt: "invalid", id: "" }),
    ).rejects.toThrow();
    expect(await store.readConfig()).toEqual({
      enabledAt: "2026-08-02T10:00:00.000Z",
      reconciliationCursor: {
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
