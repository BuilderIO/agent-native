import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `delivery-workbench-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.com";
const OTHER = "other@example.com";

let ingestAction: typeof import("./ingest-work-items.js").default;
let listAction: typeof import("./list-work-items.js").default;
let getAction: typeof import("./get-work-item.js").default;
let updateAction: typeof import("./update-work-item.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  ingestAction = (await import("./ingest-work-items.js")).default;
  listAction = (await import("./list-work-items.js")).default;
  getAction = (await import("./get-work-item.js")).default;
  updateAction = (await import("./update-work-item.js")).default;
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function asUser<T>(
  userEmail: string,
  fn: () => T | Promise<T>,
  orgId?: string,
) {
  return runWithRequestContext({ userEmail, orgId }, fn);
}

describe("delivery workbench work item actions", () => {
  it("keeps canonical work items idempotent for the same ingest dataset", async () => {
    const input = {
      provider: "example-provider",
      cursorStart: "0",
      cursorEnd: "1",
      items: [
        {
          sourceId: "ticket-1",
          sourceUrl: "https://example.com/tickets/1",
          title: "Resolve launch blocker",
          body: "A normalized support ticket body.",
          status: "open" as const,
          priority: "high" as const,
          tags: ["launch", "vip", "launch"],
          metadata: { accountTier: "enterprise" },
          sourceUpdatedAt: "2026-07-03T09:00:00.000Z",
        },
      ],
    };

    const first = await asUser(OWNER, () => ingestAction.run(input));
    const second = await asUser(OWNER, () => ingestAction.run(input));
    const list = await asUser(OWNER, () =>
      listAction.run({ provider: "example-provider" }),
    );

    expect(first.createdCount).toBe(1);
    expect(first.updatedCount).toBe(0);
    expect(second.createdCount).toBe(0);
    expect(second.updatedCount).toBe(0);
    expect(second.unchangedCount).toBe(1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      provider: "example-provider",
      sourceId: "ticket-1",
      title: "Resolve launch blocker",
      priority: "high",
      tags: ["launch", "vip"],
    });
  });

  it("allows separate owner scopes to ingest the same provider source id", async () => {
    const ownerResult = await asUser(OWNER, () =>
      ingestAction.run({
        provider: "shared-upstream",
        items: [
          {
            sourceId: "shared-ticket",
            title: "Owner scoped ticket",
          },
        ],
      }),
    );
    const otherResult = await asUser(OTHER, () =>
      ingestAction.run({
        provider: "shared-upstream",
        items: [
          {
            sourceId: "shared-ticket",
            title: "Other scoped ticket",
          },
        ],
      }),
    );

    const ownerList = await asUser(OWNER, () =>
      listAction.run({ provider: "shared-upstream" }),
    );
    const otherList = await asUser(OTHER, () =>
      listAction.run({ provider: "shared-upstream" }),
    );
    expect(ownerResult.createdCount).toBe(1);
    expect(otherResult.createdCount).toBe(1);
    expect(ownerResult.workItemIds[0]).not.toBe(otherResult.workItemIds[0]);
    expect(ownerList).toHaveLength(1);
    expect(ownerList[0]).toMatchObject({
      sourceId: "shared-ticket",
      title: "Owner scoped ticket",
    });
    expect(otherList).toHaveLength(1);
    expect(otherList[0]).toMatchObject({
      sourceId: "shared-ticket",
      title: "Other scoped ticket",
    });
    await expect(
      asUser(OWNER, () => getAction.run({ id: otherResult.workItemIds[0]! })),
    ).rejects.toThrow(/not found or inaccessible/);
  });

  it("supports list, get, and update through the action surface", async () => {
    const ingest = await asUser(OWNER, () =>
      ingestAction.run({
        provider: "manual",
        items: [
          {
            sourceId: "ticket-2",
            title: "Triage partner escalation",
            priority: "normal",
            tags: ["partner"],
            metadata: { queue: "support" },
          },
        ],
      }),
    );
    const id = ingest.workItemIds[0]!;

    const updated = await asUser(OWNER, () =>
      updateAction.run({
        id,
        status: "in_progress",
        priority: "urgent",
        assigneeEmail: "lead@example.com",
        tags: ["partner", "sla"],
        metadata: { escalated: true },
      }),
    );
    const detail = await asUser(OWNER, () => getAction.run({ id }));

    expect(updated?.status).toBe("in_progress");
    expect(detail).toMatchObject({
      id,
      status: "in_progress",
      priority: "urgent",
      assigneeEmail: "lead@example.com",
      tags: ["partner", "sla"],
      metadata: { queue: "support", escalated: true },
    });
    expect(detail.recentSnapshots.length).toBeGreaterThan(0);
  });

  it("scopes private work items to the owner for read and write actions", async () => {
    const ingest = await asUser(OWNER, () =>
      ingestAction.run({
        provider: "private-provider",
        items: [{ sourceId: "ticket-3", title: "Private queue item" }],
      }),
    );
    const id = ingest.workItemIds[0]!;

    const otherList = await asUser(OTHER, () =>
      listAction.run({ provider: "private-provider" }),
    );
    await expect(
      asUser(OTHER, () => updateAction.run({ id, status: "done" })),
    ).rejects.toThrow(/No access/);

    expect(otherList).toEqual([]);
  });
});
