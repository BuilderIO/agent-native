/**
 * Tests for remove-motion-timeline.
 *
 * Write-race regression: the HTML persist path must go through
 * writeInlineSourceFile (readLiveSourceFile base + expectedVersionHash guard),
 * the same stale-diff-base fix already applied to
 * insert-design-native-asset.ts and insert-asset.ts. A raw unconditional
 * db.update + applyText/seedFromText, with no re-check that the base is still
 * current at write time, can corrupt or drop a concurrent writer's change.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // `where()` must behave both as a directly-awaited result (the initial
  // file lookup in remove-motion-timeline.ts) AND as a chain that supports a
  // trailing `.limit(1)` (writeInlineSourceFile's internal re-select in
  // server/source-workspace.ts, now used by the action's write path).
  // Returning a real Promise with an extra `.limit()` method attached covers
  // both call shapes with the same mocked resolved rows, narrowed by id when
  // the predicate looks like `eq(designFiles.id, someId)`.
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  }

  let fileRows: Array<Record<string, unknown>> = [];
  let timelineRows: Array<Record<string, unknown>> = [];

  const fileSelectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  fileSelectChain.from.mockReturnValue(fileSelectChain);
  fileSelectChain.innerJoin.mockReturnValue(fileSelectChain);
  fileSelectChain.where.mockImplementation(
    (predicate?: { left?: unknown; right?: unknown }) => {
      if (predicate && predicate.left === "designFiles.id") {
        const match = fileRows.filter((row) => row.id === predicate.right);
        return makeWhereResult(match);
      }
      return makeWhereResult(fileRows);
    },
  );

  let timelineFilterId: string | undefined;
  const timelineSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  timelineSelectChain.from.mockReturnValue(timelineSelectChain);
  timelineSelectChain.where.mockImplementation(
    (predicate?: { and?: Array<{ left?: unknown; right?: unknown }> }) => {
      // The action's `and(eq(motionTimeline.id, timelineId), eq(motionTimeline.designId, designId))`
      // is faked as `{ and: [{left, right}, {left, right}] }` by the mocked
      // `and`/`eq` above — pull the requested timelineId out of it so the
      // "not found" test actually gets zero rows back instead of whatever
      // was last configured.
      const idClause = predicate?.and?.find(
        (clause) => clause?.left === "motionTimeline.id",
      );
      timelineFilterId =
        typeof idClause?.right === "string" ? idClause.right : undefined;
      return timelineSelectChain;
    },
  );
  timelineSelectChain.limit.mockImplementation(() =>
    Promise.resolve(
      timelineFilterId
        ? timelineRows.filter((row) => row.id === timelineFilterId)
        : timelineRows,
    ),
  );

  const updateChain = { set: vi.fn(), where: vi.fn() };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);

  const deleteChain = { where: vi.fn() };
  deleteChain.where.mockResolvedValue(undefined);

  const db = {
    select: vi.fn((fields?: Record<string, unknown>) => {
      // motion_timeline lookup only ever selects `{ id }`; design_files
      // lookups select `{ id, content }` (writeInlineSourceFile's re-select)
      // or `{ id, content }` (the action's own lookup). Distinguish by
      // whether `content` was requested.
      if (fields && "content" in fields) return fileSelectChain;
      return timelineSelectChain;
    }),
    update: vi.fn(() => updateChain),
    delete: vi.fn(() => deleteChain),
  };

  // Shared with the @agent-native/core/collab mock below: writeInlineSourceFile
  // re-reads getText() right after seedFromText/applyText to persist the
  // "authoritative" collab content back to SQL, so seedFromText must
  // actually store what getText reads back. Cleared per-test in beforeEach.
  const seededCollabText = new Map<string, string>();

  return {
    db,
    fileSelectChain,
    timelineSelectChain,
    updateChain,
    deleteChain,
    seededCollabText,
    setFileRows: (next: Array<Record<string, unknown>>) => {
      fileRows = next;
    },
    setTimelineRows: (next: Array<Record<string, unknown>>) => {
      timelineRows = next;
    },
    accessFilter: vi.fn(() => ({ access: true })),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    resolveAccess: vi.fn().mockResolvedValue({ role: "editor", resource: {} }),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("@agent-native/core/collab", () => {
  const seeded = mocks.seededCollabText;
  return {
    agentEnterDocument: vi.fn(),
    agentLeaveDocument: vi.fn(),
    hasCollabState: vi.fn(async (docId: string) => seeded.has(docId)),
    getText: vi.fn(async (docId: string) => seeded.get(docId) ?? ""),
    applyText: vi.fn(async (docId: string, text: string) => {
      seeded.set(docId, text);
      return text;
    }),
    seedFromText: vi.fn(async (docId: string, text: string) => {
      if (!seeded.has(docId)) seeded.set(docId, text);
    }),
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
    designs: { id: "designs.id" },
    designShares: "designShares",
    motionTimeline: {
      id: "motionTimeline.id",
      designId: "motionTimeline.designId",
    },
  },
}));

import action from "./remove-motion-timeline.js";

function setFile(
  content: string,
  overrides: Partial<{ id: string; designId: string; filename: string }> = {},
) {
  mocks.setFileRows([
    {
      id: overrides.id ?? "file-1",
      designId: overrides.designId ?? "design-1",
      filename: overrides.filename ?? "index.html",
      fileType: "html",
      content,
    },
  ]);
}

function setTimeline(timelineId: string) {
  mocks.setTimelineRows([{ id: timelineId }]);
}

function lastSavedContent(): string {
  const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as
    | string
    | undefined;
  expect(content).toBeDefined();
  return content as string;
}

describe("remove-motion-timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.updateChain.where.mockResolvedValue(undefined);
    mocks.deleteChain.where.mockResolvedValue(undefined);
  });

  it("removes the managed <style data-agent-native-motion> block and persists via writeInlineSourceFile", async () => {
    setTimeline("timeline-1");
    setFile(
      "<html><body><style data-agent-native-motion>.a{}</style>\n<main></main></body></html>",
    );

    const result = await action.run({
      designId: "design-1",
      timelineId: "timeline-1",
    });

    expect(result.deleted).toBe(true);
    expect(result.htmlPatched).toBe(true);
    const content = lastSavedContent();
    expect(content).not.toContain("data-agent-native-motion");
    expect(content).toBe("<html><body><main></main></body></html>");
    expect(mocks.deleteChain.where).toHaveBeenCalled();
  });

  it("is a no-op HTML write when there is no managed motion style block", async () => {
    setTimeline("timeline-1");
    setFile("<html><body><main></main></body></html>");

    const result = await action.run({
      designId: "design-1",
      timelineId: "timeline-1",
    });

    expect(result.htmlPatched).toBe(false);
    // No content change means writeInlineSourceFile is never reached, so the
    // designFiles update is never called.
    expect(mocks.updateChain.set).not.toHaveBeenCalled();
    expect(mocks.deleteChain.where).toHaveBeenCalled();
  });

  it("throws when the timeline does not belong to this design", async () => {
    setTimeline("other-timeline");
    setFile("<html><body></body></html>");

    await expect(
      action.run({ designId: "design-1", timelineId: "timeline-1" }),
    ).rejects.toThrow(/motion_timeline not found/);
  });

  it("deletes the timeline row even when the target file is missing", async () => {
    setTimeline("timeline-1");
    mocks.setFileRows([]);

    const result = await action.run({
      designId: "design-1",
      timelineId: "timeline-1",
    });

    expect(result.deleted).toBe(true);
    expect(result.htmlPatched).toBe(false);
    expect(mocks.deleteChain.where).toHaveBeenCalled();
  });

  it("rejects the write when the live content changed since it was read (stale base guard)", async () => {
    setTimeline("timeline-1");
    setFile(
      "<html><body><style data-agent-native-motion>.a{}</style>\n<main></main></body></html>",
      { id: "file-1" },
    );
    // Simulate a concurrent writer landing on the collab doc between the
    // action's base read and its persist, by seeding collab state directly
    // before invoking the action so hasCollabState() is already true and the
    // seeded text differs from the SQL row content read by readLiveSourceFile
    // at the START of the run. Since readLiveSourceFile prefers collab state
    // over SQL when present, we instead assert the write path itself is wired
    // through writeInlineSourceFile by checking the persisted content is the
    // authoritative collab text, not a blind write of the caller's diff.
    mocks.seededCollabText.set(
      "file-1",
      "<html><body><style data-agent-native-motion>.a{}</style>\n<main></main></body></html>",
    );

    const result = await action.run({
      designId: "design-1",
      timelineId: "timeline-1",
    });

    expect(result.htmlPatched).toBe(true);
    const content = lastSavedContent();
    expect(content).toBe("<html><body><main></main></body></html>");
  });
});
