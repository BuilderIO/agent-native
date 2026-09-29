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
  updateChain.where.mockResolvedValue({ rowsAffected: 1 });

  const deleteChain = { where: vi.fn() };
  deleteChain.where.mockResolvedValue(undefined);

  const db = {
    select: vi.fn((fields?: Record<string, unknown>) => {
      if (fields && "content" in fields) return fileSelectChain;
      return timelineSelectChain;
    }),
    update: vi.fn(() => updateChain),
    delete: vi.fn(() => deleteChain),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn(async (callback) => callback(db)),
  };

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
    isNull: vi.fn((value) => ({ isNull: value })),
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
  isNull: mocks.isNull,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/collab", () => {
  const seeded = mocks.seededCollabText;
  return {
    CollabBaseVersionConflictError: class CollabBaseVersionConflictError extends Error {},
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
    applyTextToYDoc: vi.fn(
      (doc: { content: string }, _fieldName: string, text: string) => {
        doc.content = text;
      },
    ),
    withPreparedYDocMutation: vi.fn(
      async (
        docId: string,
        _requestSource: string | undefined,
        run: (lease: {
          doc: { content: string; getText: () => { toString: () => string } };
          baseVersion: number | null;
          persist: (_tx: unknown, text: string) => Promise<void>;
        }) => Promise<unknown>,
      ) => {
        const base = seeded.has(docId) ? seeded.get(docId)! : null;
        const doc = {
          content: base ?? "",
          getText: () => ({ toString: () => doc.content }),
        };
        let persisted = false;
        const result = await run({
          doc,
          baseVersion: base ? 0 : null,
          persist: async (_tx, text) => {
            seeded.set(docId, text);
            persisted = true;
          },
        });
        if (!persisted) docs.delete(docId);
        return result;
      },
    ),
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
    mocks.updateChain.where.mockResolvedValue({ rowsAffected: 1 });
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
    const base =
      "<html><body><style data-agent-native-motion>.a{}</style>\n<main></main></body></html>";
    const concurrent = "<html><body><main>concurrent</main></body></html>";
    mocks.seededCollabText.set("file-1", base);
    const collab = await import("@agent-native/core/collab");
    (collab.getText as any).mockImplementationOnce(async () => {
      mocks.seededCollabText.set("file-1", concurrent);
      return base;
    });

    await expect(
      action.run({
        designId: "design-1",
        timelineId: "timeline-1",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mocks.updateChain.set).not.toHaveBeenCalled();
    expect(mocks.seededCollabText.get("file-1")).toBe(concurrent);
  });
});
