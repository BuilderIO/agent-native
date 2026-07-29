import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTransactionalEmailStore } from "../lib/transactional-email-store.js";
import {
  runTransactionalEmailsOnce,
  type TransactionalEmailRepository,
} from "./transactional-emails.js";

type Share = Awaited<
  ReturnType<TransactionalEmailRepository["listDirectShares"]>
>[number];
type Recording = NonNullable<
  Awaited<ReturnType<TransactionalEmailRepository["getRecording"]>>
>;

const roots: string[] = [];

async function testRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-email-worker-"));
  roots.push(root);
  return root;
}

function recording(id: string, ownerEmail = "sender@example.com"): Recording {
  return {
    id,
    organizationId: "org-1",
    ownerEmail,
    title: `Clip ${id}`,
    titleSource: "default",
    sourceAppName: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    status: "ready",
    archivedAt: null,
    trashedAt: null,
  };
}

function createRepository(state: {
  shares: Share[];
  recordings: Map<string, Recording>;
  owners?: Set<string>;
  viewed?: Set<string>;
  countedViews?: Map<string, Array<string | null>>;
  imports?: Recording[];
  displayNames?: Map<string, string>;
  brandLogoUrls?: Map<string, string>;
}): TransactionalEmailRepository {
  const recipientKey = (recipient: string, recordingId: string) =>
    `${recipient.toLowerCase()}:${recordingId}`;
  return {
    async listDirectShares(enabledAt, cursor, limit) {
      return state.shares
        .filter(
          (share) =>
            Date.parse(share.createdAt) >= Date.parse(enabledAt) &&
            (!cursor ||
              share.createdAt > cursor.createdAt ||
              (share.createdAt === cursor.createdAt && share.id > cursor.id)),
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit);
    },
    async listDueDirectShares(enabledAt, dueBefore, cursor, limit) {
      return state.shares
        .filter(
          (share) =>
            share.createdAt >= enabledAt &&
            share.createdAt <= dueBefore &&
            (!cursor ||
              share.createdAt > cursor.createdAt ||
              (share.createdAt === cursor.createdAt && share.id > cursor.id)),
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit);
    },
    async listRecipientDistinctShares(recipient, enabledAt, limit) {
      const seen = new Set<string>();
      return state.shares
        .filter(
          (share) =>
            share.recipient.trim().toLowerCase() === recipient &&
            Date.parse(share.createdAt) >= Date.parse(enabledAt),
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .filter((share) => {
          if (seen.has(share.recordingId)) return false;
          seen.add(share.recordingId);
          return true;
        })
        .slice(0, limit);
    },
    async listCountedNonOwnerViews(enabledAt, cursor, limit) {
      const countedViews: Map<
        string,
        Array<string | null>
      > = state.countedViews ?? new Map();
      const views = [...countedViews.entries()].flatMap(
        ([recordingId, emails]) => {
          const clip = state.recordings.get(recordingId);
          if (!clip) return [];
          return emails.map((viewerEmail, index) => ({
            id: `view-${recordingId}-${String(index).padStart(3, "0")}`,
            viewedAt: new Date(
              Date.parse(enabledAt) + index * 1000,
            ).toISOString(),
            viewerEmail,
            recordingId,
            ownerEmail: clip.ownerEmail,
          }));
        },
      );
      return views
        .filter(
          (view) =>
            (view.viewerEmail === null ||
              view.viewerEmail.trim().toLowerCase() !==
                view.ownerEmail.trim().toLowerCase()) &&
            (!cursor ||
              view.viewedAt > cursor.createdAt ||
              (view.viewedAt === cursor.createdAt && view.id > cursor.id)),
        )
        .sort(
          (left, right) =>
            left.viewedAt.localeCompare(right.viewedAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit);
    },
    async listReadyImports(enabledAt, cursor, limit) {
      return (state.imports ?? [...state.recordings.values()])
        .filter(
          (candidate) =>
            candidate.status === "ready" &&
            candidate.createdAt >= enabledAt &&
            (candidate.sourceAppName === "Loom" ||
              candidate.sourceAppName === "Video link") &&
            (!cursor ||
              candidate.createdAt > cursor.createdAt ||
              (candidate.createdAt === cursor.createdAt &&
                candidate.id > cursor.id)),
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit);
    },
    async getRecording(recordingId) {
      return state.recordings.get(recordingId) ?? null;
    },
    async getUserDisplayName(email) {
      return state.displayNames?.get(email) ?? null;
    },
    async getOrganizationBrandLogoUrl(organizationId) {
      return state.brandLogoUrls?.get(organizationId) ?? null;
    },
    async recipientOwnsRecording(recipient) {
      return state.owners?.has(recipient) ?? false;
    },
    async recipientHasShare(recipient, recordingId, shareId) {
      return state.shares.some(
        (share) =>
          share.id === shareId &&
          share.recordingId === recordingId &&
          share.recipient.trim().toLowerCase() === recipient,
      );
    },
    async recipientHasShares(recipient, recordingIds) {
      return recordingIds.every((recordingId) =>
        state.shares.some(
          (share) =>
            share.recordingId === recordingId &&
            share.recipient.trim().toLowerCase() === recipient,
        ),
      );
    },
    async recipientHasCountedView(recipient, recordingId) {
      return state.viewed?.has(recipientKey(recipient, recordingId)) ?? false;
    },
    async getFirstNonOwnerCountedView(recordingId, ownerEmail) {
      const views = state.countedViews?.get(recordingId) ?? [];
      const index = views.findIndex(
        (email) =>
          email === null ||
          email.trim().toLowerCase() !== ownerEmail.trim().toLowerCase(),
      );
      return index < 0
        ? null
        : {
            id: `view-${recordingId}-${String(index).padStart(3, "0")}`,
            viewedAt: new Date(
              Date.parse("2026-08-01T00:00:00.000Z") + index * 1000,
            ).toISOString(),
            viewerEmail: views[index],
          };
    },
    async isFirstImport(candidate, recipient, enabledAt) {
      const firstImport = (state.imports ?? [candidate])
        .filter(
          (recording) =>
            recording.ownerEmail.toLowerCase() === recipient &&
            recording.createdAt >= enabledAt &&
            recording.status === "ready" &&
            (recording.sourceAppName === "Loom" ||
              recording.sourceAppName === "Video link"),
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )[0];
      return firstImport?.id === candidate.id;
    },
  };
}

async function setup(enabledAt = "2026-08-01T00:00:00.000Z") {
  let currentTime = new Date(enabledAt);
  const store = createTransactionalEmailStore({
    root: await testRoot(),
    now: () => currentTime,
  });
  await store.ensureEnabledAt();
  return {
    store,
    now: () => currentTime,
    setNow(value: string) {
      currentTime = new Date(value);
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("transactional email worker", () => {
  it("enqueues two-clips on the second distinct Clip and suppresses duplicate recordings", async () => {
    const clock = await setup();
    clock.setNow("2026-08-01T01:00:00.000Z");
    const repository = createRepository({
      shares: [
        {
          id: "share-1",
          recordingId: "recording-1",
          recipient: " Person@Example.com ",
          createdBy: "first-sender@example.com",
          createdAt: "2026-08-01T00:10:00.000Z",
        },
        {
          id: "share-duplicate",
          recordingId: "recording-1",
          recipient: "person@example.com",
          createdBy: "duplicate-sender@example.com",
          createdAt: "2026-08-01T00:20:00.000Z",
        },
        {
          id: "share-2",
          recordingId: "recording-2",
          recipient: "person@example.com",
          createdBy: "second-sender@example.com",
          createdAt: "2026-08-01T00:30:00.000Z",
        },
      ],
      recordings: new Map([
        ["recording-1", recording("recording-1")],
        ["recording-2", recording("recording-2")],
      ]),
    });

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("two-clips:person@example.com"),
    ).toMatchObject({
      state: "awaiting_ai",
      recordingIds: ["recording-1", "recording-2"],
      shareId: "share-2",
      requestedBy: "second-sender@example.com",
    });
    expect(
      (await clock.store.listJobs()).filter((job) => job.type === "two-clips"),
    ).toHaveLength(1);
  });

  it("does not enqueue two-clips when the recipient already creates recordings", async () => {
    const clock = await setup();
    clock.setNow("2026-08-01T01:00:00.000Z");
    const recipient = "creator@example.com";
    const shares: Share[] = ["1", "2"].map((suffix, index) => ({
      id: `share-${suffix}`,
      recordingId: `recording-${suffix}`,
      recipient,
      createdBy: "sender@example.com",
      createdAt: `2026-08-01T00:${index + 1}0:00.000Z`,
    }));

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({
        shares,
        recordings: new Map(),
        owners: new Set([recipient]),
      }),
      now: clock.now,
      emailConfigured: async () => false,
    });

    expect(await clock.store.readJob(`two-clips:${recipient}`)).toBeNull();
  });

  it("enqueues reminders at exactly 48 hours and suppresses reserved recipients", async () => {
    const clock = await setup();
    clock.setNow("2026-08-03T00:00:00.000Z");
    const shares: Share[] = [
      {
        id: "boundary",
        recordingId: "recording-1",
        recipient: "person@example.com",
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "too-new",
        recordingId: "recording-2",
        recipient: "other@example.com",
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T00:00:00.001Z",
      },
      {
        id: "local",
        recordingId: "recording-3",
        recipient: "local@localhost",
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "qa",
        recordingId: "recording-4",
        recipient: "runner+qa-lane@subdomain.test",
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ];

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({ shares, recordings: new Map() }),
      now: clock.now,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("unviewed-reminder:boundary"),
    ).toMatchObject({ state: "ready", recipient: "person@example.com" });
    expect(await clock.store.readJob("unviewed-reminder:too-new")).toBeNull();
    expect(await clock.store.readJob("unviewed-reminder:local")).toBeNull();
    expect(await clock.store.readJob("unviewed-reminder:qa")).toBeNull();
  });

  it("resolves the reminder originator profile and organization logo", async () => {
    const clock = await setup();
    clock.setNow("2026-08-03T00:00:00.000Z");
    const share: Share = {
      id: "branded-reminder",
      recordingId: "recording-1",
      recipient: "person@example.com",
      createdBy: "sender@example.com",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const send = vi.fn().mockResolvedValue(undefined);

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({
        shares: [share],
        recordings: new Map([
          ["recording-1", recording("recording-1", "sender@example.com")],
        ]),
        displayNames: new Map([["sender@example.com", "Alex Rivera"]]),
        brandLogoUrls: new Map([["org-1", "/clips/api/media/org-logo.png"]]),
      }),
      now: clock.now,
      emailConfigured: async () => true,
      send,
    });

    expect(send).toHaveBeenCalledWith({
      kind: "unviewed-reminder",
      to: "person@example.com",
      recordingId: "recording-1",
      title: "Clip recording-1",
      senderEmail: "sender@example.com",
      senderName: "Alex Rivera",
      brandLogoUrl: "/clips/api/media/org-logo.png",
    });
    expect(
      await clock.store.readJob("unviewed-reminder:branded-reminder"),
    ).toMatchObject({ state: "sent" });
  });

  it("skips malformed share recipients without wedging the due cursor", async () => {
    const clock = await setup();
    clock.setNow("2026-08-03T00:00:01.000Z");
    const shares: Share[] = [
      {
        id: "share-malformed",
        recordingId: "recording-malformed",
        recipient: "bob@localhost",
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "share-valid",
        recordingId: "recording-valid",
        recipient: "valid@example.com",
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T00:00:01.000Z",
      },
    ];

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({ shares, recordings: new Map() }),
      now: clock.now,
      reconciliationBatchSize: 2,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("unviewed-reminder:share-malformed"),
    ).toBeNull();
    expect(
      await clock.store.readJob("unviewed-reminder:share-valid"),
    ).toMatchObject({ state: "ready", recipient: "valid@example.com" });
    expect(await clock.store.readConfig()).toMatchObject({
      reminderCursor: {
        createdAt: "2026-08-01T00:00:01.000Z",
        id: "share-valid",
      },
    });
  });

  it.each(["viewed", "unshared", "trashed"] as const)(
    "cancels a stale reminder when the Clip is %s",
    async (reason) => {
      const clock = await setup();
      const recipient = "person@example.com";
      const share: Share = {
        id: `share-${reason}`,
        recordingId: "recording-1",
        recipient,
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      };
      const state = {
        shares: [share],
        recordings: new Map([
          [
            "recording-1",
            {
              ...recording("recording-1"),
              trashedAt:
                reason === "trashed" ? "2026-08-02T00:00:00.000Z" : null,
            },
          ],
        ]),
        viewed: new Set<string>(),
      };
      if (reason === "viewed") {
        state.viewed.add(`${recipient}:recording-1`);
      }
      clock.setNow("2026-08-03T00:00:00.000Z");
      await runTransactionalEmailsOnce({
        store: clock.store,
        repository: createRepository(state),
        now: clock.now,
        emailConfigured: async () => false,
      });
      if (reason === "unshared") {
        state.shares[0] = { ...share, id: "replacement-share" };
      }

      await runTransactionalEmailsOnce({
        store: clock.store,
        repository: createRepository(state),
        now: clock.now,
        emailConfigured: async () => true,
        send: vi.fn(),
      });

      expect(
        await clock.store.readJob(`unviewed-reminder:share-${reason}`),
      ).toMatchObject({ state: "cancelled" });
    },
  );

  it("preserves enabledAt as a no-backfill boundary", async () => {
    const clock = await setup("2026-08-02T00:00:00.000Z");
    clock.setNow("2026-08-04T00:00:00.000Z");
    const shares: Share[] = [
      {
        id: "before-enabled",
        recordingId: "recording-1",
        recipient: "old@example.com",
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T23:59:59.999Z",
      },
      {
        id: "at-enabled",
        recordingId: "recording-2",
        recipient: "new@example.com",
        createdBy: "sender@example.com",
        createdAt: "2026-08-02T00:00:00.000Z",
      },
    ];

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({ shares, recordings: new Map() }),
      now: clock.now,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("unviewed-reminder:before-enabled"),
    ).toBeNull();
    expect(
      await clock.store.readJob("unviewed-reminder:at-enabled"),
    ).toBeTruthy();
  });

  it("names the earliest counted non-owner view when an owner self-view came first", async () => {
    const clock = await setup();
    const ownerEmail = "owner@example.com";
    const clip = recording("recording-1", ownerEmail);
    const send = vi.fn();
    await clock.store.enqueue("first-view:recording-1", {
      type: "first-view",
      recipient: ownerEmail,
      recordingIds: [clip.id],
      requestedBy: ownerEmail,
    });

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({
        shares: [],
        recordings: new Map([[clip.id, clip]]),
        countedViews: new Map([
          [clip.id, ["Owner@Example.com", "external@example.com"]],
        ]),
      }),
      now: clock.now,
      emailConfigured: async () => true,
      send,
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "first-view",
        to: ownerEmail,
        viewerEmail: "external@example.com",
      }),
    );
  });

  it.each(["archived", "trashed"] as const)(
    "does not shift first-import identity when the older import is %s",
    async (historicalState) => {
      const clock = await setup();
      const ownerEmail = "owner@example.com";
      const older = {
        ...recording("import-older", ownerEmail),
        sourceAppName: "Loom",
        archivedAt:
          historicalState === "archived" ? "2026-08-02T00:00:00.000Z" : null,
        trashedAt:
          historicalState === "trashed" ? "2026-08-02T00:00:00.000Z" : null,
      };
      const newer = {
        ...recording("import-newer", ownerEmail),
        sourceAppName: "Video link",
        createdAt: "2026-08-01T00:01:00.000Z",
      };
      const send = vi.fn();
      await clock.store.enqueue("first-import:owner@example.com", {
        type: "first-import",
        recipient: ownerEmail,
        recordingIds: [newer.id],
        requestedBy: ownerEmail,
      });

      await runTransactionalEmailsOnce({
        store: clock.store,
        repository: createRepository({
          shares: [],
          recordings: new Map([[newer.id, newer]]),
          imports: [older, newer],
        }),
        now: clock.now,
        emailConfigured: async () => true,
        send,
      });

      expect(send).not.toHaveBeenCalled();
      expect(
        await clock.store.readJob("first-import:owner@example.com"),
      ).toMatchObject({ state: "cancelled" });
    },
  );

  it("finds the second distinct Clip after more than 100 duplicate shares", async () => {
    const clock = await setup();
    clock.setNow("2026-08-01T01:00:00.000Z");
    const duplicates: Share[] = Array.from({ length: 125 }, (_, index) => ({
      id: `duplicate-${String(index).padStart(3, "0")}`,
      recordingId: "recording-1",
      recipient: "person@example.com",
      createdBy: "first-sender@example.com",
      createdAt: new Date(
        Date.parse("2026-08-01T00:01:00.000Z") + index,
      ).toISOString(),
    }));
    const second: Share = {
      id: "second-distinct",
      recordingId: "recording-2",
      recipient: "person@example.com",
      createdBy: "second-sender@example.com",
      createdAt: "2026-08-01T00:02:00.000Z",
    };

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({
        shares: [...duplicates, second],
        recordings: new Map(),
      }),
      now: clock.now,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("two-clips:person@example.com"),
    ).toMatchObject({
      recordingIds: ["recording-1", "recording-2"],
      shareId: "second-distinct",
      requestedBy: "second-sender@example.com",
    });
  });

  it("discovers shares as they age while timely share pages keep arriving", async () => {
    const clock = await setup();
    const shares: Share[] = ["a", "b"].map((suffix, index) => ({
      id: `early-${suffix}`,
      recordingId: `recording-early-${suffix}`,
      recipient: `early-${suffix}@example.com`,
      createdBy: "sender@example.com",
      createdAt: `2026-08-01T00:0${index + 1}:00.000Z`,
    }));
    const repository = createRepository({ shares, recordings: new Map() });

    clock.setNow("2026-08-01T02:00:00.000Z");
    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      reconciliationBatchSize: 2,
      emailConfigured: async () => false,
    });
    shares.push(
      ...["a", "b"].map((suffix, index) => ({
        id: `middle-${suffix}`,
        recordingId: `recording-middle-${suffix}`,
        recipient: `middle-${suffix}@example.com`,
        createdBy: "sender@example.com",
        createdAt: `2026-08-01T02:0${index + 1}:00.000Z`,
      })),
    );

    clock.setNow("2026-08-03T00:02:00.000Z");
    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      reconciliationBatchSize: 2,
      emailConfigured: async () => false,
    });
    expect(await clock.store.readJob("unviewed-reminder:early-b")).toBeTruthy();
    expect(await clock.store.readJob("unviewed-reminder:middle-a")).toBeNull();

    shares.push({
      id: "latest",
      recordingId: "recording-latest",
      recipient: "latest@example.com",
      createdBy: "sender@example.com",
      createdAt: "2026-08-03T00:03:00.000Z",
    });
    clock.setNow("2026-08-03T02:02:00.000Z");
    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      reconciliationBatchSize: 2,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("unviewed-reminder:middle-a"),
    ).toBeTruthy();
    expect(
      await clock.store.readJob("unviewed-reminder:middle-b"),
    ).toBeTruthy();
    expect(await clock.store.readJob("unviewed-reminder:latest")).toBeNull();
  });

  it("recovers a missing first-view job after the immediate enqueue failed", async () => {
    const clock = await setup();
    const clip = recording("recording-recovery", "owner@example.com");
    const repository = createRepository({
      shares: [],
      recordings: new Map([[clip.id, clip]]),
      countedViews: new Map([[clip.id, ["viewer@example.com"]]]),
    });

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      emailConfigured: async () => false,
    });
    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      emailConfigured: async () => false,
    });

    expect(await clock.store.readJob(`first-view:${clip.id}`)).toMatchObject({
      state: "ready",
      recordingIds: [clip.id],
    });
    expect(
      (await clock.store.listJobs()).filter(
        (job) => job.logicalKey === `first-view:${clip.id}`,
      ),
    ).toHaveLength(1);
  });

  it("recovers a missing first-import job after the immediate enqueue failed", async () => {
    const clock = await setup();
    const imported = {
      ...recording("import-recovery", "owner@example.com"),
      sourceAppName: "Loom",
    };
    const repository = createRepository({
      shares: [],
      recordings: new Map([[imported.id, imported]]),
      imports: [imported],
    });

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      emailConfigured: async () => false,
    });
    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("first-import:owner@example.com"),
    ).toMatchObject({ state: "ready", recordingIds: [imported.id] });
    expect(
      (await clock.store.listJobs()).filter(
        (job) => job.logicalKey === "first-import:owner@example.com",
      ),
    ).toHaveLength(1);
  });

  it("converges reverse-completed imports on the canonical earliest recording", async () => {
    const clock = await setup();
    const ownerEmail = "owner@example.com";
    const older = {
      ...recording("import-older", ownerEmail),
      sourceAppName: "Loom",
    };
    const newer = {
      ...recording("import-newer", ownerEmail),
      sourceAppName: "Video link",
      createdAt: "2026-08-01T00:01:00.000Z",
    };
    await clock.store.enqueue("first-import:owner@example.com", {
      type: "first-import",
      recipient: ownerEmail,
      recordingIds: [newer.id],
      requestedBy: ownerEmail,
    });

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({
        shares: [],
        recordings: new Map([
          [older.id, older],
          [newer.id, newer],
        ]),
        imports: [newer, older],
      }),
      now: clock.now,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("first-import:owner@example.com"),
    ).toMatchObject({ state: "ready", recordingIds: [older.id] });
  });

  it("logs stale AI dispatches without retrying or reclaiming them", async () => {
    const clock = await setup();
    await clock.store.enqueue(
      "two-clips:person@example.com",
      {
        type: "two-clips",
        recipient: "person@example.com",
        recordingIds: ["recording-1", "recording-2"],
        requestedBy: "sender@example.com",
      },
      "awaiting_ai",
    );
    await clock.store.claimNextAwaitingAi();
    clock.setNow("2026-08-01T00:30:00.000Z");
    const warn = vi.fn();

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository: createRepository({ shares: [], recordings: new Map() }),
      now: clock.now,
      emailConfigured: async () => false,
      warn,
    });

    expect(warn).toHaveBeenCalledWith(
      "[transactional-emails] AI dispatch remains unresolved",
      expect.objectContaining({
        logicalKey: "two-clips:person@example.com",
      }),
    );
    expect(
      await clock.store.readJob("two-clips:person@example.com"),
    ).toMatchObject({ state: "ai_dispatched", attempts: 0 });
  });

  it("durably advances past a full direct-share batch and wraps safely", async () => {
    const clock = await setup();
    clock.setNow("2026-08-03T00:00:00.000Z");
    const shares: Share[] = Array.from({ length: 101 }, (_, index) => {
      const suffix = String(index + 1).padStart(3, "0");
      return {
        id: `share-${suffix}`,
        recordingId: `recording-${suffix}`,
        recipient: "person@example.com",
        createdBy: "sender@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      };
    });
    const repository = createRepository({ shares, recordings: new Map() });

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      reconciliationBatchSize: 100,
      emailConfigured: async () => false,
    });
    expect(await clock.store.readJob("unviewed-reminder:share-101")).toBeNull();
    const firstBatchReminders = (await clock.store.listJobs()).filter(
      (job) => job.type === "unviewed-reminder",
    );
    expect(firstBatchReminders).toHaveLength(100);
    expect(firstBatchReminders.every((job) => job.state === "ready")).toBe(
      true,
    );
    expect(await clock.store.readConfig()).toMatchObject({
      enabledAt: "2026-08-01T00:00:00.000Z",
      shareDiscoveryCursor: {
        createdAt: "2026-08-01T00:00:00.000Z",
        id: "share-100",
      },
    });

    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      reconciliationBatchSize: 100,
      emailConfigured: async () => false,
    });

    expect(
      await clock.store.readJob("unviewed-reminder:share-101"),
    ).toMatchObject({ state: "ready" });
    expect(await clock.store.readConfig()).toMatchObject({
      enabledAt: "2026-08-01T00:00:00.000Z",
      shareDiscoveryCursor: null,
      reminderCursor: null,
    });
  });

  it("cannot finalize a send with an old lease after another worker reclaims it", async () => {
    const clock = await setup();
    const imported = {
      ...recording("import-stale-lease", "owner@example.com"),
      sourceAppName: "Video link",
    };
    const repository = createRepository({
      shares: [],
      recordings: new Map([[imported.id, imported]]),
      imports: [imported],
    });
    await clock.store.enqueue("first-import:owner@example.com", {
      type: "first-import",
      recipient: "owner@example.com",
      recordingIds: [imported.id],
      requestedBy: "owner@example.com",
    });
    let reclaimedLeaseToken: string | null = null;
    const transitionSending = vi.fn(
      async (
        logicalKey: string,
        staleLeaseToken: string,
        nextState: "sent" | "ready" | "cancelled" | "failed",
        changes?: { lastError?: string | null },
      ) => {
        clock.setNow("2026-08-01T00:00:01.000Z");
        const reclaimed = await clock.store.acquireSendingLease(
          logicalKey,
          1_000,
        );
        reclaimedLeaseToken = reclaimed?.leaseToken ?? null;
        expect(reclaimedLeaseToken).not.toBe(staleLeaseToken);
        await expect(
          clock.store.transitionSending(
            logicalKey,
            staleLeaseToken,
            nextState,
            changes,
          ),
        ).resolves.toBeNull();
        return null;
      },
    );

    const result = await runTransactionalEmailsOnce({
      store: { ...clock.store, transitionSending },
      repository,
      now: clock.now,
      leaseDurationMs: 1_000,
      emailConfigured: async () => true,
      send: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.sent).toBe(0);
    expect(transitionSending).toHaveBeenCalledWith(
      "first-import:owner@example.com",
      expect.any(String),
      "sent",
    );
    expect(
      await clock.store.readJob("first-import:owner@example.com"),
    ).toMatchObject({
      state: "sending",
      leaseToken: reclaimedLeaseToken,
      attempts: 2,
    });
  });

  it("retries failed delivery with backoff and records sent only after send resolves", async () => {
    const clock = await setup();
    const imported = {
      ...recording("import-1", "owner@example.com"),
      sourceAppName: "Video link",
    };
    const repository = createRepository({
      shares: [],
      recordings: new Map([[imported.id, imported]]),
    });
    await clock.store.enqueue("first-import:owner@example.com", {
      type: "first-import",
      recipient: "owner@example.com",
      recordingIds: [imported.id],
      requestedBy: "owner@example.com",
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce(undefined);

    const first = await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      emailConfigured: async () => true,
      retryBaseDelayMs: 60_000,
      send,
    });
    expect(first).toMatchObject({ retried: 1, sent: 0 });
    expect(
      await clock.store.readJob("first-import:owner@example.com"),
    ).toMatchObject({
      state: "ready",
      attempts: 1,
      lastError: "temporary provider failure",
    });

    clock.setNow("2026-08-01T00:00:59.999Z");
    await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      emailConfigured: async () => true,
      retryBaseDelayMs: 60_000,
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);

    clock.setNow("2026-08-01T00:01:00.000Z");
    const second = await runTransactionalEmailsOnce({
      store: clock.store,
      repository,
      now: clock.now,
      emailConfigured: async () => true,
      retryBaseDelayMs: 60_000,
      send,
    });

    expect(second.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      await clock.store.readJob("first-import:owner@example.com"),
    ).toMatchObject({ state: "sent", attempts: 2, lastError: null });
  });
});
