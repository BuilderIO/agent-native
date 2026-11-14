import { expect, vi } from "vitest";

const mocks = vi.hoisted(() => {
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
      for: (strength: string) => Promise<unknown[]>;
      orderBy: (...columns: unknown[]) => {
        limit: (n: number) => Promise<unknown[]>;
      };
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    promise.for = vi.fn().mockResolvedValue(rows);
    promise.orderBy = vi.fn().mockReturnValue(promise);
    return promise;
  }

  let fileRows: Array<Record<string, unknown>> = [];
  let designRows: Array<Record<string, unknown>> = [
    { id: "design-1", data: null },
  ];
  let designData: Record<string, unknown> = {};

  const fileSelectChain = { from: vi.fn(), where: vi.fn() };
  fileSelectChain.from.mockReturnValue(fileSelectChain);
  fileSelectChain.where.mockImplementation(
    (predicate?: { left?: unknown; right?: unknown }) => {
      if (predicate && predicate.left === "designFiles.id") {
        return makeWhereResult(
          fileRows.filter((row) => row.id === predicate.right),
        );
      }
      if (predicate && predicate.left === "designFiles.designId") {
        return makeWhereResult(
          fileRows.filter((row) => row.designId === predicate.right),
        );
      }
      return makeWhereResult(fileRows);
    },
  );

  const designSelectChain = { from: vi.fn(), where: vi.fn() };
  designSelectChain.from.mockReturnValue(designSelectChain);
  designSelectChain.where.mockImplementation(
    (predicate?: { left?: unknown; right?: unknown }) => {
      if (predicate && predicate.left === "designs.id") {
        return makeWhereResult(
          designRows.filter((row) => row.id === predicate.right),
        );
      }
      return makeWhereResult(designRows);
    },
  );

  const select = vi.fn((projection?: Record<string, unknown>) => {
    if (projection && "data" in projection) return designSelectChain;
    return fileSelectChain;
  });

  const insert = vi.fn(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));

  const fileUpdateChain = { set: vi.fn(), where: vi.fn() };
  fileUpdateChain.set.mockReturnValue(fileUpdateChain);
  fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });

  const designUpdateChain = { set: vi.fn(), where: vi.fn() };
  designUpdateChain.set.mockReturnValue(designUpdateChain);
  designUpdateChain.where.mockResolvedValue(undefined);

  const update = vi.fn((table: unknown) => {
    if (table === schemaRef.designs) return designUpdateChain;
    return fileUpdateChain;
  });

  const schemaRef: { designFiles?: unknown; designs?: unknown } = {};

  const tx = {
    select,
    insert,
    update,
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };

  const transaction = vi.fn(async (fn: (tx: typeof tx) => Promise<void>) => {
    await fn(tx);
  });

  const db = {
    select,
    insert,
    update,
    transaction,
  };

  const seededCollabText = new Map<string, string>();

  return {
    db,
    schemaRef,
    fileSelectChain,
    designSelectChain,
    fileUpdateChain,
    designUpdateChain,
    insert,
    transaction,
    seededCollabText,
    setFileRows: (next: Array<Record<string, unknown>>) => {
      fileRows = next;
    },
    setDesignRows: (next: Array<Record<string, unknown>>) => {
      designRows = next;
    },
    setDesignData: (next: Record<string, unknown>) => {
      designData = next;
    },
    getDesignData: () => designData,
    mutateDesignData: vi.fn(),
    snapshotDesignBeforeAgentEdit: vi.fn().mockResolvedValue(null),
    designAccess: async () => ({
      role: "editor",
      resource: { id: "design-1", data: JSON.stringify(designData) },
    }),
    assertAccess: vi.fn(async () => ({
      role: "editor",
      resource: { id: "design-1", data: JSON.stringify(designData) },
    })),
    and: vi.fn((...conditions) => ({ conditions })),
    inArray: vi.fn((column, values) => ({ column, values })),
    eq: vi.fn((left, right) => ({ left, right })),
    isNull: vi.fn((value) => ({ isNull: value })),
    readAppState: vi.fn().mockResolvedValue(null),
    writeAppState: vi.fn().mockResolvedValue(undefined),
    getGenerationCreativeContext: vi.fn().mockResolvedValue(null),
    isCreativeContextOffForUser: vi.fn().mockResolvedValue(false),
    recordGenerationCreativeContext: vi.fn().mockResolvedValue(undefined),
    resolveGenerationCreativeContext: vi.fn().mockResolvedValue({
      contextMode: "auto",
      contextPackId: null,
      reuseLabels: [],
      results: [],
    }),
    validateGenerationCreativeContext: vi.fn(
      async (input: {
        contextPackId?: string | null;
        contextModeOverride?: "off";
        reuseLabels?: Array<Record<string, unknown>>;
      }) => ({
        contextMode:
          input.contextModeOverride === "off"
            ? "off"
            : input.contextPackId
              ? "pinned"
              : "auto",
        contextPackId:
          input.contextModeOverride === "off"
            ? null
            : (input.contextPackId ?? null),
        reuseLabels: input.reuseLabels ?? [],
        results: [],
      }),
    ),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

const track = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/tracking", () => ({ track }));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  inArray: mocks.inArray,
  gt: vi.fn((left, right) => ({ left, right })),
  isNull: mocks.isNull,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/collab", () => {
  const seeded = mocks.seededCollabText;
  const hasCollabState = vi.fn(async (docId: string) => seeded.has(docId));
  const getText = vi.fn(async (docId: string) => seeded.get(docId) ?? "");
  return {
    CollabBaseVersionConflictError: class CollabBaseVersionConflictError extends Error {},
    hasCollabState,
    getText,
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
        const hasLiveDoc = await hasCollabState(docId);
        const doc = {
          content: hasLiveDoc ? await getText(docId) : "",
          getText: () => ({ toString: () => doc.content }),
        };
        const result = await run({
          doc,
          baseVersion: hasLiveDoc ? 0 : null,
          persist: async (_tx, text) => {
            seeded.set(docId, text);
          },
        });
        return result;
      },
    ),
    agentEnterDocument: vi.fn(),
    agentLeaveDocument: vi.fn(),
    agentUpdateSelection: vi.fn(),
  };
});

