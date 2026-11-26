import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { restorePathForTrashedSkill, SKILL_TRASH_PREFIX } from "./metadata.js";

const emitResourceChange = vi.hoisted(() => vi.fn());

vi.mock("./emitter.js", () => ({
  emitResourceChange,
  emitResourceDelete: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(run: () => Promise<T>) => run(),
}));

interface FrameworkClient {
  execute(input: string | { sql: string; args?: unknown[] }): Promise<{
    rows: Record<string, unknown>[];
    rowsAffected: number;
  }>;
}

function frameworkClientFor(
  client: Awaited<ReturnType<typeof createTestPglite>>["db"],
): FrameworkClient {
  return {
    async execute(input) {
      if (typeof input === "string") {
        await client.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      let parameter = 0;
      const result = await client.query(
        input.sql.replace(/\?/g, () => `$${++parameter}`),
        input.args ?? [],
      );
      return {
        rows: Array.from(result.rows ?? []) as Record<string, unknown>[],
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
  };
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = frameworkClientFor(pglite.db);
});

afterAll(async () => {
  await pglite.close();
});

const {
  resourceGet,
  resourceList,
  resourceMoveIfCurrent,
  resourcePut,
  WORKSPACE_OWNER,
  workspaceResourceOwner,
} = await import("./store.js");

const OWNER = "conditional-move-owner@example.test";

describe("resourceMoveIfCurrent", () => {
  it("leaves a resource in place when its content snapshot is stale", async () => {
    const original = await resourcePut(
      OWNER,
      "notes/stale-source.md",
      "version one",
    );
    await resourcePut(OWNER, original.path, "version two");
    emitResourceChange.mockClear();

    expect(
      await resourceMoveIfCurrent(original, "trash/stale-source.md"),
    ).toBeNull();
    expect(await resourceGet(original.id)).toMatchObject({
      path: original.path,
      content: "version two",
    });
    expect(emitResourceChange).not.toHaveBeenCalled();
  });

  it("compares metadata even when the timestamp and content are unchanged", async () => {
    const original = await resourcePut(
      OWNER,
      "notes/metadata-source.md",
      "unchanged bytes",
      undefined,
      { metadata: { revision: 1 } },
    );
    await pglite.query("UPDATE resources SET metadata = ? WHERE id = ?", [
      JSON.stringify({ revision: 2 }),
      original.id,
    ]);
    emitResourceChange.mockClear();

    expect(
      await resourceMoveIfCurrent(original, "trash/metadata-source.md"),
    ).toBeNull();
    expect(await resourceGet(original.id)).toMatchObject({
      path: original.path,
      content: original.content,
      metadata: JSON.stringify({ revision: 2 }),
    });
    expect(emitResourceChange).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing destination", async () => {
    const source = await resourcePut(
      OWNER,
      "notes/collision-source.md",
      "source bytes",
    );
    const destination = await resourcePut(
      OWNER,
      "trash/collision-target.md",
      "destination bytes",
    );
    emitResourceChange.mockClear();

    expect(await resourceMoveIfCurrent(source, destination.path)).toBeNull();
    expect(await resourceGet(source.id)).toMatchObject({
      path: source.path,
      content: source.content,
    });
    expect(await resourceGet(destination.id)).toMatchObject({
      path: destination.path,
      content: destination.content,
    });
    expect(emitResourceChange).not.toHaveBeenCalled();
  });

  it("requires the snapshot owner and path to match the stored row", async () => {
    const source = await resourcePut(
      OWNER,
      "notes/identity-source.md",
      "source bytes",
    );
    emitResourceChange.mockClear();

    expect(
      await resourceMoveIfCurrent(
        { ...source, owner: "another-owner@example.test" },
        "trash/identity-source.md",
      ),
    ).toBeNull();
    expect(
      await resourceMoveIfCurrent(
        { ...source, path: "notes/other-source.md" },
        "trash/identity-source.md",
      ),
    ).toBeNull();
    expect(await resourceGet(source.id)).toMatchObject({
      owner: OWNER,
      path: source.path,
      content: source.content,
    });
    expect(emitResourceChange).not.toHaveBeenCalled();
  });

  it("rejects local and organization workspace owners", async () => {
    const source = await resourcePut(
      OWNER,
      "notes/workspace-rejection-source.md",
      "source bytes",
    );
    emitResourceChange.mockClear();

    await expect(
      resourceMoveIfCurrent(
        { ...source, owner: WORKSPACE_OWNER },
        "trash/workspace-rejection-source.md",
      ),
    ).rejects.toThrow("Workspace resources cannot be moved");
    await expect(
      resourceMoveIfCurrent(
        { ...source, owner: workspaceResourceOwner("synthetic-org") },
        "trash/workspace-rejection-source.md",
      ),
    ).rejects.toThrow("Workspace resources cannot be moved");
    expect(await resourceGet(source.id)).toMatchObject({
      owner: OWNER,
      path: source.path,
      content: source.content,
    });
    expect(emitResourceChange).not.toHaveBeenCalled();
  });

  it("returns the persisted row after a successful move", async () => {
    const source = await resourcePut(
      OWNER,
      "notes/success-source.md",
      "source bytes",
      "text/plain",
      { metadata: { label: "kept" } },
    );
    emitResourceChange.mockClear();

    const moved = await resourceMoveIfCurrent(
      source,
      "archive/success-source.md",
    );
    if (!moved) throw new Error("Expected the current resource to move");

    expect(moved).toMatchObject({
      id: source.id,
      owner: OWNER,
      path: "archive/success-source.md",
      content: source.content,
      mimeType: source.mimeType,
      metadata: source.metadata,
    });
    expect(moved.updatedAt).toBeGreaterThan(source.updatedAt);
    expect(await resourceGet(source.id)).toEqual(moved);
    expect(emitResourceChange).toHaveBeenCalledTimes(1);
    expect(emitResourceChange).toHaveBeenCalledWith(
      source.id,
      "archive/success-source.md",
      OWNER,
    );
  });

  it("round-trips through Trash without changing bytes or resource identity", async () => {
    const source = await resourcePut(
      OWNER,
      "agents/trash-roundtrip.md",
      "---\nname: Keep bytes\n---\nUnicode payload: café 東京",
      "text/markdown",
      { metadata: { retained: true } },
    );
    emitResourceChange.mockClear();

    const trashed = await resourceMoveIfCurrent(
      source,
      `trash/agents/${source.id}.md`,
    );
    if (!trashed) throw new Error("Expected the current resource to move");
    const restored = await resourceMoveIfCurrent(trashed, source.path);
    if (!restored) throw new Error("Expected the trashed resource to restore");

    expect(restored).toMatchObject({
      id: source.id,
      owner: source.owner,
      path: source.path,
      content: source.content,
      mimeType: source.mimeType,
      metadata: source.metadata,
    });
    expect(restored.updatedAt).toBeGreaterThan(trashed.updatedAt);
    expect(await resourceGet(source.id)).toEqual(restored);
    expect(emitResourceChange).toHaveBeenCalledTimes(2);
  });

  it("lists a removed skill only in Trash and preserves it on a restore collision", async () => {
    const source = await resourcePut(
      OWNER,
      "skills/review/SKILL.md",
      "Review a task",
      "text/markdown",
      { metadata: { retained: true } },
    );
    const trashPath = `${SKILL_TRASH_PREFIX}${source.id}/${source.path}`;
    const trashed = await resourceMoveIfCurrent(source, trashPath);
    if (!trashed) throw new Error("Expected the skill to move to Trash");
    expect(restorePathForTrashedSkill(trashed)).toBe(source.path);
    expect(await resourceList(OWNER)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: source.id })]),
    );
    expect(await resourceList(OWNER, SKILL_TRASH_PREFIX)).toEqual([
      expect.objectContaining({ id: source.id, path: trashPath }),
    ]);
    expect(
      await resourceList("other-skill-owner@example.test", SKILL_TRASH_PREFIX),
    ).toEqual([]);

    const replacement = await resourcePut(OWNER, source.path, "New skill");
    expect(await resourceMoveIfCurrent(trashed, source.path)).toBeNull();
    expect(await resourceGet(replacement.id)).toMatchObject({
      content: "New skill",
    });
    expect(await resourceGet(source.id)).toEqual(trashed);
  });

  it("rejects unsafe destination paths", async () => {
    const source = await resourcePut(
      OWNER,
      "notes/unsafe-path-source.md",
      "source bytes",
    );

    await expect(
      resourceMoveIfCurrent(source, "../outside.md"),
    ).rejects.toThrow("Invalid resource path");
    await expect(
      resourceMoveIfCurrent(source, "notes\\outside.md"),
    ).rejects.toThrow("Invalid resource path");
  });
});
