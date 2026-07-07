import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // `where()` must behave both as a directly-awaited result (the initial
  // file lookup in apply-visual-edit.ts's resolveEditableDesignFile) AND as
  // a chain that supports a trailing `.limit(1)` (writeInlineSourceFile's
  // internal re-select in server/source-workspace.ts, now used by this
  // action's write path via persistDesignFileEdit). Returning a real Promise
  // with an extra `.limit()` method attached covers both call shapes with
  // the same mocked resolved value. Same pattern as the 8 sibling actions
  // migrated to readLiveSourceFile/writeInlineSourceFile (see
  // insert-design-native-asset.spec.ts).
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  }

  // Backing rows for the configured design's files. The action's own lookup
  // filters by fileId/designId+filename (the fake accessFilter/and don't
  // narrow further, so this fake matches by shape); writeInlineSourceFile's
  // internal re-select filters by a single file id (`eq(designFiles.id,
  // file.id)`), which this fake `where` recognizes by shape and narrows to,
  // so the SAME row the action targeted is what gets re-selected for the CAS
  // check.
  let rows: Array<Record<string, unknown>> = [];
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
        const match = rows.filter((row) => row.id === predicate.right);
        return makeWhereResult(match);
      }
      return makeWhereResult(rows);
    },
  );

  const updateChain = { set: vi.fn(), where: vi.fn() };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);

  const db = {
    select: vi.fn(() => fileSelectChain),
    update: vi.fn(() => updateChain),
  };

  // Shared with the @agent-native/core/collab mock below: writeInlineSourceFile
  // re-reads getText() right after seedFromText/applyText to persist the
  // "authoritative" collab content back to SQL, so seedFromText must
  // actually store what getText reads back. Cleared per-test in beforeEach
  // (the vi.mock factory only runs once per file, so without an explicit
  // reset this map would leak seeded content across tests).
  const seededCollabText = new Map<string, string>();

  return {
    db,
    fileSelectChain,
    updateChain,
    makeWhereResult,
    seededCollabText,
    setRows: (next: Array<Record<string, unknown>>) => {
      rows = next;
    },
    accessFilter: vi.fn(() => ({ kind: "access-filter" })),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    resolveAccess: vi.fn().mockResolvedValue({ role: "editor", resource: {} }),
    and: vi.fn((...parts) => ({ parts })),
    eq: vi.fn((left, right) => ({ left, right })),
    applyVisualEdit: vi.fn(),
    agentEnterDocument: vi.fn(),
    agentLeaveDocument: vi.fn(),
    agentUpdateSelection: vi.fn(),
    hasCollabState: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@agent-native/core/collab", () => {
  const seeded = mocks.seededCollabText;
  return {
    agentEnterDocument: mocks.agentEnterDocument,
    agentLeaveDocument: mocks.agentLeaveDocument,
    agentUpdateSelection: mocks.agentUpdateSelection,
    hasCollabState: mocks.hasCollabState,
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

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      updatedAt: "designFiles.updatedAt",
    },
    designs: { id: "designs.id" },
    designShares: {},
  },
}));

vi.mock("../shared/code-layer.js", () => ({
  applyVisualEdit: mocks.applyVisualEdit,
}));

import action from "./apply-visual-edit.js";

function setFiles(rows: Array<Record<string, unknown>>) {
  mocks.setRows(rows);
}

function setFile(
  content: string,
  overrides: Partial<{
    id: string;
    designId: string;
    filename: string;
    fileType: string;
  }> = {},
) {
  setFiles([
    {
      id: overrides.id ?? "file_123",
      designId: overrides.designId ?? "design_123",
      filename: overrides.filename ?? "index.html",
      fileType: overrides.fileType ?? "html",
      content,
    },
  ]);
}

function lastSavedContent(): string {
  const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as
    | string
    | undefined;
  expect(content).toBeDefined();
  return content as string;
}

