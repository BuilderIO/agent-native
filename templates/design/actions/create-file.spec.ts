
import { readFileSync } from "node:fs";

import { QueryClient } from "@tanstack/react-query";
import { transformSync } from "esbuild";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let existingRows: Array<Record<string, unknown>> = [];
  let whereCondition:
    | {
        and?: Array<{ left?: unknown; right?: unknown }>;
        left?: unknown;
        right?: unknown;
      }
    | undefined;

  const matchingRows = () => {
    const conditions =
      whereCondition?.and ?? (whereCondition ? [whereCondition] : []);
    return existingRows.filter((row) =>
      conditions.every((condition) => {
        const column = String(condition.left).split(".").pop();
        return column ? row[column] === condition.right : true;
      }),
    );
  };

  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockImplementation((condition) => {
    whereCondition = condition;
    return selectChain;
  });
  selectChain.limit.mockImplementation(() => Promise.resolve(matchingRows()));
  selectChain.then.mockImplementation((resolve, reject) =>
    Promise.resolve(matchingRows()).then(resolve, reject),
  );

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateChain = { set: vi.fn(), where: vi.fn() };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);
  const update = vi.fn(() => updateChain);

  const tx = {
    select: vi.fn(() => {
      whereCondition = undefined;
      return selectChain;
    }),
    insert,
    update,
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };

  const db = {
    select: vi.fn(() => {
      whereCondition = undefined;
      return selectChain;
    }),
    insert,
    update,
    transaction: vi.fn(async (callback) => callback(tx)),
  };

  let designData: Record<string, unknown> = {};

  return {
    db,
    insert,
    insertValues,
    updateChain,
    setExistingRows: (rows: Array<Record<string, unknown>>) => {
      existingRows = rows;
    },
    getDesignData: () => designData,
    setDesignData: (data: Record<string, unknown>) => {
      designData = data;
    },
    assertAccess: vi.fn().mockResolvedValue(undefined),
    seedFromText: vi.fn().mockResolvedValue(undefined),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
    mutateDesignData: vi.fn(),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/collab", () => ({
  seedFromText: mocks.seedFromText,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
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
    },
    designs: { id: "designs.id" },
  },
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

import { ensureCodeLayerNodeIdsInHtml } from "../shared/code-layer.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";
import action from "./create-file.js";

