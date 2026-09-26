import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resourceGetByPath: vi.fn(),
  resourcePutSnapshotBatchIfCurrent: vi.fn(
    async (_writes: any): Promise<any> => null,
  ),
}));

vi.mock("../../resources/store.js", () => ({
  resourceGetByPath: (...args: unknown[]) => mocks.resourceGetByPath(...args),
  resourcePutSnapshotBatchIfCurrent: (...args: unknown[]) =>
    mocks.resourcePutSnapshotBatchIfCurrent(...args),
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
}));

import {
  ensureRequestRunContext,
  runWithRequestContext,
} from "../../server/request-context.js";
import saveMemoryScript from "./save-memory.js";

const owner = "run-owner@example.com";
const args = [
  "--name",
  "coding-style",
  "--type",
  "feedback",
  "--description",
  "Use concise updates",
  "--content",
  "Remember this.",
];

function useResourceStore() {
  const resources = new Map<string, string>();
  const key = (resourceOwner: string, path: string) =>
    `${resourceOwner}:${path}`;
  mocks.resourceGetByPath.mockImplementation(
    async (resourceOwner: string, path: string) => {
      const content = resources.get(key(resourceOwner, path));
      return content === undefined
        ? null
        : { owner: resourceOwner, path, content };
    },
  );
  mocks.resourcePutSnapshotBatchIfCurrent.mockImplementation(
    async (writes: any[]) =>
      writes.map((write) => {
        const previous = resources.get(key(write.owner, write.path));
        resources.set(key(write.owner, write.path), write.content);
        return {
          before: previous === undefined ? null : { content: previous },
          resource: {
            owner: write.owner,
            path: write.path,
            content: write.content,
          },
        };
      }),
  );
  return { key, resources };
}