describe("apply-visual-edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.updateChain.where.mockResolvedValue(undefined);
    mocks.hasCollabState.mockResolvedValue(false);
    setFile("<main>Hello</main>");
  });

  it("rejects malformed intents that do not identify a target node", () => {
    expect(
      action.schema.safeParse({
        source: { kind: "design-file", designId: "design_123" },
        intent: {
          kind: "style",
          target: {},
          property: "color",
          value: "red",
        },
      }).success,
    ).toBe(false);
  });

  it("fails fast when fileId and designId disagree", async () => {
    await expect(
      action.run({
        source: {
          kind: "design-file",
          fileId: "file_123",
          designId: "design_other",
        },
        intent: {
          kind: "style",
          target: { selector: "main" },
          property: "color",
          value: "red",
        },
      }),
    ).rejects.toThrow(
      'source.designId "design_other" does not match file "file_123"',
    );

    expect(mocks.applyVisualEdit).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("allows fileId-only edits against non-index design files", async () => {
    setFile("<main>Details</main>", {
      id: "file_details",
      filename: "details.html",
    });
    mocks.applyVisualEdit.mockReturnValueOnce({
      result: { status: "applied", changed: false },
      projection: { nodes: [] },
      content: "<main>Updated details</main>",
    });

    await expect(
      action.run({
        source: {
          kind: "design-file",
          fileId: "file_details",
        },
        intent: {
          kind: "style",
          target: { selector: "main" },
          property: "color",
          value: "red",
        },
      }),
    ).resolves.toMatchObject({
      designId: "design_123",
      fileId: "file_details",
      filename: "details.html",
      persisted: false,
    });

    expect(mocks.applyVisualEdit).toHaveBeenCalledWith(
      "<main>Details</main>",
      expect.any(Object),
      {
        source: {
          kind: "design-file",
          designId: "design_123",
          fileId: "file_details",
          filename: "details.html",
          revision: undefined,
        },
      },
    );
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_123",
      "editor",
    );
  });

  it("publishes a resolvable node-id selection descriptor with a label", async () => {
    mocks.applyVisualEdit.mockReturnValueOnce({
      result: {
        status: "applied",
        changed: false,
        target: { nodeId: "hero-cta", selector: "main > button.cta" },
      },
      projection: { nodes: [] },
      content: "<main>Hello</main>",
    });

    await action.run({
      source: { kind: "design-file", fileId: "file_123" },
      intent: {
        kind: "textContent",
        target: { nodeId: "hero-cta" },
        value: "Buy now",
      },
    });

    expect(mocks.agentUpdateSelection).toHaveBeenCalledWith(
      "file_123",
      expect.objectContaining({
        // Prefers the stable node-id anchor over the projection selector, and
        // carries a short human-readable edit-intent label.
        selection: {
          selector: '[data-agent-native-node-id="hero-cta"]',
          label: "Editing text",
        },
        nodeId: "hero-cta",
        editingFile: "index.html",
        designId: "design_123",
      }),
    );
  });

  it("falls back to the projection selector when no node id is present", async () => {
    mocks.applyVisualEdit.mockReturnValueOnce({
      result: {
        status: "applied",
        changed: false,
        target: { selector: "main > button.cta" },
      },
      projection: { nodes: [] },
      content: "<main>Hello</main>",
    });

    await action.run({
      source: { kind: "design-file", fileId: "file_123" },
      intent: {
        kind: "style",
        target: { selector: "main > button.cta" },
        property: "color",
        value: "red",
      },
    });

    expect(mocks.agentUpdateSelection).toHaveBeenCalledWith(
      "file_123",
      expect.objectContaining({
        selection: {
          selector: "main > button.cta",
          label: "Editing style",
        },
      }),
    );
  });

  // Write-race fix coverage: an applied+changed edit must actually persist
  // through readLiveSourceFile/writeInlineSourceFile (expectedVersionHash
  // CAS), not the old raw unconditional db.update + applyText/seedFromText.
  describe("persistence (readLiveSourceFile / writeInlineSourceFile CAS)", () => {
    it("persists the patched content and reports persisted: true when the edit actually changes the file", async () => {
      mocks.applyVisualEdit.mockReturnValueOnce({
        result: { status: "applied", changed: true },
        projection: { nodes: [] },
        content: "<main>Updated</main>",
      });

      const result = await action.run({
        source: { kind: "design-file", fileId: "file_123" },
        intent: {
          kind: "style",
          target: { selector: "main" },
          property: "color",
          value: "red",
        },
      });

      expect(result.persisted).toBe(true);
      expect(lastSavedContent()).toBe("<main>Updated</main>");
      // agentEnterDocument/agentLeaveDocument presence bookkeeping must still
      // wrap the persist, matching the pre-CAS-fix behavior.
      expect(mocks.agentEnterDocument).toHaveBeenCalledWith("file_123");
      expect(mocks.agentLeaveDocument).toHaveBeenCalledWith("file_123");
    });

    it("does not touch the database when the edit is a no-op (changed: false)", async () => {
      mocks.applyVisualEdit.mockReturnValueOnce({
        result: { status: "applied", changed: false },
        projection: { nodes: [] },
        content: "<main>Hello</main>",
      });

      const result = await action.run({
        source: { kind: "design-file", fileId: "file_123" },
        intent: {
          kind: "style",
          target: { selector: "main" },
          property: "color",
          value: "red",
        },
      });

      expect(result.persisted).toBe(false);
      expect(mocks.updateChain.set).not.toHaveBeenCalled();
    });

    it("surfaces a stale-base error instead of silently overwriting a concurrent collab edit", async () => {
      // Simulate a live collab doc for this file (hasCollabState: true) so
      // readLiveSourceFile's base comes from getText/seededCollabText rather
      // than the SQL-stored content. applyVisualEdit runs synchronously
      // between this action's initial live-content read (which captures
      // `live.versionHash`) and its persist call — mutating the seeded collab
      // text from inside the applyVisualEdit mock models a concurrent
      // writer's change landing in exactly that window, which
      // writeInlineSourceFile's internal re-check must catch and reject
      // rather than silently overwrite.
      mocks.hasCollabState.mockResolvedValue(true);
      mocks.seededCollabText.set("file_123", "<main>Hello</main>");
      mocks.applyVisualEdit.mockImplementationOnce(() => {
        mocks.seededCollabText.set(
          "file_123",
          "<main>Concurrently edited</main>",
        );
        return {
          result: { status: "applied", changed: true },
          projection: { nodes: [] },
          content: "<main>Updated</main>",
        };
      });

      await expect(
        action.run({
          source: { kind: "design-file", fileId: "file_123" },
          intent: {
            kind: "style",
            target: { selector: "main" },
            property: "color",
            value: "red",
          },
        }),
      ).rejects.toThrow(
        "Source file changed since it was read. Re-read the file and retry.",
      );
      expect(mocks.updateChain.set).not.toHaveBeenCalled();
    });
  });
});
