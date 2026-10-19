import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();
const mockCreateDeckVersionSnapshot = vi.fn();
const mockDeckVersionChatContextFromAction = vi.fn();
const mockCompileSlideSource = vi.fn();
const mockApplyEditBatch = vi.fn();

let deckRow: Record<string, unknown> | undefined;
let updateRowsAffected = 1;
let lastUpdateSet: { data?: string; updatedAt?: string } | undefined;
let lastUpdateWhere: unknown;
let returnedRowOverride: Record<string, unknown> | undefined;
const transactionEvents: string[] = [];

const updateReturningFn = vi.fn(async () => {
  if (updateRowsAffected !== 1 || !deckRow || !lastUpdateSet) return [];
  deckRow = { ...deckRow, ...lastUpdateSet };
  return [
    {
      id: deckRow.id,
      data: deckRow.data,
      updatedAt: deckRow.updatedAt,
      ...returnedRowOverride,
    },
  ];
});
const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (deckRow ? [deckRow] : []),
      }),
    }),
  }),
  update: () => ({
    set: (values: { data?: string; updatedAt?: string }) => {
      lastUpdateSet = values;
      return {
        where: (condition: unknown) => {
          lastUpdateWhere = condition;
          transactionEvents.push("write");
          return { returning: updateReturningFn };
        },
      };
    },
  }),
  transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
    (async () => {
      transactionEvents.push("begin");
      const result = await callback(mockDb);
      transactionEvents.push("commit");
      return result;
    })(),
};

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      data: "decks.data",
      ownerEmail: "decks.ownerEmail",
      orgId: "decks.orgId",
      updatedAt: "decks.updatedAt",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  sql: (...args: unknown[]) => ({ sql: args }),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: (...args: unknown[]) =>
    mockCreateDeckVersionSnapshot(...args),
  deckVersionChatContextFromAction: (...args: unknown[]) =>
    mockDeckVersionChatContextFromAction(...args),
}));

vi.mock("../server/lib/slide-source-editing/batch-edit.js", () => ({
  applyEditBatch: (...args: unknown[]) => mockApplyEditBatch(...args),
}));

vi.mock("./_slide-source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_slide-source.js")>();
  return {
    ...actual,
    compileSlideSource: (...args: unknown[]) => mockCompileSlideSource(...args),
  };
});

vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_deckId: string, callback: () => Promise<unknown>) =>
    callback(),
}));

import action from "./update-slide-source";

const originalSource =
  "export default function Slide() { return <h1>Old</h1>; }";
const changedSource =
  "export default function Slide() { return <h1>New</h1>; }";
const revision = 4;

function sourceHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function preview(source: string): string {
  return `<div>${source}</div>`;
}

function currentInput(overrides: Record<string, unknown> = {}) {
  return {
    deckId: "deck-1",
    slideId: "slide-1",
    expectedRevision: revision,
    expectedSourceHash: sourceHash(originalSource),
    sourceTsx: changedSource,
    ...overrides,
  };
}

