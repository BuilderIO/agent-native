import { spawnSync } from "node:child_process";
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
  getEnclosingTransactionDbExec: () => undefined,
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

function afterFileRead(file: string, hook: () => void | Promise<void>) {
  const realOpen = fs.promises.open.bind(fs.promises);
  return vi
    .spyOn(fs.promises, "open")
    .mockImplementation(async (target, ...rest) => {
      const handle = await (realOpen as (...a: unknown[]) => Promise<never>)(
        target,
        ...rest,
      );
      if (String(target) !== file) return handle;
      const realRead = handle.readFile.bind(handle);
      handle.readFile = (async (...args: Parameters<typeof realRead>) => {
        const content = await realRead(...args);
        await hook();
        return content;
      }) as typeof handle.readFile;
      return handle;
    });
}

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

  it("does not adopt a delayed mirror of an older revision over newer SQL", async () => {
    useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const { writeSharedPersonalMemory } = await import("./shared-memory.js");

    const older = await resourcePut(OWNER, "memory/late-mirror.md", "older");
    const newer = await resourcePut(OWNER, "memory/late-mirror.md", "newer");
    await writeSharedPersonalMemory(
      OWNER,
      "memory/late-mirror.md",
      "older",
      older.updatedAt,
    );

    const read = await resourceGetByPath(OWNER, "memory/late-mirror.md");
    expect(read?.content).toBe("newer");
    expect(read?.updatedAt).toBe(newer.updatedAt);
  });

  it("never writes a revision below an adopted future one", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");

    const stored = await resourcePut(OWNER, "memory/future.md", "from db");
    const file = writeSharedFile(dir, "future.md", "from shared");
    const future = new Date(stored.updatedAt + 600_000);
    fs.utimesSync(file, future, future);
    const adopted = await resourceGetByPath(OWNER, "memory/future.md");
    expect(adopted?.content).toBe("from shared");

    const next = await resourcePut(OWNER, "memory/future.md", "edited");
    expect(next.updatedAt).toBeGreaterThan(adopted?.updatedAt ?? Infinity);
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
    expect(rows).toHaveLength(1);
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

  it("recovers a row whose delete crashed after its tombstone and before the row delete", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourceList, resourcePut } =
      await import("./store.js");
    const put = await resourcePut(OWNER, "memory/aborted.md", "kept");
    const file = sharedFile(dir, "aborted.md");
    const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
    fs.unlinkSync(file);
    fs.writeFileSync(
      `${file}.deleted`,
      JSON.stringify({
        deletedAt: put.updatedAt + 1,
        state: "pending",
        pid: dead,
      }),
    );

    expect((await resourceList(OWNER, "memory/")).map((r) => r.path)).toEqual([
      "memory/aborted.md",
    ]);
    expect(fs.existsSync(`${file}.deleted`)).toBe(false);
    expect((await resourceGetByPath(OWNER, "memory/aborted.md"))?.content).toBe(
      "kept",
    );
    expect(fs.readFileSync(file, "utf8")).toBe("kept");
  });

  it("keeps hiding a row under a committed or live pending tombstone", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const put = await resourcePut(OWNER, "memory/live.md", "row");
    const file = sharedFile(dir, "live.md");
    fs.unlinkSync(file);
    fs.writeFileSync(
      `${file}.deleted`,
      JSON.stringify({
        deletedAt: put.updatedAt + 1,
        state: "pending",
        pid: process.pid,
      }),
    );
    await expect(
      resourceGetByPath(OWNER, "memory/live.md"),
    ).resolves.toBeNull();
    fs.writeFileSync(`${file}.deleted`, String(put.updatedAt + 1));
    await expect(
      resourceGetByPath(OWNER, "memory/live.md"),
    ).resolves.toBeNull();
    expect(fs.existsSync(`${file}.deleted`)).toBe(true);
  });

  it("does not adopt a file that turned older than the row between the two reads", async () => {
    const dir = useMemoryDir();
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const put = await resourcePut(OWNER, "memory/flip.md", "from sql");
    const file = sharedFile(dir, "flip.md");
    fs.writeFileSync(file, "external edit");
    const future = new Date(put.updatedAt + 60_000);
    fs.utimesSync(file, future, future);
    let reads = 0;
    const spy = afterFileRead(file, () => {
      if (++reads !== 1) return;
      fs.writeFileSync(file, "older edit");
      const past = new Date(put.updatedAt - 60_000);
      fs.utimesSync(file, past, past);
    });
    try {
      const got = await resourceGetByPath(OWNER, "memory/flip.md");
      expect(got?.content).toBe("from sql");
    } finally {
      spy.mockRestore();
    }
    const { rows } = await pglite.query(
      `SELECT content FROM resources WHERE owner = '${OWNER}' AND path = 'memory/flip.md'`,
    );
    expect(rows).toEqual([{ content: "from sql" }]);
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
    expect(rows).toHaveLength(1);
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
          `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES ('reborn-id', 'memory/reborn.md', '${OWNER}', 'reborn', 'text/markdown', 6, 1, ${Date.now() + 3_600_000})`,
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

    it("writes no tombstone and keeps the row when a conditional delete is stale", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteIfCurrent, resourceGetByPath, resourcePut } =
        await import("./store.js");
      const stale = await resourcePut(OWNER, "memory/stale-del.md", "v1");
      await resourcePut(OWNER, "memory/stale-del.md", "v2");
      const realRename = fs.promises.rename.bind(fs.promises);
      const tombstones: string[] = [];
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          if (String(to).endsWith(".deleted")) tombstones.push(String(to));
          return realRename(from, to);
        });
      try {
        await expect(resourceDeleteIfCurrent(stale)).resolves.toBe(false);
      } finally {
        rename.mockRestore();
      }
      expect(tombstones).toEqual([]);
      expect(fs.existsSync(`${sharedFile(dir, "stale-del.md")}.deleted`)).toBe(
        false,
      );
      await expect(
        resourceGetByPath(OWNER, "memory/stale-del.md"),
      ).resolves.toMatchObject({ content: "v2" });
    });

    it("publishes the tombstone inside a transactional delete and keeps it on commit", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteWithDb, resourcePut } = await import("./store.js");
      const stored = await resourcePut(OWNER, "memory/tx-commit.md", "x");
      const tombstone = `${sharedFile(dir, "tx-commit.md")}.deleted`;
      let seenBeforeCommit = false;
      let stateBeforeCommit = "";
      let write: Awaited<ReturnType<typeof resourceDeleteWithDb>> | undefined;
      await sharedClient.transaction?.(async (tx) => {
        write = await resourceDeleteWithDb(tx, stored.id);
        seenBeforeCommit = fs.existsSync(tombstone);
        stateBeforeCommit = JSON.parse(
          fs.readFileSync(tombstone, "utf8"),
        ).state;
      });
      expect(stateBeforeCommit).toBe("pending");
      expect(fs.readFileSync(tombstone, "utf8")).toMatch(/pending/);
      await write?.notifyAfterCommit();
      expect(seenBeforeCommit).toBe(true);
      expect(Number(fs.readFileSync(tombstone, "utf8"))).toBeGreaterThan(
        stored.updatedAt,
      );
    });

    it("removes the pre-commit tombstone and restores the file when the transaction rolls back", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteWithDb, resourceGetByPath, resourcePut } =
        await import("./store.js");
      const stored = await resourcePut(OWNER, "memory/tx-back.md", "keep");
      let write: Awaited<ReturnType<typeof resourceDeleteWithDb>> | undefined;
      let seenBeforeRollback = false;
      await expect(
        sharedClient.transaction?.(async (tx) => {
          write = await resourceDeleteWithDb(tx, stored.id);
          seenBeforeRollback = fs.existsSync(
            `${sharedFile(dir, "tx-back.md")}.deleted`,
          );
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(seenBeforeRollback).toBe(true);
      expect(
        fs.readFileSync(`${sharedFile(dir, "tx-back.md")}.deleted`, "utf8"),
      ).toMatch(/pending/);
      await write?.onRollback?.();
      expect(fs.existsSync(`${sharedFile(dir, "tx-back.md")}.deleted`)).toBe(
        false,
      );
      expect(fs.readFileSync(sharedFile(dir, "tx-back.md"), "utf8")).toBe(
        "keep",
      );
      await expect(
        resourceGetByPath(OWNER, "memory/tx-back.md"),
      ).resolves.toMatchObject({ content: "keep" });
    });

    it("never leaves a tombstone over a live row when the delete and the file restore both fail", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteByPath, resourceGetByPath, resourcePut } =
        await import("./store.js");
      const { MemoryDeleteStateUnknownError } =
        await import("./shared-memory.js");
      await resourcePut(OWNER, "memory/both.md", "alive");
      const realRename = fs.promises.rename.bind(fs.promises);
      let tombstoned = false;
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          if (String(to).endsWith(".deleted")) {
            tombstoned = true;
            return realRename(from, to);
          }
          if (tombstoned) throw new Error("EROFS");
          return realRename(from, to);
        });
      const restore = beforeStatement(/^DELETE FROM resources/, async () => {
        throw new Error("db down");
      });
      try {
        await expect(
          resourceDeleteByPath(OWNER, "memory/both.md"),
        ).rejects.toBeInstanceOf(MemoryDeleteStateUnknownError);
      } finally {
        restore();
        rename.mockRestore();
      }
      expect(fs.existsSync(`${sharedFile(dir, "both.md")}.deleted`)).toBe(
        false,
      );
      await expect(
        resourceGetByPath(OWNER, "memory/both.md"),
      ).resolves.toMatchObject({ content: "alive" });
    });

    it("does not adopt a file whose tombstone is published while it is being read", async () => {
      const dir = useMemoryDir();
      const { resourceGetByPath } = await import("./store.js");
      const file = writeSharedFile(dir, "mid-read.md", "late file");
      const read = afterFileRead(file, () => {
        fs.writeFileSync(`${file}.deleted`, String(Date.now() + 60_000));
      });
      try {
        await expect(
          resourceGetByPath(OWNER, "memory/mid-read.md"),
        ).resolves.toBeNull();
      } finally {
        read.mockRestore();
      }
      const { rows } = await pglite.query(
        `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/mid-read.md'`,
      );
      expect(rows).toEqual([]);
    });

    it("reports a delete as done when the shared file cannot be unlinked", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteByPath, resourceGetByPath, resourcePut } =
        await import("./store.js");
      await resourcePut(OWNER, "memory/unlink.md", "bye");
      const file = sharedFile(dir, "unlink.md");
      const realUnlink = fs.promises.unlink.bind(fs.promises);
      const unlink = vi
        .spyOn(fs.promises, "unlink")
        .mockImplementation(async (target) => {
          if (String(target) === file && fs.existsSync(file)) {
            throw new Error("EBUSY");
          }
          return realUnlink(target);
        });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await expect(
          resourceDeleteByPath(OWNER, "memory/unlink.md"),
        ).resolves.toBe(true);
      } finally {
        unlink.mockRestore();
        log.mockRestore();
      }
      await expect(
        resourceGetByPath(OWNER, "memory/unlink.md"),
      ).resolves.toBeNull();
      const { rows } = await pglite.query(
        `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/unlink.md'`,
      );
      expect(rows).toEqual([]);
    });

    it("keeps the SQL revision when a read finds its own unchanged mirror", async () => {
      const dir = useMemoryDir();
      const { resourceGetByPath, resourcePut } = await import("./store.js");
      const saved = await resourcePut(OWNER, "memory/own.md", "same");
      const later = new Date(saved.updatedAt + 60_000);
      fs.utimesSync(sharedFile(dir, "own.md"), later, later);
      const read = await resourceGetByPath(OWNER, "memory/own.md");
      expect(read?.updatedAt).toBe(saved.updatedAt);
    });

    it("floors a conditional write past a newer tombstone", async () => {
      const dir = useMemoryDir();
      const { resourceGetByPath, resourcePut, resourcePutIfCurrent } =
        await import("./store.js");
      const a = await resourcePut(OWNER, "memory/cond-floor.md", "a1");
      const future = Date.now() + 3_600_000;
      fs.writeFileSync(
        `${sharedFile(dir, "cond-floor.md")}.deleted`,
        String(future),
      );
      const written = await resourcePutIfCurrent({
        owner: OWNER,
        path: a.path,
        content: "a2",
        expectedId: a.id,
        expectedUpdatedAt: a.updatedAt,
        expectedContent: a.content,
      });
      expect(written?.updatedAt).toBeGreaterThan(future);
      await expect(
        resourceGetByPath(OWNER, "memory/cond-floor.md"),
      ).resolves.toMatchObject({ content: "a2" });
    });

    it("rolls back only the tombstone its own transaction published", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteWithDb, resourcePut } = await import("./store.js");
      const { deleteSharedPersonalMemory } = await import("./shared-memory.js");
      const stored = await resourcePut(OWNER, "memory/tx-own.md", "keep");
      const tombstone = `${sharedFile(dir, "tx-own.md")}.deleted`;
      let write: Awaited<ReturnType<typeof resourceDeleteWithDb>> | undefined;
      await expect(
        sharedClient.transaction?.(async (tx) => {
          write = await resourceDeleteWithDb(tx, stored.id);
          await deleteSharedPersonalMemory(
            OWNER,
            "memory/tx-own.md",
            Date.now() + 3_600_000,
          );
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      const newer = fs.readFileSync(tombstone, "utf8");
      await write?.onRollback?.();
      expect(fs.readFileSync(tombstone, "utf8")).toBe(newer);
    });

    it("reports a stale mirror when the follow-up repair fails after the delete committed", async () => {
      useMemoryDir();
      const { resourceDeleteByPath, resourcePut } = await import("./store.js");
      const { MemoryMirrorStaleError } = await import("./shared-memory.js");
      await resourcePut(OWNER, "memory/after.md", "x");
      const restore = beforeStatement(/^DELETE FROM resources/, async () => {
        const deleting = sharedClient.execute;
        // raw-sql-ok: test wrapper only inspects statement text.
        sharedClient.execute = (async (input: Statement) => {
          const text = typeof input === "string" ? input : input.sql;
          if (/^SELECT content, updated_at/.test(text)) {
            throw new Error("db down");
          }
          return deleting(input);
        }) as DbExec["execute"];
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await expect(
          resourceDeleteByPath(OWNER, "memory/after.md"),
        ).rejects.toBeInstanceOf(MemoryMirrorStaleError);
      } finally {
        restore();
        log.mockRestore();
      }
      const { rows } = await pglite.query(
        `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/after.md'`,
      );
      expect(rows).toEqual([]);
    });

    it("clears its own tombstone when a conditional delete matches no row after the precheck", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteIfCurrent, resourceGetByPath, resourcePut } =
        await import("./store.js");
      const stored = await resourcePut(OWNER, "memory/nomatch.md", "v1");
      const restore = beforeStatement(/^DELETE FROM resources/, async () => {
        await pglite.query(
          `UPDATE resources SET content = 'v2', updated_at = updated_at + 1 WHERE id = $1`,
          [stored.id],
        );
      });
      try {
        await expect(resourceDeleteIfCurrent(stored)).resolves.toBe(false);
      } finally {
        restore();
      }
      expect(fs.existsSync(`${sharedFile(dir, "nomatch.md")}.deleted`)).toBe(
        false,
      );
      await expect(
        resourceGetByPath(OWNER, "memory/nomatch.md"),
      ).resolves.toMatchObject({ content: "v2" });
    });

    it("clears the marker when the transactional restamp fails so a rollback cannot hide the row", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteWithDb, resourcePut } = await import("./store.js");
      const stored = await resourcePut(OWNER, "memory/restamp.md", "live");
      const realRename = fs.promises.rename.bind(fs.promises);
      let tombstones = 0;
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          if (String(to).endsWith(".deleted") && ++tombstones > 1) {
            throw new Error("EROFS");
          }
          return realRename(from, to);
        });
      try {
        await expect(
          sharedClient.transaction?.((tx) =>
            resourceDeleteWithDb(tx, stored.id),
          ),
        ).rejects.toThrow("EROFS");
      } finally {
        rename.mockRestore();
      }
      expect(fs.existsSync(`${sharedFile(dir, "restamp.md")}.deleted`)).toBe(
        false,
      );
    });

    it("keeps a write visible when a delete races its tombstone-floor read", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteByPath, resourceGetByPath, resourcePut } =
        await import("./store.js");
      const stored = await resourcePut(OWNER, "memory/floor-race.md", "v1");
      await pglite.exec(
        `UPDATE resources SET updated_at = ${stored.updatedAt + 5_000} WHERE id = '${stored.id}'`,
      );
      await Promise.all([
        resourceDeleteByPath(OWNER, "memory/floor-race.md"),
        resourcePut(OWNER, "memory/floor-race.md", "v2"),
      ]);
      const { rows } = await pglite.query(
        `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/floor-race.md'`,
      );
      const visible = await resourceGetByPath(OWNER, "memory/floor-race.md");
      expect(visible !== null).toBe(rows.length > 0);
      expect(fs.existsSync(sharedFile(dir, "floor-race.md"))).toBe(
        rows.length > 0,
      );
    });

    it("does not overwrite a shared edit installed by another process while this write waits for the lock", async () => {
      const dir = useMemoryDir();
      const { resourceGetByPath, resourcePut } = await import("./store.js");
      const { MemoryWriteConflictError } = await import("./shared-memory.js");
      const stored = await resourcePut(OWNER, "memory/lock-edit.md", "base");
      const file = sharedFile(dir, "lock-edit.md");
      fs.writeFileSync(`${file}.lock`, `${process.pid} ${Date.now()}`);
      const writing = resourcePut(OWNER, "memory/lock-edit.md", "ours");
      const settled = writing.then(
        () => null,
        (error: unknown) => error,
      );
      // fixed-sleep-ok: lets the writer reach the held lock before the foreign edit lands.
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(file, "edited elsewhere");
      const later = new Date(stored.updatedAt + 60_000);
      fs.utimesSync(file, later, later);
      fs.unlinkSync(`${file}.lock`);
      expect(await settled).toBeInstanceOf(MemoryWriteConflictError);
      expect(fs.readFileSync(file, "utf8")).toBe("edited elsewhere");
      await expect(
        resourceGetByPath(OWNER, "memory/lock-edit.md"),
      ).resolves.toMatchObject({ content: "edited elsewhere" });
    });

    it("restores the shared copy when the transactional restamp fails", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteWithDb, resourcePut } = await import("./store.js");
      const stored = await resourcePut(OWNER, "memory/restamp2.md", "live");
      const file = sharedFile(dir, "restamp2.md");
      const realRename = fs.promises.rename.bind(fs.promises);
      let tombstones = 0;
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          if (String(to).endsWith(".deleted") && ++tombstones > 1) {
            throw new Error("EROFS");
          }
          return realRename(from, to);
        });
      try {
        await expect(
          sharedClient.transaction?.((tx) =>
            resourceDeleteWithDb(tx, stored.id),
          ),
        ).rejects.toThrow("EROFS");
      } finally {
        rename.mockRestore();
      }
      expect(fs.existsSync(`${file}.deleted`)).toBe(false);
      expect(fs.readFileSync(file, "utf8")).toBe("live");
    });

    it("reconciles a newer shared-file edit when a memory is read by id", async () => {
      const dir = useMemoryDir();
      const { resourceGet, resourcePut } = await import("./store.js");
      const stored = await resourcePut(OWNER, "memory/by-id-edit.md", "old");
      const file = sharedFile(dir, "by-id-edit.md");
      fs.writeFileSync(file, "edited elsewhere");
      const later = new Date(stored.updatedAt + 60_000);
      fs.utimesSync(file, later, later);
      await expect(
        resourceGet(stored.id, { userEmail: OWNER }),
      ).resolves.toMatchObject({ content: "edited elsewhere" });
    });

    it("emits the event and reports a stale mirror when the autocommit restamp fails", async () => {
      useMemoryDir();
      const { resourceDelete, resourceGetByPath, resourcePut } =
        await import("./store.js");
      const { getResourcesEmitter } = await import("./emitter.js");
      const { MemoryMirrorStaleError } = await import("./shared-memory.js");
      const stored = await resourcePut(OWNER, "memory/auto.md", "x");
      const realRename = fs.promises.rename.bind(fs.promises);
      let tombstones = 0;
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          if (String(to).endsWith(".deleted") && ++tombstones > 1) {
            throw new Error("EROFS");
          }
          return realRename(from, to);
        });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const events: unknown[] = [];
      const onEvent = (event: unknown) => events.push(event);
      getResourcesEmitter().on("resources", onEvent);
      try {
        await expect(resourceDelete(stored.id)).rejects.toBeInstanceOf(
          MemoryMirrorStaleError,
        );
      } finally {
        getResourcesEmitter().off("resources", onEvent);
        rename.mockRestore();
        log.mockRestore();
      }
      expect(events).toHaveLength(1);
      await expect(
        resourceGetByPath(OWNER, "memory/auto.md"),
      ).resolves.toBeNull();
    });

    it("reports a stale mirror when a deleted memory's shared file cannot be removed", async () => {
      const dir = useMemoryDir();
      const { resourceDeleteByPath, resourcePut } = await import("./store.js");
      const { MemoryMirrorStaleError } = await import("./shared-memory.js");
      const { getResourcesEmitter } = await import("./emitter.js");
      await resourcePut(OWNER, "memory/stuck.md", "bye");
      const file = sharedFile(dir, "stuck.md");
      const realUnlink = fs.promises.unlink.bind(fs.promises);
      const realRename = fs.promises.rename.bind(fs.promises);
      const unlink = vi
        .spyOn(fs.promises, "unlink")
        .mockImplementation(async (target) => {
          if (String(target) === file) throw new Error("EBUSY");
          return realUnlink(target);
        });
      const rename = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          if (String(from) === file) throw new Error("EBUSY");
          return realRename(from, to);
        });
      const events: unknown[] = [];
      const onEvent = (event: unknown) => events.push(event);
      getResourcesEmitter().on("resources", onEvent);
      try {
        await expect(
          resourceDeleteByPath(OWNER, "memory/stuck.md"),
        ).rejects.toBeInstanceOf(MemoryMirrorStaleError);
      } finally {
        getResourcesEmitter().off("resources", onEvent);
        unlink.mockRestore();
        rename.mockRestore();
      }
      expect(events).toHaveLength(1);
      const { rows } = await pglite.query(
        `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/stuck.md'`,
      );
      expect(rows).toEqual([]);
    });

    it("does not adopt a file when a delete lands between the read and the insert", async () => {
      const dir = useMemoryDir();
      const { resourceGetByPath } = await import("./store.js");
      const { deleteSharedPersonalMemory } = await import("./shared-memory.js");
      const file = writeSharedFile(dir, "race-adopt.md", "doomed");
      let fired = false;
      const read = afterFileRead(file, async () => {
        if (fired) return;
        fired = true;
        await deleteSharedPersonalMemory(OWNER, "memory/race-adopt.md");
      });
      try {
        await expect(
          resourceGetByPath(OWNER, "memory/race-adopt.md"),
        ).resolves.toBeNull();
      } finally {
        read.mockRestore();
      }
      const { rows } = await pglite.query(
        `SELECT id FROM resources WHERE owner = '${OWNER}' AND path = 'memory/race-adopt.md'`,
      );
      expect(rows).toEqual([]);
    });

    it("confirms a delete whose statement errored after the row was removed", async () => {
      useMemoryDir();
      const { resourceDeleteByPath, resourcePut } = await import("./store.js");
      await resourcePut(OWNER, "memory/ghost.md", "x");
      const restore = beforeStatement(/^DELETE FROM resources/, async () => {
        await pglite.exec(
          `DELETE FROM resources WHERE owner = '${OWNER}' AND path = 'memory/ghost.md'`,
        );
        throw new Error("connection reset");
      });
      try {
        await expect(
          resourceDeleteByPath(OWNER, "memory/ghost.md"),
        ).resolves.toBe(true);
      } finally {
        restore();
      }
    });

    it("reports an unknown outcome when the re-read after a delete error also fails", async () => {
      useMemoryDir();
      const { resourceDeleteByPath, resourcePut } = await import("./store.js");
      const { MemoryDeleteStateUnknownError } =
        await import("./shared-memory.js");
      await resourcePut(OWNER, "memory/unknown.md", "x");
      const restore = beforeStatement(/^DELETE FROM resources/, async () => {
        const deleting = sharedClient.execute;
        // raw-sql-ok: test wrapper only inspects statement text.
        sharedClient.execute = (async (input: Statement) => {
          const text = typeof input === "string" ? input : input.sql;
          if (/^SELECT content, updated_at/.test(text)) {
            throw new Error("db down");
          }
          return deleting(input);
        }) as DbExec["execute"];
        throw new Error("connection reset");
      });
      try {
        await expect(
          resourceDeleteByPath(OWNER, "memory/unknown.md"),
        ).rejects.toBeInstanceOf(MemoryDeleteStateUnknownError);
      } finally {
        restore();
      }
    });

    it("lists memories in order and reads each file at most once", async () => {
      const dir = useMemoryDir();
      const { resourceList, resourcePut } = await import("./store.js");
      const names = ["a", "b", "c", "d"];
      for (const name of names) {
        await resourcePut(OWNER, `memory/order-${name}.md`, name);
      }
      const realRead = fs.promises.readFile.bind(fs.promises);
      const contentReads: string[] = [];
      const read = vi
        .spyOn(fs.promises, "readFile")
        .mockImplementation(async (target, ...rest) => {
          const name = String(target);
          if (name.endsWith(".deleted")) {
            // fixed-sleep-ok: staggers tombstone reads so completion order differs from list order.
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                40 -
                  names.findIndex((n) => name.includes(`order-${n}.md`)) * 10,
              ),
            );
          } else if (name.startsWith(dir)) {
            contentReads.push(name);
          }
          return (realRead as (...a: unknown[]) => Promise<never>)(
            target,
            ...rest,
          );
        });
      try {
        const listed = await resourceList(OWNER, "memory/order-");
        expect(listed.map((meta) => meta.path)).toEqual(
          names.map((name) => `memory/order-${name}.md`),
        );
      } finally {
        read.mockRestore();
      }
      expect(new Set(contentReads).size).toBe(contentReads.length);
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
