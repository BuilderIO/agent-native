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
      id: `shared-memory:${OWNER}:memory/MEMORY.md`,
      owner: OWNER,
      path: "memory/MEMORY.md",
      content: "# Memory Index\n- [x](x.md)\n",
      mimeType: "text/markdown",
      visibility: "workspace",
    });
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

    const past = new Date(stored.updatedAt - 60_000);
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
    expect(stillEmpty?.updatedAt).toBeGreaterThan(Date.now());
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
});
