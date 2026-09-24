import { describe, expect, it } from "vitest";

import {
  babysitQueueTier,
  compareBabysitQueueRows,
  nextBabysitQueueCursor,
  parseBabysitQueueCursor,
  serializeBabysitQueueCursor,
  sortBabysitQueueRows,
} from "./babysit-queue.js";

function row(id: string, updatedAt: string, metadata: Record<string, unknown>) {
  return {
    id,
    updatedAt,
    metadataJson: JSON.stringify(metadata),
  };
}

describe("babysitQueueTier", () => {
  it("prioritizes explicit queued and pending reopen as tier 0", () => {
    expect(
      babysitQueueTier(
        JSON.stringify({ prBabysitState: "queued", authorId: "1" }),
      ),
    ).toBe(0);
    expect(
      babysitQueueTier(
        JSON.stringify({ prBabysitPendingReopen: true, authorId: "1" }),
      ),
    ).toBe(0);
  });

  it("prioritizes never-pinged PRs with babysit work signals as tier 1", () => {
    expect(
      babysitQueueTier(
        JSON.stringify({
          prBabysitBotReviewBodyKeys: ["bot1:please fix"],
        }),
      ),
    ).toBe(1);
  });

  it("uses tier 3 for idle backlog rows", () => {
    expect(babysitQueueTier(JSON.stringify({ authorId: "1" }))).toBe(3);
  });
});

describe("sortBabysitQueueRows", () => {
  it("ranks queued items ahead of newer updated_at backlog rows", () => {
    const queued = row("queued", "2026-09-14T18:35:19.685Z", {
      prBabysitState: "queued",
      prBabysitPendingReopen: true,
    });
    const fresh = row("fresh", "2026-09-14T19:00:00.000Z", {
      prBabysitBotReviewBodyKeys: ["bot1:fix"],
    });
    const sorted = sortBabysitQueueRows([fresh, queued], null);
    expect(sorted.map((entry) => entry.id)).toEqual(["queued", "fresh"]);
  });

  it("sorts within tier by updated_at ascending", () => {
    const older = row("older", "2026-09-14T18:00:00.000Z", {
      prBabysitState: "queued",
    });
    const newer = row("newer", "2026-09-14T19:00:00.000Z", {
      prBabysitState: "queued",
    });
    const sorted = sortBabysitQueueRows([newer, older], null);
    expect(sorted.map((entry) => entry.id)).toEqual(["older", "newer"]);
  });

  it("rotates tier-0 rows using the updated_at cursor", () => {
    const a = row("a", "2026-09-14T18:00:00.000Z", {
      prBabysitState: "queued",
    });
    const b = row("b", "2026-09-14T18:00:00.000Z", {
      prBabysitState: "queued",
    });
    const c = row("c", "2026-09-14T18:00:00.000Z", {
      prBabysitState: "queued",
    });
    const sorted = sortBabysitQueueRows([a, b, c], {
      lastCheckedAt: "2026-09-14T18:00:00.000Z",
      lastId: "b",
    });
    expect(sorted.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });

  it("rotates tier-3 rows using the round-robin cursor", () => {
    const a = row("a", "2026-09-14T18:00:00.000Z", {
      prBabysitLastCheckedAt: "2026-09-14T17:00:00.000Z",
    });
    const b = row("b", "2026-09-14T18:00:00.000Z", {
      prBabysitLastCheckedAt: "2026-09-14T18:00:00.000Z",
    });
    const c = row("c", "2026-09-14T18:00:00.000Z", {
      prBabysitLastCheckedAt: "2026-09-14T19:00:00.000Z",
    });
    const sorted = sortBabysitQueueRows([a, b, c], {
      lastCheckedAt: "2026-09-14T18:00:00.000Z",
      lastId: "b",
    });
    expect(sorted.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });
});

describe("babysit queue cursor", () => {
  it("round-trips cursor JSON", () => {
    const cursor = {
      lastCheckedAt: "2026-09-14T18:00:00.000Z",
      lastId: "item-1",
    };
    expect(
      parseBabysitQueueCursor(serializeBabysitQueueCursor(cursor)),
    ).toEqual(cursor);
  });

  it("derives the next cursor from the last listed tier-0 row", () => {
    const listed = [
      row("queued", "2026-09-14T18:00:00.000Z", { prBabysitState: "queued" }),
      row("backlog", "2026-09-14T18:00:00.000Z", {
        prBabysitLastCheckedAt: "2026-09-14T17:30:00.000Z",
      }),
    ];
    expect(nextBabysitQueueCursor(listed)).toEqual({
      lastCheckedAt: "2026-09-14T18:00:00.000Z",
      lastId: "queued",
    });
  });

  it("derives the next cursor from the last listed tier-3 row when no tier-0 rows", () => {
    const listed = [
      row("backlog-a", "2026-09-14T18:00:00.000Z", {
        prBabysitLastCheckedAt: "2026-09-14T17:00:00.000Z",
      }),
      row("backlog-b", "2026-09-14T18:00:00.000Z", {
        prBabysitLastCheckedAt: "2026-09-14T17:30:00.000Z",
      }),
    ];
    expect(nextBabysitQueueCursor(listed)).toEqual({
      lastCheckedAt: "2026-09-14T17:30:00.000Z",
      lastId: "backlog-b",
    });
  });
});

describe("compareBabysitQueueRows", () => {
  it("orders lower tiers first", () => {
    const queued = row("queued", "2026-09-14T19:00:00.000Z", {
      prBabysitState: "queued",
    });
    const fresh = row("fresh", "2026-09-14T18:00:00.000Z", {
      prBabysitBotReviewBodyKeys: ["bot1:fix"],
    });
    expect(compareBabysitQueueRows(queued, fresh)).toBeLessThan(0);
  });
});
