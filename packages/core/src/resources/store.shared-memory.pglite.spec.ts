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
      expect(again.updatedAt).toBe(5_000_000_000_001);
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
});
