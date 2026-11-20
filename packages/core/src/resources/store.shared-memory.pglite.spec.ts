import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import type { Resource } from "./store.js";

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: DbExec = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

const OWNER = "alice@example.test";
const tempDirs: string[] = [];

function useMemoryDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-store-memory-"));
  tempDirs.push(dir);
  vi.stubEnv("AGENT_NATIVE_MEMORY_DIR", dir);
  return dir;
}

function sharedFile(dir: string, name: string) {
  return path.join(dir, encodeURIComponent(OWNER), name);
}

function writeSharedFile(dir: string, name: string, content: string) {
  const file = sharedFile(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = {
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, [...(input.args ?? [])]);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
    transaction: pglite.transaction,
  };
});

afterAll(async () => {
  await pglite.close();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await pglite.exec(`DELETE FROM resources WHERE owner = '${OWNER}'`);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("personal memory shared across local apps", () => {
  it("mirrors writes and deletes of personal memory into the shared directory", async () => {
    const dir = useMemoryDir();
    const { resourceDeleteByPath, resourcePut } = await import("./store.js");

    await resourcePut(OWNER, "memory/wife-contact.md", "wife@example.test\n");
    expect(fs.readFileSync(sharedFile(dir, "wife-contact.md"), "utf8")).toBe(
      "wife@example.test\n",
    );

    await resourcePut(OWNER, "notes/todo.md", "not memory");
    expect(
      fs.existsSync(path.join(dir, encodeURIComponent(OWNER), "todo.md")),
    ).toBe(false);

    await expect(
      resourceDeleteByPath(OWNER, "memory/wife-contact.md"),
    ).resolves.toBe(true);
    expect(fs.existsSync(sharedFile(dir, "wife-contact.md"))).toBe(false);
  });

  it("removes the shared copy when the resource is deleted by id or snapshot", async () => {
    const dir = useMemoryDir();
    const { resourceDelete, resourceDeleteIfCurrent, resourcePut } =
      await import("./store.js");

    const byId = await resourcePut(OWNER, "memory/a.md", "a");
    expect(fs.existsSync(sharedFile(dir, "a.md"))).toBe(true);
    await expect(resourceDelete(byId.id)).resolves.toBe(true);
    expect(fs.existsSync(sharedFile(dir, "a.md"))).toBe(false);

    const bySnapshot = await resourcePut(OWNER, "memory/b.md", "b");
    expect(fs.existsSync(sharedFile(dir, "b.md"))).toBe(true);
    await expect(resourceDeleteIfCurrent(bySnapshot)).resolves.toBe(true);
    expect(fs.existsSync(sharedFile(dir, "b.md"))).toBe(false);
  });

  it("reads a memory another app wrote when this database has no row", async () => {
    const dir = useMemoryDir();
    writeSharedFile(dir, "MEMORY.md", "# Memory Index\n- [x](x.md)\n");
    const { resourceGetByPath } = await import("./store.js");

    const resource = await resourceGetByPath(OWNER, "memory/MEMORY.md");

    expect(resource).toMatchObject({
      owner: OWNER,
      path: "memory/MEMORY.md",
      content: "# Memory Index\n- [x](x.md)\n",
      mimeType: "text/markdown",
      visibility: "workspace",
    });
    const { resourceGet } = await import("./store.js");
    await expect(
      resource ? resourceGet(resource.id) : null,
    ).resolves.toMatchObject({ content: resource?.content });
    await expect(
      resourceGetByPath(OWNER, "memory/missing.md"),
    ).resolves.toBeNull();
  });

  it("prefers whichever copy is newer and replaces an empty index", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");

    const stored = await resourcePut(OWNER, "memory/note.md", "from db");
    const file = writeSharedFile(dir, "note.md", "from shared");
    const future = new Date(stored.updatedAt + 60_000);
    fs.utimesSync(file, future, future);
    const newerShared = await resourceGetByPath(OWNER, "memory/note.md");
    expect(newerShared?.content).toBe("from shared");
    expect(newerShared?.id).toBe(stored.id);

    const rewritten = await resourcePut(OWNER, "memory/note.md", "from db");
    const past = new Date(rewritten.updatedAt - 60_000);
    fs.utimesSync(file, past, past);
    const newerDb = await resourceGetByPath(OWNER, "memory/note.md");
    expect(newerDb?.content).toBe("from db");

    await pglite.exec(
      `UPDATE resources SET content = '# Memory Index', updated_at = ${stored.updatedAt + 600_000} WHERE id = '${stored.id}'`,
    );
    writeSharedFile(dir, "MEMORY.md", "# Memory Index\n- [x](x.md)\n");
    await pglite.exec(
      `INSERT INTO resources (id, path, owner, content, created_at, updated_at, visibility) VALUES ('idx', 'memory/MEMORY.md', '${OWNER}', '# Memory Index', 1, ${Date.now() + 600_000}, 'workspace')`,
    );
    const filled = await resourceGetByPath(OWNER, "memory/MEMORY.md");
    expect(filled?.content).toBe("# Memory Index\n- [x](x.md)\n");
    expect(filled?.id).toBe("idx");

    await pglite.exec(
      `UPDATE resources SET content = '# Memory Index' WHERE id = 'idx'`,
    );
    writeSharedFile(dir, "MEMORY.md", "# Memory Index");
    const stillEmpty = await resourceGetByPath(OWNER, "memory/MEMORY.md");
    expect(stillEmpty?.content).toBe("# Memory Index");
  });

  it("lists shared memories beside stored ones and honours prefix and limit", async () => {
    const dir = useMemoryDir();
    const { resourceList, resourcePut } = await import("./store.js");
    await resourcePut(OWNER, "notes/todo.md", "todo");
    await resourcePut(OWNER, "memory/db-only.md", "db");
    writeSharedFile(dir, "other-app.md", "from another app");

    const memories = await resourceList(OWNER, "memory/");
    expect(memories.map((item) => item.path).sort()).toEqual([
      "memory/db-only.md",
      "memory/other-app.md",
    ]);
    const sharedOnly = memories.find(
      (item) => item.path === "memory/other-app.md",
    );
    expect(sharedOnly).toMatchObject({
      id: `shared-memory:${OWNER}:memory/other-app.md`,
      owner: OWNER,
      mimeType: "text/markdown",
      visibility: "workspace",
    });

    const all = await resourceList(OWNER);
    expect(all.map((item) => item.path).sort()).toEqual([
      "memory/db-only.md",
      "memory/other-app.md",
      "notes/todo.md",
    ]);

    const notes = await resourceList(OWNER, "notes/");
    expect(notes.map((item) => item.path)).toEqual(["notes/todo.md"]);

    const memoryRoot = await resourceList(OWNER, "mem");
    expect(memoryRoot.map((item) => item.path)).toContain(
      "memory/other-app.md",
    );

    const limited = await resourceList(OWNER, "memory/", { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("does nothing special when no shared directory is configured", async () => {
    vi.stubEnv("AGENT_NATIVE_MEMORY_DIR", "");
    const { resourceGetByPath, resourceList, resourcePut } =
      await import("./store.js");
    await resourcePut(OWNER, "memory/solo.md", "solo");
    expect((await resourceGetByPath(OWNER, "memory/solo.md"))?.content).toBe(
      "solo",
    );
    expect((await resourceList(OWNER, "memory/")).map((i) => i.path)).toEqual([
      "memory/solo.md",
    ]);
  });

  it("deletes a memory that exists only as a shared file", async () => {
    const dir = useMemoryDir();
    const file = writeSharedFile(dir, "file-only.md", "only a file");
    const { resourceDeleteByPath } = await import("./store.js");

    await expect(
      resourceDeleteByPath(OWNER, "memory/file-only.md"),
    ).resolves.toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    await expect(
      resourceDeleteByPath(OWNER, "memory/file-only.md"),
    ).resolves.toBe(false);
  });

  it("returns a mirrored read whose revision matches the SQL row", async () => {
    const dir = useMemoryDir();
    const { resourceGet, resourceGetByPath, resourcePut } =
      await import("./store.js");
    await resourcePut(OWNER, "memory/rev.md", "old");
    const file = sharedFile(dir, "rev.md");
    fs.writeFileSync(file, "newer from another app");
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(file, future, future);

    const read = await resourceGetByPath(OWNER, "memory/rev.md");
    const row = read ? await resourceGet(read.id) : null;

    expect(read?.content).toBe("newer from another app");
    expect(row?.content).toBe(read?.content);
  });

  it("does not write or emit events when a read adopts a newer file", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const { getResourcesEmitter } = await import("./emitter.js");
    const stored = await resourcePut(OWNER, "memory/quiet.md", "old");
    const file = sharedFile(dir, "quiet.md");
    fs.writeFileSync(file, "from file");
    const future = new Date(stored.updatedAt + 60_000);
    fs.utimesSync(file, future, future);
    const mtimeBefore = fs.statSync(file).mtimeMs;
    const events: unknown[] = [];
    const onEvent = (event: unknown) => events.push(event);
    getResourcesEmitter().on("resources", onEvent);

    const read = await resourceGetByPath(OWNER, "memory/quiet.md");
    getResourcesEmitter().off("resources", onEvent);

    expect(read?.content).toBe("from file");
    expect(read?.updatedAt).toBe(Math.ceil(mtimeBefore));
    expect(events).toEqual([]);
    expect(fs.statSync(file).mtimeMs).toBe(mtimeBefore);
  });

  it("does not overwrite a SQL write that lands after the row was read", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const stored = await resourcePut(OWNER, "memory/race.md", "old");
    const file = sharedFile(dir, "race.md");
    fs.writeFileSync(file, "from file");
    const future = new Date(stored.updatedAt + 60_000);
    fs.utimesSync(file, future, future);
    await pglite.exec(
      `UPDATE resources SET content = 'newer sql', updated_at = ${stored.updatedAt + 1} WHERE id = '${stored.id}'`,
    );
    const read = await resourceGetByPath(OWNER, "memory/race.md");
    expect(read?.content).toBe("from file");
    await resourcePut(OWNER, "memory/race.md", "latest sql");
    const { rows } = await pglite.query(
      `SELECT content FROM resources WHERE id = '${stored.id}'`,
    );
    expect(rows[0]).toMatchObject({ content: "latest sql" });
  });

  it("honours a delete made through another app's store", async () => {
    useMemoryDir();
    const { resourceGetByPath, resourceList, resourcePut } =
      await import("./store.js");
    const { deleteSharedPersonalMemory } = await import("./shared-memory.js");
    await resourcePut(OWNER, "memory/gone.md", "mirrored row");
    await pglite.exec(
      `UPDATE resources SET updated_at = updated_at - 1000 WHERE owner = '${OWNER}'`,
    );

    await deleteSharedPersonalMemory(OWNER, "memory/gone.md");

    expect(await resourceList(OWNER, "memory/")).toEqual([]);
    await expect(
      resourceGetByPath(OWNER, "memory/gone.md"),
    ).resolves.toBeNull();
    const { rows } = await pglite.query(
      `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/gone.md'`,
    );
    expect(rows).toEqual([]);
    await resourcePut(OWNER, "memory/gone.md", "written again");
    await expect(
      resourceGetByPath(OWNER, "memory/gone.md"),
    ).resolves.toMatchObject({ content: "written again" });
  });

  it("fetches and deletes a listed file-only memory by its id", async () => {
    const dir = useMemoryDir();
    const file = writeSharedFile(dir, "listed.md", "listed only as a file");
    const { resourceDeleteIfCurrent, resourceGet, resourceList } =
      await import("./store.js");
    const listed = await resourceList(OWNER, "memory/");
    const id = `shared-memory:${OWNER}:memory/listed.md`;
    expect(listed.map((item) => item.id)).toEqual([id]);

    await expect(resourceGet(id)).resolves.toBeNull();
    await expect(
      resourceGet(id, { userEmail: "mallory@example.test" }),
    ).resolves.toBeNull();
    const fetched = await resourceGet(id, { userEmail: OWNER });
    expect(fetched?.content).toBe("listed only as a file");
    expect(fetched).not.toBeNull();
    await expect(resourceDeleteIfCurrent(fetched as Resource)).resolves.toBe(
      true,
    );
    expect(fs.existsSync(file)).toBe(false);
  });

  it("never adopts a file that survived a delete", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourceList } = await import("./store.js");
    const file = writeSharedFile(dir, "stale.md", "should stay deleted");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(file, past, past);
    fs.writeFileSync(`${file}.deleted`, String(Date.now()));

    await expect(
      resourceGetByPath(OWNER, "memory/stale.md"),
    ).resolves.toBeNull();
    expect(await resourceList(OWNER, "memory/")).toEqual([]);
    const { rows } = await pglite.query(
      `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/stale.md'`,
    );
    expect(rows).toEqual([]);
  });

  it("skips a mirror write whose SQL revision is no longer current", async () => {
    const dir = useMemoryDir();
    const { resourcePut, resourcePutWithDb } = await import("./store.js");
    const stale = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/guard.md",
      "first",
    );
    await new Promise((resolve) => setImmediate(resolve));
    await resourcePut(OWNER, "memory/guard.md", "second");
    await stale.notifyAfterCommit();

    expect(fs.readFileSync(sharedFile(dir, "guard.md"), "utf8")).toBe("second");
  });

  it("keeps a tombstone when a stale mirror write arrives after a delete", async () => {
    const dir = useMemoryDir();
    const { resourceDeleteByPath, resourcePutWithDb } =
      await import("./store.js");
    const stale = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/late.md",
      "late",
    );
    await resourceDeleteByPath(OWNER, "memory/late.md");
    await stale.notifyAfterCommit();

    expect(fs.existsSync(sharedFile(dir, "late.md"))).toBe(false);
    expect(fs.existsSync(`${sharedFile(dir, "late.md")}.deleted`)).toBe(true);
  });

  it("orders at full precision, prefers SQL on a tie, and never moves updatedAt back", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const stored = await resourcePut(OWNER, "memory/order.md", "sql");
    const file = sharedFile(dir, "order.md");
    fs.writeFileSync(file, "tie");
    const tie = new Date(stored.updatedAt);
    fs.utimesSync(file, tie, tie);
    await expect(
      resourceGetByPath(OWNER, "memory/order.md"),
    ).resolves.toMatchObject({ content: "sql" });

    const sub = stored.updatedAt + 0.5;
    fs.utimesSync(file, sub / 1000, sub / 1000);
    const adopted = await resourceGetByPath(OWNER, "memory/order.md");
    expect(adopted?.content).toBe("tie");
    expect(adopted?.updatedAt).toBeGreaterThanOrEqual(stored.updatedAt);

    await pglite.exec(
      `UPDATE resources SET content = '# Memory Index', updated_at = ${stored.updatedAt + 600_000} WHERE owner = '${OWNER}'`,
    );
    fs.utimesSync(file, tie, tie);
    const empty = await resourcePut(
      OWNER,
      "memory/MEMORY.md",
      "# Memory Index",
    );
    fs.writeFileSync(
      sharedFile(dir, "MEMORY.md"),
      "# Memory Index\n- [x](x.md)\n",
    );
    const filled = await resourceGetByPath(OWNER, "memory/MEMORY.md");
    expect(filled?.updatedAt).toBeGreaterThanOrEqual(empty.updatedAt);
  });

  it("treats a row whose updatedAt equals the tombstone as deleted", async () => {
    useMemoryDir();
    const { resourceGetByPath, resourceList, resourcePut } =
      await import("./store.js");
    const { deleteSharedPersonalMemory } = await import("./shared-memory.js");
    vi.spyOn(Date, "now").mockReturnValue(5_000_000_000_000);
    try {
      await resourcePut(OWNER, "memory/tie.md", "row");
      await deleteSharedPersonalMemory(OWNER, "memory/tie.md");
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
    await pglite.exec(
      `UPDATE resources SET updated_at = 5000000000000 WHERE owner = '${OWNER}'`,
    );
    expect(await resourceList(OWNER, "memory/")).toEqual([]);
    await expect(resourceGetByPath(OWNER, "memory/tie.md")).resolves.toBeNull();
  });

  it("keeps the newer SQL write when an older in-flight mirror runs last", async () => {
    const dir = useMemoryDir();
    const { resourcePutWithDb } = await import("./store.js");
    const first = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/chain.md",
      "first",
    );
    const second = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/chain.md",
      "second",
    );
    await Promise.all([second.notifyAfterCommit(), first.notifyAfterCommit()]);
    expect(fs.readFileSync(sharedFile(dir, "chain.md"), "utf8")).toBe("second");
  });

  it("does not resurrect a memory when a delayed mirror races a delete", async () => {
    const dir = useMemoryDir();
    const { resourceDeleteByPath, resourcePutWithDb } =
      await import("./store.js");
    const pending = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/race-del.md",
      "doomed",
    );
    await Promise.all([
      pending.notifyAfterCommit(),
      resourceDeleteByPath(OWNER, "memory/race-del.md"),
    ]);
    expect(fs.existsSync(sharedFile(dir, "race-del.md"))).toBe(false);
    expect(fs.existsSync(`${sharedFile(dir, "race-del.md")}.deleted`)).toBe(
      true,
    );
  });

  it("hides a tombstoned memory from a read by its SQL id", async () => {
    useMemoryDir();
    const { resourceGet, resourcePut } = await import("./store.js");
    const { deleteSharedPersonalMemory } = await import("./shared-memory.js");
    const stored = await resourcePut(OWNER, "memory/by-id.md", "stale");
    await pglite.exec(
      `UPDATE resources SET updated_at = updated_at - 1000 WHERE id = '${stored.id}'`,
    );
    await deleteSharedPersonalMemory(OWNER, "memory/by-id.md");

    await expect(
      resourceGet(stored.id, { userEmail: OWNER }),
    ).resolves.toBeNull();
    const { rows } = await pglite.query(
      `SELECT id FROM resources WHERE id = '${stored.id}'`,
    );
    expect(rows).toEqual([]);
  });

  it("advances the revision past a same-millisecond tombstone so the new write survives", async () => {
    useMemoryDir();
    const { resourceDeleteByPath, resourceGetByPath, resourcePut } =
      await import("./store.js");
    vi.spyOn(Date, "now").mockReturnValue(5_000_000_000_000);
    try {
      await resourcePut(OWNER, "memory/same-ms.md", "before");
      await resourceDeleteByPath(OWNER, "memory/same-ms.md");
      const again = await resourcePut(OWNER, "memory/same-ms.md", "after");
      expect(again.updatedAt).toBe(5_000_000_000_002);
      await expect(
        resourceGetByPath(OWNER, "memory/same-ms.md"),
      ).resolves.toMatchObject({ content: "after" });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("repairs the file when another process changes SQL during a mirror write", async () => {
    const dir = useMemoryDir();
    const { resourcePutWithDb } = await import("./store.js");
    const first = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/xproc.md",
      "first",
    );
    const realRename = fs.promises.rename.bind(fs.promises);
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockImplementationOnce(async (from, to) => {
        await realRename(from, to);
        await pglite.exec(
          `UPDATE resources SET content = 'second', updated_at = ${first.value.updatedAt + 1} WHERE owner = '${OWNER}' AND path = 'memory/xproc.md'`,
        );
      });
    try {
      await first.notifyAfterCommit();
    } finally {
      rename.mockRestore();
    }
    expect(fs.readFileSync(sharedFile(dir, "xproc.md"), "utf8")).toBe("second");
  });

  it("leaves a tombstone when another process deletes the row during a mirror write", async () => {
    const dir = useMemoryDir();
    const { resourcePutWithDb } = await import("./store.js");
    const first = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/xproc-del.md",
      "doomed",
    );
    const realRename = fs.promises.rename.bind(fs.promises);
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockImplementationOnce(async (from, to) => {
        await realRename(from, to);
        await pglite.exec(
          `DELETE FROM resources WHERE owner = '${OWNER}' AND path = 'memory/xproc-del.md'`,
        );
      });
    try {
      await first.notifyAfterCommit();
    } finally {
      rename.mockRestore();
    }
    expect(fs.existsSync(sharedFile(dir, "xproc-del.md"))).toBe(false);
    expect(fs.existsSync(`${sharedFile(dir, "xproc-del.md")}.deleted`)).toBe(
      true,
    );
  });

  it("fails a delete loudly when the tombstone cannot be written", async () => {
    useMemoryDir();
    const { resourceDeleteByPath, resourcePut } = await import("./store.js");
    const { MemoryTombstoneError } = await import("./shared-memory.js");
    await resourcePut(OWNER, "memory/no-tomb.md", "x");
    const realRename = fs.promises.rename.bind(fs.promises);
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockImplementation(async (from, to) => {
        if (String(to).endsWith(".deleted")) throw new Error("EROFS");
        return realRename(from, to);
      });
    try {
      await expect(
        resourceDeleteByPath(OWNER, "memory/no-tomb.md"),
      ).rejects.toBeInstanceOf(MemoryTombstoneError);
    } finally {
      rename.mockRestore();
    }
  });

  it("emits a delete event when a file-only memory is deleted", async () => {
    const dir = useMemoryDir();
    const { resourceDeleteByPath } = await import("./store.js");
    const { getResourcesEmitter } = await import("./emitter.js");
    writeSharedFile(dir, "only-file.md", "x");
    const events: unknown[] = [];
    const onEvent = (event: unknown) => events.push(event);
    getResourcesEmitter().on("resources", onEvent);
    try {
      await expect(
        resourceDeleteByPath(OWNER, "memory/only-file.md"),
      ).resolves.toBe(true);
    } finally {
      getResourcesEmitter().off("resources", onEvent);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      path: "memory/only-file.md",
      owner: OWNER,
    });
  });

  it("fills a limited list with live memories when earlier rows are tombstoned", async () => {
    const dir = useMemoryDir();
    const { resourceList, resourcePut } = await import("./store.js");
    const { deleteSharedPersonalMemory } = await import("./shared-memory.js");
    for (const name of ["a", "b", "c", "d"]) {
      await resourcePut(OWNER, `memory/lim-${name}.md`, name);
    }
    await pglite.exec(
      `UPDATE resources SET updated_at = updated_at - 1000 WHERE owner = '${OWNER}'`,
    );
    fs.rmSync(sharedFile(dir, "lim-c.md"));
    fs.rmSync(sharedFile(dir, "lim-d.md"));
    await deleteSharedPersonalMemory(OWNER, "memory/lim-a.md");
    await deleteSharedPersonalMemory(OWNER, "memory/lim-b.md");

    const listed = await resourceList(OWNER, "memory/lim-", { limit: 2 });
    expect(listed.map((item) => item.path)).toEqual([
      "memory/lim-c.md",
      "memory/lim-d.md",
    ]);
  });

  it("adopts a newer shared-file edit and rejects the write built on a stale row", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const { MemoryWriteConflictError } = await import("./shared-memory.js");
    const base = await resourcePut(OWNER, "memory/conflict.md", "v1");
    const file = sharedFile(dir, "conflict.md");
    fs.writeFileSync(file, "external edit");
    const later = new Date(base.updatedAt + 60_000);
    fs.utimesSync(file, later, later);

    await expect(
      resourcePut(OWNER, "memory/conflict.md", "v2"),
    ).rejects.toBeInstanceOf(MemoryWriteConflictError);
    expect(fs.readFileSync(file, "utf8")).toBe("external edit");
    await expect(
      resourceGetByPath(OWNER, "memory/conflict.md"),
    ).resolves.toMatchObject({ content: "external edit" });
  });

  it("does not tombstone a memory whose row reappears around the repair", async () => {
    const dir = useMemoryDir();
    const { resourcePutWithDb } = await import("./store.js");
    const first = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/reborn.md",
      "first",
    );
    const realRename = fs.promises.rename.bind(fs.promises);
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockImplementationOnce(async (from, to) => {
        await realRename(from, to);
        await pglite.exec(
          `DELETE FROM resources WHERE owner = '${OWNER}' AND path = 'memory/reborn.md'`,
        );
      })
      .mockImplementationOnce(async (from, to) => {
        await realRename(from, to);
        await pglite.exec(
          `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES ('reborn-id', 'memory/reborn.md', '${OWNER}', 'reborn', 'text/markdown', 6, 1, 2)`,
        );
      });
    try {
      await first.notifyAfterCommit();
    } finally {
      rename.mockRestore();
    }
    expect(fs.readFileSync(sharedFile(dir, "reborn.md"), "utf8")).toBe(
      "reborn",
    );
    expect(fs.existsSync(`${sharedFile(dir, "reborn.md")}.deleted`)).toBe(
      false,
    );
  });

  it("reports a mirror that never settles as a typed repair error", async () => {
    useMemoryDir();
    const { resourcePutWithDb } = await import("./store.js");
    const { MemoryMirrorRepairError, MemoryMirrorStaleError } =
      await import("./shared-memory.js");
    const first = await resourcePutWithDb(
      sharedClient,
      OWNER,
      "memory/churn.md",
      "v0",
    );
    const realRename = fs.promises.rename.bind(fs.promises);
    let revision = first.value.updatedAt;
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockImplementation(async (from, to) => {
        await realRename(from, to);
        revision += 1;
        await pglite.exec(
          `UPDATE resources SET content = 'v${revision}', updated_at = ${revision} WHERE owner = '${OWNER}' AND path = 'memory/churn.md'`,
        );
      });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = await first.notifyAfterCommit().catch((error) => error);
      expect(failure).toBeInstanceOf(MemoryMirrorStaleError);
      expect(failure.committed).toMatchObject({ path: "memory/churn.md" });
      expect(failure.cause).toBeInstanceOf(MemoryMirrorRepairError);
      expect(logged).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(MemoryMirrorRepairError),
      );
    } finally {
      rename.mockRestore();
      logged.mockRestore();
    }
  });

  it("emits a change event for the adopted state before a write conflict is thrown", async () => {
    const dir = useMemoryDir();
    const { resourcePut } = await import("./store.js");
    const { getResourcesEmitter } = await import("./emitter.js");
    const base = await resourcePut(OWNER, "memory/conflict-event.md", "v1");
    const file = sharedFile(dir, "conflict-event.md");
    fs.writeFileSync(file, "external");
    const later = new Date(base.updatedAt + 60_000);
    fs.utimesSync(file, later, later);
    const events: Array<{ path?: string }> = [];
    const onEvent = (event: { path?: string }) => events.push(event);
    getResourcesEmitter().on("resources", onEvent);
    try {
      await expect(
        resourcePut(OWNER, "memory/conflict-event.md", "v2"),
      ).rejects.toThrow();
    } finally {
      getResourcesEmitter().off("resources", onEvent);
    }
    expect(events.map((event) => event.path)).toContain(
      "memory/conflict-event.md",
    );
  });

  it("rejects a first write over an existing shared file when SQL has no row", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const { MemoryWriteConflictError } = await import("./shared-memory.js");
    writeSharedFile(dir, "rowless.md", "from another app");

    await expect(
      resourcePut(OWNER, "memory/rowless.md", "mine"),
    ).rejects.toBeInstanceOf(MemoryWriteConflictError);
    expect(fs.readFileSync(sharedFile(dir, "rowless.md"), "utf8")).toBe(
      "from another app",
    );
    await expect(
      resourceGetByPath(OWNER, "memory/rowless.md"),
    ).resolves.toMatchObject({ content: "from another app" });
  });

  it("applies the newer-edit check to snapshot batch writes", async () => {
    const dir = useMemoryDir();
    const { resourcePut, resourcePutSnapshotBatchIfCurrent } =
      await import("./store.js");
    const a = await resourcePut(OWNER, "memory/batch-a.md", "a1");
    const b = await resourcePut(OWNER, "memory/batch-b.md", "b1");
    const file = sharedFile(dir, "batch-a.md");
    fs.writeFileSync(file, "a-external");
    const later = new Date(a.updatedAt + 60_000);
    fs.utimesSync(file, later, later);

    const results = await resourcePutSnapshotBatchIfCurrent([
      { previous: a, owner: OWNER, path: a.path, content: "a2" },
      { previous: b, owner: OWNER, path: b.path, content: "b2" },
    ]);
    expect(results?.map((entry) => entry.mirror)).toEqual(["conflict", "ok"]);
    expect(results?.[0]?.resource.content).toBe("a-external");
    expect(results?.[1]?.resource.content).toBe("b2");
    expect(fs.readFileSync(file, "utf8")).toBe("a-external");
    expect(fs.readFileSync(sharedFile(dir, "batch-b.md"), "utf8")).toBe("b2");
  });

  it("mirrors a put-if-absent insert and clears the tombstone", async () => {
    const dir = useMemoryDir();
    const { resourceDeleteByPath, resourcePut, resourcePutIfAbsent } =
      await import("./store.js");
    await resourcePut(OWNER, "memory/revive.md", "old");
    await resourceDeleteByPath(OWNER, "memory/revive.md");
    expect(fs.existsSync(`${sharedFile(dir, "revive.md")}.deleted`)).toBe(true);

    const created = await resourcePutIfAbsent(
      OWNER,
      "memory/revive.md",
      "revived",
    );
    expect(created?.content).toBe("revived");
    expect(fs.readFileSync(sharedFile(dir, "revive.md"), "utf8")).toBe(
      "revived",
    );
    expect(fs.existsSync(`${sharedFile(dir, "revive.md")}.deleted`)).toBe(
      false,
    );
  });

  it("stamps the tombstone above a future-dated adopted row so the delete sticks", async () => {
    const dir = useMemoryDir();
    const { resourceDeleteByPath, resourceGetByPath, resourcePut } =
      await import("./store.js");
    const stored = await resourcePut(OWNER, "memory/future.md", "x");
    const future = stored.updatedAt + 3_600_000;
    await pglite.exec(
      `UPDATE resources SET updated_at = ${future} WHERE id = '${stored.id}'`,
    );
    await resourceDeleteByPath(OWNER, "memory/future.md");
    expect(
      Number(
        fs.readFileSync(`${sharedFile(dir, "future.md")}.deleted`, "utf8"),
      ),
    ).toBeGreaterThan(future);
    await expect(
      resourceGetByPath(OWNER, "memory/future.md"),
    ).resolves.toBeNull();
  });

  it("routes single-row conditional writes through the mirror and conflict path", async () => {
    const dir = useMemoryDir();
    const { resourcePut, resourcePutIfCurrent, resourcePutIfSnapshot } =
      await import("./store.js");
    const { MemoryWriteConflictError } = await import("./shared-memory.js");

    const a = await resourcePut(OWNER, "memory/cond-a.md", "a1");
    const written = await resourcePutIfCurrent({
      owner: OWNER,
      path: a.path,
      content: "a2",
      expectedId: a.id,
      expectedUpdatedAt: a.updatedAt,
      expectedContent: a.content,
    });
    expect(written?.content).toBe("a2");
    expect(fs.readFileSync(sharedFile(dir, "cond-a.md"), "utf8")).toBe("a2");

    const b = await resourcePut(OWNER, "memory/cond-b.md", "b1");
    const snap = await resourcePutIfSnapshot({
      previous: b,
      owner: OWNER,
      path: b.path,
      content: "b2",
    });
    expect(snap?.resource.content).toBe("b2");
    expect(fs.readFileSync(sharedFile(dir, "cond-b.md"), "utf8")).toBe("b2");

    const file = sharedFile(dir, "cond-b.md");
    fs.writeFileSync(file, "b-external");
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(file, later, later);
    await expect(
      resourcePutIfSnapshot({
        previous: snap?.resource ?? null,
        owner: OWNER,
        path: b.path,
        content: "b3",
      }),
    ).rejects.toBeInstanceOf(MemoryWriteConflictError);
    expect(fs.readFileSync(file, "utf8")).toBe("b-external");
  });

  describe("delete protocol: tombstone first, then the row", () => {
    type Statement = Parameters<DbExec["execute"]>[0];

    function beforeStatement(pattern: RegExp, hook: () => Promise<void>) {
      const original = sharedClient.execute.bind(sharedClient);
      let fired = false;
      // raw-sql-ok: test wrapper only inspects statement text.
      sharedClient.execute = (async (input: Statement) => {
        const text = typeof input === "string" ? input : input.sql;
        if (!fired && pattern.test(text)) {
          fired = true;
          await hook();
        }
        return original(input);
      }) as DbExec["execute"];
      return () => {
        sharedClient.execute = original;
      };
    }

    it("does not let a read resurrect a memory while it is being deleted", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteByPath, resourceGetByPath, resourcePut } =
        await import("./store.js");
      await resourcePut(OWNER, "memory/gap.md", "keep me dead");
      const realRename = fs.promises.rename.bind(fs.promises);
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          if (String(to).endsWith(".deleted")) {
            await resourceGetByPath(OWNER, "memory/gap.md");
          }
          return realRename(from, to);
        });
      const restore = beforeStatement(/^DELETE FROM resources/, async () => {
        await resourceGetByPath(OWNER, "memory/gap.md");
      });
      try {
        await resourceDeleteByPath(OWNER, "memory/gap.md");
      } finally {
        restore();
        rename.mockRestore();
      }
      await expect(
        resourceGetByPath(OWNER, "memory/gap.md"),
      ).resolves.toBeNull();
      expect(fs.existsSync(sharedFile(dir, "gap.md"))).toBe(false);
      const { rows } = await pglite.query(
        `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/gap.md'`,
      );
      expect(rows).toEqual([]);
    });

    it("stamps a tombstone above a revision written between the floor read and the delete", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteByPath, resourcePut } = await import("./store.js");
      const stored = await resourcePut(OWNER, "memory/race.md", "x");
      const newer = stored.updatedAt + 3_600_000;
      const restore = beforeStatement(/^DELETE FROM resources/, async () => {
        await pglite.query(
          `UPDATE resources SET updated_at = $1 WHERE id = $2`,
          [newer, stored.id],
        );
      });
      try {
        await resourceDeleteByPath(OWNER, "memory/race.md");
      } finally {
        restore();
      }
      expect(
        Number(
          fs.readFileSync(`${sharedFile(dir, "race.md")}.deleted`, "utf8"),
        ),
      ).toBeGreaterThan(newer);
    });

    it("reports a failed SQL delete with a typed error and leaves the memory visible", async () => {
      useMemoryDir();
      const { resourceDeleteByPath, resourceGetByPath, resourcePut } =
        await import("./store.js");
      const { MemoryDeleteFailedError } = await import("./shared-memory.js");
      await resourcePut(OWNER, "memory/sqlfail.md", "still here");
      const restore = beforeStatement(/^DELETE FROM resources/, async () => {
        throw new Error("db down");
      });
      try {
        await expect(
          resourceDeleteByPath(OWNER, "memory/sqlfail.md"),
        ).rejects.toBeInstanceOf(MemoryDeleteFailedError);
      } finally {
        restore();
      }
      await expect(
        resourceGetByPath(OWNER, "memory/sqlfail.md"),
      ).resolves.toMatchObject({ content: "still here" });
    });

    it("keeps a restored memory visible past a newer tombstone when its mirror fails", async () => {
      const dir = useMemoryDir();
      const {
        resourceDeleteByPath,
        resourceGetByPath,
        resourcePut,
        resourceRestoreSnapshotIfCurrent,
      } = await import("./store.js");
      const { MemoryMirrorStaleError } = await import("./shared-memory.js");
      const snapshot = await resourcePut(OWNER, "memory/restore.md", "back");
      await resourceDeleteByPath(OWNER, "memory/restore.md");
      const future = Date.now() + 3_600_000;
      fs.writeFileSync(
        `${sharedFile(dir, "restore.md")}.deleted`,
        String(future),
      );
      const realRename = fs.promises.rename.bind(fs.promises);
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          if (!String(to).endsWith(".deleted")) throw new Error("EROFS");
          return realRename(from, to);
        });
      try {
        await expect(
          resourceRestoreSnapshotIfCurrent(snapshot, null),
        ).rejects.toBeInstanceOf(MemoryMirrorStaleError);
      } finally {
        rename.mockRestore();
      }
      const read = await resourceGetByPath(OWNER, "memory/restore.md");
      expect(read?.content).toBe("back");
      expect(read?.updatedAt).toBeGreaterThan(future);
    });
  });
});
