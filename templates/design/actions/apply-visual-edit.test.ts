import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  }

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
  updateChain.where.mockResolvedValue({ rowsAffected: 1 });

  const db = {
    select: vi.fn(() => fileSelectChain),
    update: vi.fn(() => updateChain),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn(async (callback) => callback(db)),
  };

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
    isNull: vi.fn((value) => ({ isNull: value })),
    applyVisualEdit: vi.fn(),
    agentEnterDocument: vi.fn(),
    agentLeaveDocument: vi.fn(),
    agentUpdateSelection: vi.fn(),
    hasCollabState: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@agent-native/core/collab", () => {
  const seeded = mocks.seededCollabText;
  function makePreparedDoc(docId: string) {
    const doc = {
      content: seeded.get(docId) ?? "",
      getText: vi.fn(() => ({
        toString: () => doc.content,
      })),
    };
    return doc;
  }

  return {
    CollabBaseVersionConflictError: class extends Error {},
    agentEnterDocument: mocks.agentEnterDocument,
    agentLeaveDocument: mocks.agentLeaveDocument,
    agentUpdateSelection: mocks.agentUpdateSelection,
    hasCollabState: mocks.hasCollabState,
    getText: vi.fn(async (docId: string) => seeded.get(docId) ?? ""),
    applyTextToYDoc: vi.fn(
      (doc: { content: string }, _fieldName: string, text: string) => {
        doc.content = text;
        return new Uint8Array(0);
      },
    ),
    withPreparedYDocMutation: vi.fn(
      async (
        docId: string,
        _requestSource: string | undefined,
        callback: (lease: {
          doc: ReturnType<typeof makePreparedDoc>;
          baseVersion: number | null;
          persist: (
            transaction: unknown,
            textSnapshot: string,
          ) => Promise<void>;
        }) => Promise<unknown>,
      ) => {
        const doc = makePreparedDoc(docId);
        return callback({
          doc,
          baseVersion: seeded.has(docId) ? 1 : null,
          persist: async (_transaction, textSnapshot) => {
            seeded.set(docId, textSnapshot);
          },
        });
      },
    ),
    applyText: vi.fn(async (docId: string, text: string) => {
      seeded.set(docId, text);
      return text;
    }),
    seedFromText: vi.fn(async (docId: string, text: string) => {
      if (!seeded.has(docId)) seeded.set(docId, text);
    }),
  };
});

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => mocks.db,
}));

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

vi.mock("../shared/code-layer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/code-layer.js")>()),
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
    mocks.updateChain.where.mockResolvedValue({ rowsAffected: 1 });
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

  it("requires a value for style sets and omits it for style removal", () => {
    const base = {
      source: { kind: "design-file", designId: "design_123" },
      intent: {
        kind: "style",
        target: { selector: "main" },
        property: "color",
      },
    };

    expect(action.schema.safeParse(base).success).toBe(false);
    expect(
      action.schema.safeParse({
        ...base,
        intent: { ...base.intent, operation: "set", value: "red" },
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        ...base,
        intent: { ...base.intent, operation: "remove" },
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        ...base,
        intent: {
          ...base.intent,
          operation: "remove",
          value: "red",
        },
      }).success,
    ).toBe(false);
  });

  it("returns needsAgent for style removal from local JSX", async () => {
    const result = await action.run({
      source: {
        kind: "local-file",
        designId: "design_123",
        connectionId: "connection_123",
        path: "src/App.tsx",
      },
      intent: {
        kind: "style",
        operation: "remove",
        target: { sourceAnchor: { line: 1, column: 1 } },
        property: "color",
      },
    });

    expect(result).toMatchObject({
      result: { status: "needsAgent", changed: false },
      persisted: false,
    });
  });

  it("refuses breakpoint-scoped style removal without changing base or breakpoint CSS", async () => {
    const content =
      '<style>.card{color:tomato}@media(max-width:809px){.card{color:purple}}</style><div class="card" style="color:blue!important;color:green;width:10px"></div>';
    setFiles([
      {
        id: "file_123",
        designId: "design_123",
        filename: "index.html",
        fileType: "html",
        content,
        designData: JSON.stringify({
          breakpointSet: {
            breakpoints: [{ widthPx: 390 }, { widthPx: 810 }],
          },
          screenMetadata: { file_123: { width: 1280 } },
        }),
      },
    ]);

    const result = await action.run({
      source: { kind: "design-file", fileId: "file_123" },
      intent: {
        kind: "style",
        operation: "remove",
        target: { selector: ".card" },
        property: "color",
      },
      activeFrameWidthPx: 390,
      includeContent: true,
      persist: true,
    });

    expect(result).toMatchObject({
      result: { status: "needsAgent", changed: false },
      persisted: false,
      patchedContent: content,
    });
    expect(mocks.applyVisualEdit).not.toHaveBeenCalled();
    expect(mocks.updateChain.set).not.toHaveBeenCalled();
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
  describe("persistence (readLiveSourceFile / writeInlineSourceFile CAS)", () => {
    it("rejects broken stylesheet content before writing SQL or collaborative text", async () => {
      const before =
        "<style>:root{--primary:#0F766E;--accent:#ccfbf1}</style><main>Orbit</main>";
      setFile(before);
      mocks.applyVisualEdit.mockReturnValueOnce({
        result: { status: "applied", changed: true },
        projection: { nodes: [] },
        content: before.replace("--primary:#0F766E;", '--primary:#0F766E;"}]'),
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
      ).rejects.toThrow(/not valid CSS.*Unclosed string/);
      expect(mocks.updateChain.set).not.toHaveBeenCalled();
      expect(mocks.seededCollabText.size).toBe(0);
    });

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