function loadOptimisticCreatedFileInsertion(queryClient: QueryClient) {
  const source = readFileSync(
    new URL("../app/pages/DesignEditor.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "const optimisticallyInsertCreatedFile = useCallback(",
  );
  const end = source.indexOf("\n  const focusCreatedScreen", start);
  if (start < 0 || end < 0) {
    throw new Error("Could not extract created-file optimistic cache callback");
  }
  const callback = transformSync(source.slice(start, end), {
    loader: "tsx",
    format: "cjs",
  }).code;
  const create = new Function(
    "useCallback",
    "id",
    "queryClient",
    "annotateScreenHtmlForPersist",
    "historyFilesRef",
    `${callback}\nreturn optimisticallyInsertCreatedFile;`,
  );
  return create(
    (value: unknown) => value,
    "design-1",
    queryClient,
    annotateScreenHtmlForPersist,
    { current: [] },
  ) as (args: {
    fileId: string;
    filename: string;
    fileType: "html";
    content: string;
    result?: Record<string, unknown> | null;
  }) => void;
}

describe("create-file: node-id annotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setExistingRows([]);
    mocks.setDesignData({});
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.mutateDesignData.mockImplementation(
      async (options: {
        mutate: (
          current: Record<string, unknown>,
          context: { updatedAt: string },
        ) => Record<string, unknown>;
        isApplied: (current: Record<string, unknown>) => boolean;
      }) => {
        const updatedAt = "2026-09-04T00:00:00.000Z";
        const next = options.mutate(mocks.getDesignData(), { updatedAt });
        mocks.setDesignData(next);
        expect(options.isApplied(next)).toBe(true);
        return { data: next, updatedAt };
      },
    );
  });

  it("stamps missing data-agent-native-node-id attributes on new HTML content", async () => {
    await action.run({
      designId: "design-1",
      filename: "index.html",
      content: "<main><button>Buy</button></main>",
      fileType: "html",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toContain("data-agent-native-node-id");
    expect(insertedValues.content).toContain("<main");
    expect(insertedValues.content).toContain("<button");

    expect(mocks.seedFromText).toHaveBeenCalledWith(
      expect.any(String),
      insertedValues.content,
    );
  });

  it("stamps the body of a new blank screen before persistence", async () => {
    await action.run({
      designId: "design-1",
      filename: "screen-1.html",
      content:
        "<!doctype html><html><head><title>Screen 1</title></head>" +
        '<body data-agent-native-layer-name="Screen 1"></body></html>',
      fileType: "html",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toMatch(
      /<body[^>]*data-agent-native-node-id="[^"]+"/,
    );
  });

  it("keeps optimistic created-screen bytes aligned with the persisted source projection", async () => {
    const rawContent = "<main><button>Buy</button></main>";
    const result = await action.run({
      designId: "design-1",
      filename: "index.html",
      content: rawContent,
      fileType: "html",
    });
    const persisted = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    const queryClient = new QueryClient();
    const queryKey = ["action", "get-design", { id: "design-1" }] as const;
    queryClient.setQueryData(queryKey, {
      files: [] as Array<Record<string, unknown>>,
    });
    const insertOptimistically =
      loadOptimisticCreatedFileInsertion(queryClient);

    try {
      insertOptimistically({
        fileId: result.id,
        filename: "index.html",
        fileType: "html",
        content: rawContent,
        result,
      });
      const optimistic = queryClient
        .getQueryData<{ files: Array<Record<string, unknown>> }>(queryKey)
        ?.files.find((file) => file.id === result.id);
      expect(optimistic?.content).toBe(persisted.content);
      expect(mocks.seedFromText).toHaveBeenCalledWith(
        result.id,
        persisted.content,
      );

      const preparedForSourceIdentity = ensureCodeLayerNodeIdsInHtml(
        String(optimistic?.content),
        { source: { kind: "design-file", fileId: result.id } },
      );
      expect(preparedForSourceIdentity).toEqual({
        content: persisted.content,
        changed: false,
        stamped: 0,
      });
    } finally {
      queryClient.clear();
    }
  });

  it("cancels a pre-create get-design read before inserting the created file", async () => {
    const result = await action.run({
      designId: "design-1",
      filename: "index.html",
      content: "<main><button>Buy</button></main>",
      fileType: "html",
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      },
    });
    const queryKey = ["action", "get-design", { id: "design-1" }] as const;
    const staleResult = {
      id: "design-1",
      files: [{ id: "old-file", filename: "index.html", content: "old" }],
    };
    queryClient.setQueryData(queryKey, staleResult);

    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let resolveRead!: (value: typeof staleResult) => void;
    let requestSignal: AbortSignal | undefined;
    const oldRead = queryClient
      .fetchQuery({
        queryKey,
        staleTime: 0,
        queryFn: ({ signal }) => {
          requestSignal = signal;
          resolveStarted();
          return new Promise<typeof staleResult>((resolve) => {
            resolveRead = resolve;
          });
        },
      })
      .catch((error: unknown) => error);

    try {
      await started;
      const insertOptimistically =
        loadOptimisticCreatedFileInsertion(queryClient);
      insertOptimistically({
        fileId: result.id,
        filename: "index.html",
        fileType: "html",
        content: "<main><button>Buy</button></main>",
        result,
      });

      const immediatelyAfterInsert =
        queryClient
          .getQueryData<{ files: Array<{ id: string }> }>(queryKey)
          ?.files.map((file) => file.id) ?? [];
      const fetchStatusAfterInsert =
        queryClient.getQueryState(queryKey)?.fetchStatus;
      const requestAbortedAfterInsert = requestSignal?.aborted;

      resolveRead(staleResult);
      await oldRead;
      expect(immediatelyAfterInsert).toEqual(["old-file", result.id]);
      expect(
        queryClient
          .getQueryData<{ files: Array<{ id: string }> }>(queryKey)
          ?.files.map((file) => file.id),
      ).toEqual(["old-file", result.id]);
      expect(fetchStatusAfterInsert).toBe("idle");
      expect(requestAbortedAfterInsert).toBe(true);
    } finally {
      resolveRead(staleResult);
      await oldRead;
      queryClient.clear();
    }
  });

  it("is idempotent: does not double-stamp elements that already have a clean id", async () => {
    const alreadyAnnotated =
      '<main data-agent-native-node-id="an-existing"><button>Buy</button></main>';

    await action.run({
      designId: "design-1",
      filename: "index.html",
      content: alreadyAnnotated,
      fileType: "html",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toContain(
      'data-agent-native-node-id="an-existing"',
    );
    expect(
      insertedValues.content.match(/data-agent-native-node-id="an-existing"/g),
    ).toHaveLength(1);
  });

  it("does not annotate non-HTML file types", async () => {
    const cssContent = ".btn { color: red; }";

    await action.run({
      designId: "design-1",
      filename: "styles.css",
      content: cssContent,
      fileType: "css",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toBe(cssContent);
  });

  it("skips head/script/style/template content when annotating a full document", async () => {
    const fullDoc =
      "<!doctype html><html><head><style>.x{color:red}</style>" +
      "<script>const a = 1;</script></head><body><main><section>Hi</section></main></body></html>";

    await action.run({
      designId: "design-1",
      filename: "index.html",
      content: fullDoc,
      fileType: "html",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toContain(
      "<section data-agent-native-node-id=",
    );
    expect(
      insertedValues.content.match(/<style>[\s\S]*?<\/style>/)?.[0],
    ).not.toContain("data-agent-native-node-id");
    expect(
      insertedValues.content.match(/<script>[\s\S]*?<\/script>/)?.[0],
    ).not.toContain("data-agent-native-node-id");
  });
});

describe("create-file: canvas placement and landing URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setExistingRows([]);
    mocks.setDesignData({});
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.mutateDesignData.mockImplementation(
      async (options: {
        mutate: (
          current: Record<string, unknown>,
          context: { updatedAt: string },
        ) => Record<string, unknown>;
        isApplied: (current: Record<string, unknown>) => boolean;
      }) => {
        const updatedAt = "2026-09-04T00:00:00.000Z";
        const next = options.mutate(mocks.getDesignData(), { updatedAt });
        mocks.setDesignData(next);
        expect(options.isApplied(next)).toBe(true);
        return { data: next, updatedAt };
      },
    );
  });

  it("gives a new renderable screen a default desktop placement and an overview landing URL", async () => {
    const result = await action.run({
      designId: "design-1",
      filename: "index.html",
      content: "<main>Todo app</main>",
      fileType: "html",
    });

    expect(mocks.mutateDesignData).toHaveBeenCalledTimes(1);
    const canvasFrames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number; y: number; width: number; height: number }
    >;
    expect(canvasFrames[result.id]).toEqual({
      x: 0,
      y: 0,
      width: 1440,
      height: 1024,
    });
    expect(result.urlPath).toBe(
      `/design/design-1?editorView=overview&screen=${result.id}`,
    );
  });

  it("places a second created screen in the next free row, clear of the first", async () => {
    mocks.setDesignData({
      canvasFrames: { existing: { x: 0, y: 0, width: 1440, height: 1024 } },
    });

    const result = await action.run({
      designId: "design-1",
      filename: "second.html",
      content: "<main>Second screen</main>",
      fileType: "html",
    });

    const canvasFrames = mocks.getDesignData().canvasFrames as Record<
      string,
      { x: number; y: number; width: number; height: number }
    >;
    expect(canvasFrames[result.id]).toEqual({
      x: 0,
      y: 1024 + 96,
      width: 1440,
      height: 1024,
    });
  });

  it("clears the measured height of an existing responsive preview", async () => {
    mocks.setExistingRows([
      {
        id: "existing",
        designId: "design-1",
        filename: "existing.html",
        fileType: "html",
      },
    ]);
    mocks.setDesignData({
      breakpointSet: {
        id: "responsive",
        breakpoints: [{ id: "mobile", widthPx: 390 }],
      },
      screenMetadata: {
        existing: {
          width: 1440,
          height: 900,
          breakpointHeights: { "390": 2200 },
        },
      },
      canvasFrames: {
        existing: { x: 0, y: 0, width: 1440, height: 900 },
      },
    });

    const result = await action.run({
      designId: "design-1",
      filename: "second.html",
      content: "<main>Second screen</main>",
      fileType: "html",
    });

    const canvasFrames = mocks.getDesignData().canvasFrames as Record<
      string,
      { y: number }
    >;
    expect(canvasFrames[result.id]?.y).toBe(2200 + 96);
  });

  it("does not expand the board file into responsive previews", async () => {
    mocks.setExistingRows([
      {
        id: "board",
        designId: "design-1",
        filename: "__board__.html",
        fileType: "html",
      },
    ]);
    mocks.setDesignData({
      breakpointSet: {
        id: "responsive",
        breakpoints: [{ id: "mobile", widthPx: 390 }],
      },
      canvasFrames: {
        board: { x: 0, y: 1000, width: 1440, height: 100, rotation: 90 },
      },
    });

    const result = await action.run({
      designId: "design-1",
      filename: "next.html",
      content: "<main>Next screen</main>",
      fileType: "html",
    });

    const canvasFrames = mocks.getDesignData().canvasFrames as Record<
      string,
      { y: number }
    >;
    expect(canvasFrames[result.id]?.y).toBe(1770 + 96);
  });

  it("does not reserve responsive space for JSX support files", async () => {
    mocks.setExistingRows([
      {
        id: "support",
        designId: "design-1",
        filename: "support.jsx",
        fileType: "jsx",
      },
    ]);
    mocks.setDesignData({
      breakpointSet: {
        id: "responsive",
        breakpoints: [{ id: "mobile", widthPx: 390 }],
      },
      canvasFrames: {
        support: { x: 0, y: 0, width: 1440, height: 100 },
      },
    });

    const result = await action.run({
      designId: "design-1",
      filename: "next.html",
      content: "<main>Next screen</main>",
      fileType: "html",
    });

    const canvasFrames = mocks.getDesignData().canvasFrames as Record<
      string,
      { y: number }
    >;
    expect(canvasFrames[result.id]?.y).toBe(100 + 96);
  });

  it("uses responsive bounds for existing screens without metadata", async () => {
    mocks.setExistingRows([
      {
        id: "screen",
        designId: "design-1",
        filename: "index.html",
        fileType: "html",
      },
    ]);
    mocks.setDesignData({
      breakpointSet: {
        id: "responsive",
        breakpoints: [{ id: "mobile", widthPx: 390 }],
      },
      canvasFrames: {
        screen: { x: 0, y: 1000, width: 1440, height: 100, rotation: 90 },
      },
    });

    const result = await action.run({
      designId: "design-1",
      filename: "next.html",
      content: "<main>Next screen</main>",
      fileType: "html",
    });

    const canvasFrames = mocks.getDesignData().canvasFrames as Record<
      string,
      { y: number }
    >;
    expect(canvasFrames[result.id]?.y).toBeGreaterThan(1770 + 96);
  });

  it("does not place or focus a non-renderable file", async () => {
    const result = await action.run({
      designId: "design-1",
      filename: "styles.css",
      content: ".btn { color: red; }",
      fileType: "css",
    });

    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
    expect(result.renderable).toBe(false);
    expect(result.urlPath).toBeNull();
  });

  it("does not place or focus renderable content that is empty", async () => {
    const result = await action.run({
      designId: "design-1",
      filename: "index.html",
      content: "   ",
      fileType: "html",
    });

    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
    expect(result.renderable).toBe(false);
    expect(result.urlPath).toBeNull();
  });
});
