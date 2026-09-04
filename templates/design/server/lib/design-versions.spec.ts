import { beforeEach, describe, expect, it, vi } from "vitest";

const readPrivateBlob = vi.hoisted(() => vi.fn());
const captureMocks = vi.hoisted(() => ({
  revisions: [] as Array<Record<string, unknown>>,
  design: {
    data: JSON.stringify({ breakpointSet: { breakpoints: [] } }),
    title: "Landing page",
    description: null,
    projectType: "prototype",
    designSystemId: "system-1",
    ownerEmail: "owner@example.com",
  },
  liveSnapshot: {
    files: [
      {
        id: "file-1",
        filename: "index.html",
        fileType: "html",
        content: "<main>Hello</main>",
        source: "stored" as const,
      },
    ],
    tweaks: [],
    appliedTweaks: {},
    resolvedCssVars: {},
  },
  assertAccess: vi.fn(),
  buildDesignSnapshot: vi.fn(),
  nanoid: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: vi.fn(),
  readPrivateBlob,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: "agent-client",
  applyText: vi.fn(),
  hasCollabState: vi.fn(),
  loadAwarenessRowsStrict: vi.fn(),
  seedFromText: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: captureMocks.assertAccess,
}));

vi.mock("nanoid", () => ({ nanoid: captureMocks.nanoid }));

vi.mock("../source-workspace.js", () => ({
  withSourceFileWriteLock: async (
    _fileId: string,
    work: () => Promise<unknown>,
  ) => work(),
}));

vi.mock("./design-snapshot.js", () => ({
  buildDesignSnapshot: captureMocks.buildDesignSnapshot,
}));

vi.mock("../db/index.js", () => {
  const schema = {
    designVersions: {
      id: { name: "id" },
      designId: { name: "designId" },
      label: { name: "label" },
      snapshot: { name: "snapshot" },
      chatContext: { name: "chatContext" },
      fileCount: { name: "fileCount" },
      createdAt: { name: "createdAt" },
    },
    designFiles: {},
    designs: {},
  };
  const queryResult = (rows: unknown[]) => {
    const result: any = Promise.resolve(rows);
    result.orderBy = () => result;
    result.limit = (limit: number) => queryResult(rows.slice(0, limit));
    return result;
  };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          queryResult(
            table === schema.designVersions ? captureMocks.revisions : [],
          ),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (value: Record<string, unknown>) => {
        if (table === schema.designVersions) captureMocks.revisions.push(value);
      },
    }),
  };
  return { getDb: () => db, schema };
});

import {
  createDesignVersionSnapshot,
  parseDesignVersionSnapshot,
  readDesignVersionSnapshot,
} from "./design-versions.js";

beforeEach(() => {
  captureMocks.revisions = [];
  captureMocks.assertAccess.mockReset();
  captureMocks.assertAccess.mockImplementation(async () => ({
    resource: { ...captureMocks.design },
  }));
  captureMocks.buildDesignSnapshot.mockReset();
  captureMocks.buildDesignSnapshot.mockImplementation(
    async () => captureMocks.liveSnapshot,
  );
  captureMocks.nanoid.mockReset();
  captureMocks.nanoid.mockImplementation(
    () => `design-version-${captureMocks.revisions.length + 1}`,
  );
});

describe("parseDesignVersionSnapshot", () => {
  it("accepts buildDesignSnapshot files and preserves restore metadata", () => {
    const snapshot = parseDesignVersionSnapshot(
      JSON.stringify({
        designId: "design-1",
        designData: JSON.stringify({ breakpointSet: { breakpoints: [] } }),
        designTitle: "Landing page",
        designDescription: null,
        projectType: "prototype",
        designSystemId: "system-1",
        files: [
          {
            id: "file-1",
            filename: "src/index.html",
            fileType: "html",
            content: "<main>Hello</main>",
            source: "collab",
          },
        ],
        chatContext: { threadId: "thread-1", turnId: "turn-1" },
      }),
      "design-1",
    );

    expect(snapshot).toMatchObject({
      designId: "design-1",
      designTitle: "Landing page",
      designSystemId: "system-1",
      chatContext: { threadId: "thread-1", turnId: "turn-1" },
    });
    expect(snapshot.files).toEqual([
      {
        id: "file-1",
        filename: "src/index.html",
        fileType: "html",
        content: "<main>Hello</main>",
      },
    ]);
  });

  it("rejects snapshots that can cross a design or map two files to one name", () => {
    expect(() =>
      parseDesignVersionSnapshot(
        JSON.stringify({
          designId: "other-design",
          files: [],
        }),
        "design-1",
      ),
    ).toThrow("different design");

    expect(() =>
      parseDesignVersionSnapshot(
        JSON.stringify({
          designId: "design-1",
          files: [
            { filename: "index.html", fileType: "html", content: "one" },
            { filename: "index.html", fileType: "html", content: "two" },
          ],
        }),
        "design-1",
      ),
    ).toThrow("duplicate file");
  });

  it("reads large snapshots through their private blob reference", async () => {
    const handle = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    readPrivateBlob.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          designId: "design-1",
          files: [
            {
              filename: "index.html",
              fileType: "html",
              content: "<main>Restored</main>",
            },
          ],
        }),
      ),
      handle,
    });

    await expect(
      readDesignVersionSnapshot(
        JSON.stringify({
          snapshotKind: "design-history-blob",
          designId: "design-1",
          blob: handle,
        }),
        "design-1",
      ),
    ).resolves.toMatchObject({
      designId: "design-1",
      files: [{ content: "<main>Restored</main>" }],
    });
    expect(readPrivateBlob).toHaveBeenCalledWith(handle);
  });
});

describe("createDesignVersionSnapshot", () => {
  it("coalesces unchanged snapshots but records the next real edit", async () => {
    const first = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });
    const same = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    expect(same).toEqual(first);
    expect(captureMocks.revisions).toHaveLength(1);

    captureMocks.liveSnapshot = {
      ...captureMocks.liveSnapshot,
      files: [
        {
          ...captureMocks.liveSnapshot.files[0],
          content: "<main>Changed</main>",
        },
      ],
    };
    const changed = await createDesignVersionSnapshot("design-1", {
      label: "Chat autosave",
    });

    expect(changed.id).not.toBe(first.id);
    expect(captureMocks.revisions).toHaveLength(2);
  });
});