function setDeckRow(
  source = originalSource,
  content = preview(source),
  sourceRevision = revision,
) {
  deckRow = {
    id: "deck-1",
    title: "Deck",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    data: JSON.stringify({
      appId: "slides-2",
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourceImport: { id: "import-1" },
      slides: [
        {
          id: "slide-1",
          sourceTsx: source,
          sourceHash: sourceHash(source),
          revision: sourceRevision,
          content,
          notes: "Keep these notes",
        },
      ],
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateRowsAffected = 1;
  lastUpdateSet = undefined;
  lastUpdateWhere = undefined;
  returnedRowOverride = undefined;
  transactionEvents.length = 0;
  setDeckRow();
  mockAssertAccess.mockResolvedValue(undefined);
  mockNotifyClients.mockResolvedValue(undefined);
  mockCreateDeckVersionSnapshot.mockImplementation(async () => {
    transactionEvents.push("snapshot");
    return { created: true };
  });
  mockDeckVersionChatContextFromAction.mockReturnValue(undefined);
  mockCompileSlideSource.mockImplementation(async (source: string) => ({
    content: preview(source),
    sourceHash: sourceHash(source),
    assetUrls: new Map(),
    assetOrigins: [],
  }));
  mockApplyEditBatch.mockImplementation(() => ({
    source: changedSource,
    results: [{ ok: true }],
  }));
});

describe("update-slide-source", () => {
  it("accepts slide source up to 256 KiB and rejects UTF-8 byte overflow", () => {
    const sourceAtLimit = "x".repeat(256 * 1024);
    const sourceOverLimit = "é".repeat(128 * 1024 + 1);
    const parse = (sourceTsx: string) =>
      action.schema.safeParse({
        deckId: "deck-1",
        slideId: "s1",
        expectedRevision: 1,
        expectedSourceHash: "a".repeat(64),
        sourceTsx,
      });

    expect(parse(sourceAtLimit).success).toBe(true);
    expect(sourceOverLimit.length).toBeLessThan(256 * 1024);
    expect(parse(sourceOverLimit).success).toBe(false);
  });

  it("atomically saves a validated source revision and records a verified receipt", async () => {
    const originalData = deckRow?.data;
    const result = await action.run(currentInput() as never);

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mockCompileSlideSource).toHaveBeenCalledWith(changedSource, {
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(mockCreateDeckVersionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ data: originalData }),
      expect.objectContaining({
        label: "Before editing slide source",
        db: mockDb,
      }),
    );
    expect(transactionEvents).toEqual(["begin", "snapshot", "write", "commit"]);
    expect(lastUpdateWhere).toMatchObject({
      and: [
        { eq: ["decks.data", originalData] },
        {
          and: [
            { eq: ["decks.id", "deck-1"] },
            { eq: ["decks.updatedAt", "2026-01-01T00:00:00.000Z"] },
          ],
        },
      ],
    });

    const savedData = JSON.parse(String(lastUpdateSet?.data));
    expect(savedData.slides[0]).toMatchObject({
      id: "slide-1",
      sourceTsx: changedSource,
      sourceHash: sourceHash(changedSource),
      revision: revision + 1,
      content: preview(changedSource),
      notes: "Keep these notes",
    });
    expect(savedData.sourceImport).toBeUndefined();
    expect(result).toMatchObject({
      previousRevision: revision,
      revision: revision + 1,
      sourceHash: sourceHash(changedSource),
      notificationStatus: "sent",
      nextRequiredAction: "get-slide-source",
      _receipt: {
        changed: true,
        verified: true,
        subject: "deck-1:slide-1",
        checks: [{ id: "slide-source", ok: true }],
      },
    });
    const definition = action as typeof action & {
      retrySafe?: boolean;
      mcpAnnotations?: { destructiveHint?: boolean };
    };
    expect(definition.retrySafe).toBe(true);
    expect(definition.mcpAnnotations).toMatchObject({ destructiveHint: true });
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1", {
      slideId: "slide-1",
    });
  });

  it("treats an already-matching source and preview as a verified no-op", async () => {
    const input = currentInput({ sourceTsx: originalSource });
    const result = await action.run(input as never);

    expect(result).toMatchObject({
      previousRevision: revision,
      revision,
      sourceHash: sourceHash(originalSource),
      notificationStatus: "not_needed",
      _receipt: {
        changed: false,
        verified: true,
        checks: [{ id: "slide-source", ok: true }],
      },
    });
    expect(lastUpdateSet).toBeUndefined();
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous full-source retry when that source is already persisted", async () => {
    const input = currentInput();
    await action.run(input as never);
    const writesAfterFirstCall = updateReturningFn.mock.calls.length;

    const retry = await action.run(input as never);

    expect(retry).toMatchObject({
      sourceTsx: changedSource,
      revision: revision + 1,
      sourceHash: sourceHash(changedSource),
      notificationStatus: "not_needed",
      _receipt: {
        changed: false,
        verified: true,
      },
    });
    expect(updateReturningFn).toHaveBeenCalledTimes(writesAfterFirstCall);
    expect(mockCreateDeckVersionSnapshot).toHaveBeenCalledOnce();
    expect(mockNotifyClients).toHaveBeenCalledOnce();
  });

  it("rejects a stale source revision before compiling or creating undo history", async () => {
    await expect(
      action.run(currentInput({ expectedRevision: revision - 1 }) as never),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 409,
      errorCode: "slide_source_conflict",
      details: { revision, sourceHash: sourceHash(originalSource) },
    });

    expect(mockCompileSlideSource).not.toHaveBeenCalled();
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects a source revision that cannot be incremented safely", async () => {
    const maxRevision = Number.MAX_SAFE_INTEGER;
    setDeckRow(originalSource, preview(originalSource), maxRevision);

    await expect(
      action.run(
        currentInput({
          expectedRevision: maxRevision,
          expectedSourceHash: sourceHash(originalSource),
        }) as never,
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 409,
      errorCode: "slide_source_revision_exhausted",
    });

    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
    expect(deckRow?.data).toContain(originalSource);
  });

  it("rejects a failed edit batch without compiling or partially saving it", async () => {
    mockApplyEditBatch.mockReturnValue({
      source: changedSource,
      results: [{ ok: false, error: "no JSX element at location" }],
    });
    const baseInput = currentInput();
    delete baseInput.sourceTsx;

    await expect(
      action.run({
        ...baseInput,
        edits: [
          {
            line: 1,
            ops: [{ kind: "set-text", value: "New" }],
          },
        ],
      } as never),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 422,
      errorCode: "slide_source_edit_failed",
      details: { failed: [{ index: 0, error: "no JSX element at location" }] },
    });

    expect(mockCompileSlideSource).not.toHaveBeenCalled();
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("rejects a concurrent deck write through the SQL compare-and-swap", async () => {
    updateRowsAffected = 0;

    await expect(action.run(currentInput() as never)).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 409,
      errorCode: "deck_write_conflict",
    });

    expect(transactionEvents).toEqual(["begin", "snapshot", "write"]);
    expect(mockNotifyClients).not.toHaveBeenCalled();
    expect(deckRow?.data).toContain(originalSource);
  });

  it("does not claim a source save when SQL readback differs from the requested row", async () => {
    returnedRowOverride = { data: "{}" };

    await expect(action.run(currentInput() as never)).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 503,
      errorCode: "deck_persistence_unverified",
    });

    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it("keeps a committed save successful when client notification fails", async () => {
    mockNotifyClients.mockRejectedValue(new Error("notification unavailable"));

    const result = await action.run(currentInput() as never);

    expect(result).toMatchObject({
      revision: revision + 1,
      notificationStatus: "failed",
      notificationErrorType: "Error",
      nextRequiredAction: "get-slide-source",
      _receipt: {
        changed: true,
        verified: true,
        warnings: [
          "The slide source save succeeded, but live client notification failed.",
        ],
      },
    });
  });

  it("returns source validation failures as typed action errors", async () => {
    mockCompileSlideSource.mockRejectedValue(
      Object.assign(new Error("Slide source is invalid."), {
        statusCode: 422,
        errorCode: "invalid_slide_source",
      }),
    );

    await expect(action.run(currentInput() as never)).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 422,
      errorCode: "invalid_slide_source",
    });

    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(lastUpdateSet).toBeUndefined();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });
});