describe("save-memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_USER_EMAIL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("writes the private personal memory body and index atomically", async () => {
    const { key, resources } = useResourceStore();

    await runWithRequestContext({}, async () => {
      ensureRequestRunContext()!.owner = owner;
      await saveMemoryScript(args);
    });

    const [[writes]] = mocks.resourcePutSnapshotBatchIfCurrent.mock
      .calls as any;
    const [bodyWrite, indexWrite] = writes;
    expect(bodyWrite).toMatchObject({
      owner,
      path: "memory/coding-style.md",
      content: expect.stringContaining("Remember this."),
      previous: null,
    });
    expect(indexWrite).toMatchObject({
      owner,
      path: "memory/MEMORY.md",
      content: expect.stringContaining("- [coding-style](coding-style.md)"),
      previous: null,
    });
    expect(resources.get(key(owner, bodyWrite.path))).toContain(
      "Remember this.",
    );
    expect(resources.get(key(owner, indexWrite.path))).toContain(
      "coding-style",
    );
  });

  it("passes the snapshot-batch write guard through save-memory", async () => {
    useResourceStore();
    const options = { beforeWrite: vi.fn(async () => {}) };

    await runWithRequestContext({}, async () => {
      ensureRequestRunContext()!.owner = owner;
      await saveMemoryScript(args, options);
    });

    expect(mocks.resourcePutSnapshotBatchIfCurrent).toHaveBeenCalledWith(
      expect.any(Array),
      options,
    );
  });

  it("writes multiple entries and their index in one transaction", async () => {
    const { key, resources } = useResourceStore();

    await runWithRequestContext({ orgId: "org-a" }, async () => {
      ensureRequestRunContext()!.owner = owner;
      await saveMemoryScript([...args, "--scope", "current-org"], {
        additionalEntries: [
          {
            name: "query-dialect",
            type: "reference",
            description: "Use the right SQL dialect",
            content: "Postgres uses ILIKE for case-insensitive matching.",
          },
        ],
      });
    });

    const [[writes]] = mocks.resourcePutSnapshotBatchIfCurrent.mock
      .calls as any;
    const orgOwner = "__organization__:org-a";
    expect(writes).toHaveLength(3);
    expect(writes.map((write: any) => write.path)).toEqual([
      "memory/coding-style.md",
      "memory/query-dialect.md",
      "memory/MEMORY.md",
    ]);
    expect(writes[2].content).toContain(
      "- [coding-style](coding-style.md) — Use concise updates",
    );
    expect(writes[2].content).toContain(
      "- [query-dialect](query-dialect.md) — Use the right SQL dialect",
    );
    expect(writes.every((write: any) => write.owner === orgOwner)).toBe(true);
    expect(resources.get(key(orgOwner, "memory/query-dialect.md"))).toContain(
      "Postgres uses ILIKE",
    );
    expect(mocks.resourcePutSnapshotBatchIfCurrent).toHaveBeenCalledTimes(1);
  });

  it("writes current-organization memories to the org resource scope", async () => {
    const { key, resources } = useResourceStore();

    await runWithRequestContext({ orgId: "org-a" }, async () => {
      ensureRequestRunContext()!.owner = owner;
      await saveMemoryScript([...args, "--scope", "current-org"]);
    });

    const [[writes]] = mocks.resourcePutSnapshotBatchIfCurrent.mock
      .calls as any;
    const [bodyWrite, indexWrite] = writes;
    const orgOwner = "__organization__:org-a";
    expect(bodyWrite).toMatchObject({
      owner: orgOwner,
      path: "memory/coding-style.md",
    });
    expect(indexWrite).toMatchObject({
      owner: orgOwner,
      path: "memory/MEMORY.md",
    });
    expect(resources.get(key(orgOwner, bodyWrite.path))).toContain(
      "Remember this.",
    );
    expect(resources.get(key(orgOwner, indexWrite.path))).toContain(
      "coding-style",
    );
    expect(resources.get(key(owner, "memory/coding-style.md"))).toBeUndefined();
    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      orgOwner,
      "memory/MEMORY.md",
      { orgId: "org-a" },
    );
  });

  it("requires an active org before writing current-org memory", async () => {
    await expect(
      runWithRequestContext({}, async () => {
        ensureRequestRunContext()!.owner = owner;
        await saveMemoryScript([...args, "--scope", "current-org"]);
      }),
    ).rejects.toThrow("--scope current-org requires an active organization");
    expect(mocks.resourcePutSnapshotBatchIfCurrent).not.toHaveBeenCalled();
  });

  it("does not claim success when the committed batch omits a write", async () => {
    mocks.resourceGetByPath.mockResolvedValue(null);
    mocks.resourcePutSnapshotBatchIfCurrent.mockResolvedValue([
      { before: null, resource: { content: "" } },
      { before: null, resource: { content: "# Memory Index\n" } },
    ]);

    await expect(
      runWithRequestContext({}, async () => {
        ensureRequestRunContext()!.owner = owner;
        await saveMemoryScript(args);
      }),
    ).rejects.toThrow("could not verify the committed memory batch");
  });

  it("does not fail when another save updates the index after this batch commits", async () => {
    const { key, resources } = useResourceStore();
    const save =
      mocks.resourcePutSnapshotBatchIfCurrent.getMockImplementation()!;
    mocks.resourcePutSnapshotBatchIfCurrent.mockImplementationOnce(
      async (writes: any[]) => {
        const committed = await save(writes);
        resources.set(
          key(owner, "memory/MEMORY.md"),
          "# Memory Index\n- [other](other.md) — Other guidance\n",
        );
        return committed;
      },
    );

    await expect(
      runWithRequestContext({}, async () => {
        ensureRequestRunContext()!.owner = owner;
        await saveMemoryScript(args);
      }),
    ).resolves.toBeUndefined();
    expect(resources.get(key(owner, "memory/MEMORY.md"))).toContain("other");
  });

  it("surfaces failures from the atomic batch transaction", async () => {
    useResourceStore();
    mocks.resourcePutSnapshotBatchIfCurrent.mockRejectedValueOnce(
      new Error("transaction unavailable"),
    );

    await expect(
      runWithRequestContext({}, async () => {
        ensureRequestRunContext()!.owner = owner;
        await saveMemoryScript(args);
      }),
    ).rejects.toThrow("transaction unavailable");
  });

  it("does not write either resource when an index read fails", async () => {
    mocks.resourceGetByPath.mockRejectedValue(new Error("storage unavailable"));

    await expect(
      runWithRequestContext({}, async () => {
        ensureRequestRunContext()!.owner = owner;
        await saveMemoryScript(args);
      }),
    ).rejects.toThrow("storage unavailable");
    expect(mocks.resourcePutSnapshotBatchIfCurrent).not.toHaveBeenCalled();
  });

  it("can save a memory without logging its user-authored description", async () => {
    useResourceStore();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runWithRequestContext({}, async () => {
      ensureRequestRunContext()!.owner = owner;
      await saveMemoryScript([...args, "--quiet", "true"]);
    });

    expect(log).not.toHaveBeenCalled();
  });

  it("re-reads and merges the index after a concurrent update", async () => {
    const { key, resources } = useResourceStore();
    const save =
      mocks.resourcePutSnapshotBatchIfCurrent.getMockImplementation()!;
    mocks.resourcePutSnapshotBatchIfCurrent
      .mockImplementationOnce(async () => {
        resources.set(
          key(owner, "memory/MEMORY.md"),
          "# Memory Index\n- [other](other.md) — Other guidance\n",
        );
        return null;
      })
      .mockImplementation(save);

    await runWithRequestContext({}, async () => {
      ensureRequestRunContext()!.owner = owner;
      await saveMemoryScript(args);
    });

    const secondWrites = mocks.resourcePutSnapshotBatchIfCurrent.mock
      .calls[1]?.[0] as any[];
    expect(secondWrites[1]).toMatchObject({
      path: "memory/MEMORY.md",
      content: expect.stringContaining("- [other](other.md) — Other guidance"),
      previous: expect.objectContaining({
        content: "# Memory Index\n- [other](other.md) — Other guidance\n",
      }),
    });
    expect(resources.get(key(owner, "memory/MEMORY.md"))).toContain(
      "coding-style",
    );
    expect(resources.get(key(owner, "memory/MEMORY.md"))).toContain("other");
  });
});