vi.mock("../server/db/index.js", () => {
  const schema = {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
    designs: {
      id: "designs.id",
      title: "designs.title",
      data: "designs.data",
    },
  };
  mocks.schemaRef.designFiles = schema.designFiles;
  mocks.schemaRef.designs = schema.designs;
  return {
    getDb: () => mocks.db,
    schema,
  };
});

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));

vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: mocks.getGenerationCreativeContext,
  isCreativeContextOffForUser: mocks.isCreativeContextOffForUser,
  recordGenerationCreativeContext: mocks.recordGenerationCreativeContext,
  resolveGenerationCreativeContext: mocks.resolveGenerationCreativeContext,
  validateGenerationCreativeContext: mocks.validateGenerationCreativeContext,
  validateCreativeContextReuseLabels: (
    labels: Array<Record<string, unknown>>,
  ) => labels,
  mergeCreativeContextReuseLabels: (
    previous: Array<Record<string, unknown>>,
    next: Array<Record<string, unknown>>,
  ) => [...previous, ...next],
  replaceCreativeContextElementProvenance: (
    previous: Array<{ elementId: string }>,
    next: Array<{ elementId: string }>,
  ) => {
    const replaced = new Set(next.map((entry) => entry.elementId));
    return [
      ...previous.filter((entry) => !replaced.has(entry.elementId)),
      ...next,
    ];
  },
}));

import action from "./generate-design.js";
function resetDesignDataMutation() {
  mocks.setDesignData({ concurrentSibling: { keep: true } });
  mocks.mutateDesignData.mockImplementation(
    async (options: {
      mutate: (
        current: Record<string, unknown>,
        context: { updatedAt: string },
      ) => Record<string, unknown>;
      isApplied: (current: Record<string, unknown>) => boolean;
    }) => {
      const updatedAt = "2026-07-09T12:00:00.000Z";
      const next = options.mutate(mocks.getDesignData(), { updatedAt });
      mocks.setDesignData(next);
      expect(options.isApplied(next)).toBe(true);
      return { data: next, updatedAt };
    },
  );
}

function setExistingFile(
  content: string,
  overrides: Partial<{
    id: string;
    designId: string;
    filename: string;
    fileType: string;
  }> = {},
) {
  mocks.setFileRows([
    {
      id: overrides.id ?? "file-1",
      designId: overrides.designId ?? "design-1",
      filename: overrides.filename ?? "index.html",
      fileType: overrides.fileType ?? "html",
      content,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
}

export const placementTestFixtures = {
  action,
  mocks,
  resetDesignDataMutation,
  setExistingFile,
  track,
};
