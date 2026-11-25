import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { runWithRequestContext } from "../server/request-context.js";

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

const session = vi.hoisted(() => ({
  email: "erin@example.test",
  orgId: null as string | null,
}));

vi.mock("../server/auth.js", () => ({
  getSession: async () => ({ email: session.email }),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: async () => ({
    email: session.email,
    orgId: session.orgId,
    orgName: null,
    role: session.orgId ? "owner" : null,
  }),
}));

vi.mock("../org/orgless-access.js", () => ({
  canManageDeploymentWithoutOrg: () => true,
}));

vi.mock("../automations/service.js", () => ({
  canUpdateAutomationResource: async () => true,
}));

let status = 200;

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  readBody: async (event: { body?: unknown }) => event.body,
  readMultipartFormData: async (event: { parts?: unknown }) => event.parts,
  getRouterParam: (event: { params?: Record<string, string> }, key: string) =>
    event.params?.[key],
  setResponseStatus: (_event: unknown, code: number) => {
    status = code;
  },
}));

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: DbExec = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

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
  const { ensureResourceStoreReady } = await import("./store.js");
  await ensureResourceStoreReady();
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  session.orgId = null;
  status = 200;
  await pglite.exec(`DELETE FROM resources`);
});

type Body = Record<string, unknown>;

async function create(body: Body) {
  const { handleCreateResource } = await import("./handlers.js");
  status = 200;
  const result = (await handleCreateResource({ body })) as Body;
  return { status, body: result };
}

async function upload(name: string, content: string, shared = false) {
  const { handleUploadResource } = await import("./handlers.js");
  status = 200;
  const result = (await handleUploadResource({
    parts: [
      {
        name: "file",
        filename: name,
        type: "text/markdown",
        data: Buffer.from(content),
      },
      { name: "shared", data: Buffer.from(shared ? "true" : "false") },
    ],
  })) as Body;
  return { status, body: result };
}

async function rename(id: string, path: string) {
  const { handleUpdateResource } = await import("./handlers.js");
  status = 200;
  const result = (await handleUpdateResource({
    params: { id },
    body: { path },
  })) as Body;
  return { status, body: result };
}

async function stored(owner: string) {
  const result = await pglite.query<{ path: string; content: string }>(
    `SELECT path, content FROM resources WHERE owner = $1 ORDER BY path`,
    [owner],
  );
  return result.rows.map((row) => [row.path, row.content]);
}

async function seed(id: string, owner: string, path: string, content: string) {
  await pglite.query(
    `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'text/markdown', $5, 1, 1)`,
    [id, path, owner, content, Buffer.byteLength(content)],
  );
}

async function uploadAt(path: string, content: string) {
  const { handleUploadResource } = await import("./handlers.js");
  status = 200;
  const result = (await handleUploadResource({
    parts: [
      {
        name: "file",
        filename: "notes.md",
        type: "text/markdown",
        data: Buffer.from(content),
      },
      { name: "path", data: Buffer.from(path) },
    ],
  })) as Body;
  return { status, body: result };
}

const owner = "erin@example.test";

describe("making a name from the Resources panel", () => {
  it("numbers an upload whose name a created file already has", async () => {
    await create({ path: "notes.md", content: "", shared: false });
    const uploaded = await upload("notes.md", "uploaded text");

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.path).toBe("notes-2.md");
    expect(await stored(owner)).toEqual([
      ["notes-2.md", "uploaded text"],
      ["notes.md", ""],
    ]);
  });

  it("gives a created file a free name when an upload already holds it", async () => {
    await upload("notes.md", "uploaded text");
    const created = await create({
      path: "notes.md",
      content: "",
      shared: false,
      uniquePath: true,
    });

    expect(created.status).toBe(201);
    expect(created.body.path).toBe("notes-2.md");
    expect(await stored(owner)).toEqual([
      ["notes-2.md", ""],
      ["notes.md", "uploaded text"],
    ]);
  });

  it("stores an upload's explicit path without its leading slashes", async () => {
    const uploaded = await uploadAt("//docs/notes.md", "text");

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.path).toBe("docs/notes.md");
    expect(await stored(owner)).toEqual([["docs/notes.md", "text"]]);
  });

  it("refuses an upload whose path is only slashes", async () => {
    const uploaded = await uploadAt("/", "text");

    expect(uploaded.status).toBe(400);
    expect(await stored(owner)).toEqual([]);
  });

  it("counts a file stored under '/notes.md' before this change as taken", async () => {
    await seed("old", owner, "/notes.md", "old upload");

    const created = await create({
      path: "notes.md",
      content: "",
      uniquePath: true,
    });
    const uploaded = await upload("notes.md", "new upload");

    expect(created.body.path).toBe("notes-2.md");
    expect(uploaded).toMatchObject({
      status: 201,
      body: { path: "notes-3.md" },
    });
    expect(await stored(owner)).toEqual([
      ["/notes.md", "old upload"],
      ["notes-2.md", ""],
      ["notes-3.md", "new upload"],
    ]);
  });

  it("always creates a new file with uniquePath, even onto an empty one", async () => {
    await seed("empty", owner, "notes.md", "");
    await seed("empty-2", owner, "notes-2.md", "");

    const first = await create({
      path: "/notes.md",
      content: "",
      uniquePath: true,
    });

    expect(first).toMatchObject({ status: 201, body: { path: "notes-3.md" } });
    expect(first.body.id).not.toBe("empty");
    expect(first.body.id).not.toBe("empty-2");
    expect((await stored(owner)).map(([path]) => path)).toEqual([
      "notes-2.md",
      "notes-3.md",
      "notes.md",
    ]);
  });

  it("returns an upload resent with the same content instead of storing it again", async () => {
    const first = await upload("notes.md", "same");
    const again = await upload("notes.md", "same");

    expect(again).toMatchObject({ status: 200, body: { id: first.body.id } });
    expect(await stored(owner)).toEqual([["notes.md", "same"]]);
  });

  it("keeps a create without uniquePath replacing the file there, as before", async () => {
    const existing = await create({ path: "notes.md", content: "existing" });
    const replaced = await create({ path: "notes.md", content: "" });

    expect(replaced.body.id).toBe(existing.body.id);
    expect(await stored(owner)).toEqual([["notes.md", ""]]);
  });

  it("refuses a rename onto the other spelling of a taken name", async () => {
    await seed("old", owner, "/notes.md", "old upload");
    await seed("todo", owner, "todo.md", "todo");
    const slashed = await create({ path: "a.md", content: "a" });
    const plain = await create({ path: "b.md", content: "b" });

    const ontoLegacy = await rename(String(plain.body.id), "notes.md");
    const ontoPlain = await rename(String(slashed.body.id), "/todo.md");

    expect(ontoLegacy.status).toBe(409);
    expect(ontoLegacy.body).toMatchObject({
      errorCode: "name_taken",
      details: { suggestion: "notes-2.md" },
    });
    expect(ontoPlain.status).toBe(409);
    expect(ontoPlain.body).toMatchObject({
      errorCode: "name_taken",
      details: { suggestion: "todo-2.md" },
    });
    expect(await stored(owner)).toEqual([
      ["/notes.md", "old upload"],
      ["a.md", "a"],
      ["b.md", "b"],
      ["todo.md", "todo"],
    ]);
  });

  it("keeps a rename that only adds or drops the leading slash on the same file", async () => {
    await seed("old", owner, "/notes.md", "old upload");

    const renamed = await rename("old", "notes.md");

    expect(renamed.status).toBe(200);
    expect(await stored(owner)).toEqual([["/notes.md", "old upload"]]);
  });

  it("stores a shared upload in an organization under the created file's form", async () => {
    session.orgId = "org-1";
    const orgOwner = "__organization__:org-1";
    await create({ path: "team.md", content: "", shared: true });
    const uploaded = await upload("team.md", "uploaded", true);

    expect(uploaded.body.path).toBe("team-2.md");
    expect(await stored(orgOwner)).toEqual([
      ["team-2.md", "uploaded"],
      ["team.md", ""],
    ]);
  });

  it("counts a slashed shared file from before organizations as taken", async () => {
    session.orgId = "org-1";
    await seed("legacy", "__shared__", "/team.md", "pre-org");

    const uploaded = await upload("team.md", "uploaded", true);

    expect(uploaded.body.path).toBe("team-2.md");
    expect(await stored("__shared__")).toEqual([["/team.md", "pre-org"]]);
  });

  it("refuses renaming a shared file from before organizations onto another one's name", async () => {
    session.orgId = "org-1";
    await seed("team", "__shared__", "/team.md", "team");
    await seed("todo", "__shared__", "/todo.md", "todo");

    const renamed = await rename("team", "todo.md");

    expect(renamed).toMatchObject({
      status: 409,
      body: { errorCode: "name_taken", details: { suggestion: "todo-2.md" } },
    });
    expect(await stored("__organization__:org-1")).toEqual([]);
    expect(await stored("__shared__")).toEqual([
      ["/team.md", "team"],
      ["/todo.md", "todo"],
    ]);
  });
});

describe("claiming a name in the store", () => {
  it("creates only where no spelling of the name is stored", async () => {
    const { resourcePutIfAbsent } = await import("./store.js");
    await seed("old", owner, "/notes.md", "v1");
    await seed("deep", owner, "//deep.md", "v1");
    await seed("plan", owner, "plan.md", "v1");

    await expect(
      resourcePutIfAbsent(owner, "notes.md", "new"),
    ).resolves.toBeNull();
    await expect(
      resourcePutIfAbsent(owner, "deep.md", "new"),
    ).resolves.toBeNull();
    await expect(
      resourcePutIfAbsent(owner, "/plan.md", "new"),
    ).resolves.toBeNull();
    await expect(
      resourcePutIfAbsent(owner, "free.md", "new"),
    ).resolves.toMatchObject({ path: "free.md" });
    expect(await stored(owner)).toEqual([
      ["//deep.md", "v1"],
      ["/notes.md", "v1"],
      ["free.md", "new"],
      ["plan.md", "v1"],
    ]);
  });

  it("counts every spelling as taken in the free-name search", async () => {
    const { resourceStoredPathsTaken } = await import("./store.js");
    await seed("old", owner, "/notes.md", "v1");
    await seed("deep", owner, "//deep.md", "v1");
    await seed("plan", owner, "plan.md", "v1");

    const taken = await resourceStoredPathsTaken(owner, [
      "notes.md",
      "deep.md",
      "/plan.md",
      "free.md",
    ]);

    expect([...taken].sort()).toEqual(["/plan.md", "deep.md", "notes.md"]);
  });

  it("refuses a direct move onto the other spelling of a taken name", async () => {
    const { ResourcePathTakenError, resourceMove } = await import("./store.js");
    await seed("old", owner, "/notes.md", "old");
    await seed("move", owner, "somewhere.md", "move");

    await expect(resourceMove("move", "notes.md")).rejects.toBeInstanceOf(
      ResourcePathTakenError,
    );
    expect(await stored(owner)).toEqual([
      ["/notes.md", "old"],
      ["somewhere.md", "move"],
    ]);
  });

  it("refuses a conditional move onto the other spelling of a taken name", async () => {
    const { resourceGetByPath, resourceMoveIfCurrent } =
      await import("./store.js");
    await seed("old", owner, "/notes.md", "old");
    await seed("move", owner, "somewhere.md", "move");
    const current = await resourceGetByPath(owner, "somewhere.md");
    if (!current) throw new Error("somewhere.md was not seeded");

    await expect(
      resourceMoveIfCurrent(current, "notes.md"),
    ).resolves.toBeNull();
    expect(await stored(owner)).toEqual([
      ["/notes.md", "old"],
      ["somewhere.md", "move"],
    ]);
  });

  it("does not restore a deleted file once another spelling of its name is claimed", async () => {
    const {
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePutIfAbsent,
      resourceRestoreSnapshotIfCurrent,
    } = await import("./store.js");
    await seed("old", owner, "/notes.md", "legacy");
    const snapshot = await resourceGetByPath(owner, "/notes.md");
    if (!snapshot) throw new Error("/notes.md was not seeded");

    await expect(resourceDeleteByPath(owner, "/notes.md")).resolves.toBe(true);
    await expect(
      resourcePutIfAbsent(owner, "notes.md", "replacement"),
    ).resolves.toBeTruthy();
    await expect(
      resourceRestoreSnapshotIfCurrent(snapshot, null),
    ).resolves.toBe(false);
    expect(await stored(owner)).toEqual([["notes.md", "replacement"]]);
  });

  it("restores a deleted file while no spelling of its name is claimed", async () => {
    const {
      resourceDeleteByPath,
      resourceGetByPath,
      resourceRestoreSnapshotIfCurrent,
    } = await import("./store.js");
    await seed("old", owner, "/notes.md", "legacy");
    const snapshot = await resourceGetByPath(owner, "/notes.md");
    if (!snapshot) throw new Error("/notes.md was not seeded");

    await expect(resourceDeleteByPath(owner, "/notes.md")).resolves.toBe(true);
    await expect(
      resourceRestoreSnapshotIfCurrent(snapshot, null),
    ).resolves.toBe(true);
    expect(await stored(owner)).toEqual([["/notes.md", "legacy"]]);
  });
});

describe("reads, writes and deletes by path", () => {
  it("reach exactly the stored path, as before", async () => {
    const { resourceDeleteByPath, resourceGetByPath, resourcePut } =
      await import("./store.js");
    await seed("old", owner, "/notes.md", "v1");

    await expect(resourceGetByPath(owner, "notes.md")).resolves.toBeNull();
    await expect(resourceDeleteByPath(owner, "notes.md")).resolves.toBe(false);
    await expect(resourceGetByPath(owner, "/notes.md")).resolves.toMatchObject({
      id: "old",
    });
    await expect(resourcePut(owner, "/notes.md", "v2")).resolves.toMatchObject({
      id: "old",
      path: "/notes.md",
    });
    expect(await stored(owner)).toEqual([["/notes.md", "v2"]]);
  });

  it("keep both rows of a name already stored in both spellings, each by its own path", async () => {
    const {
      resourceDeleteByPath,
      resourceGetByPath,
      resourceList,
      resourcePut,
    } = await import("./store.js");
    await seed("plain", owner, "notes.md", "plain");
    await seed("slashed", owner, "/notes.md", "slashed");

    expect((await resourceGetByPath(owner, "notes.md"))?.id).toBe("plain");
    expect((await resourceGetByPath(owner, "/notes.md"))?.id).toBe("slashed");
    await resourcePut(owner, "notes.md", "plain v2");
    await resourcePut(owner, "/notes.md", "slashed v2");
    expect(await stored(owner)).toEqual([
      ["/notes.md", "slashed v2"],
      ["notes.md", "plain v2"],
    ]);
    expect((await resourceList(owner)).map((r) => r.id).sort()).toEqual([
      "plain",
      "slashed",
    ]);

    await expect(resourceDeleteByPath(owner, "/notes.md")).resolves.toBe(true);
    expect(await stored(owner)).toEqual([["notes.md", "plain v2"]]);
  });

  it("find a file over MCP by either spelling, the one asked for first", async () => {
    const { readScopedResourceForMcp } = await import("./store.js");
    await seed("old", owner, "/notes.md", "legacy");
    await seed("plan", owner, "plan.md", "plan");
    await seed("pair-plain", owner, "pair.md", "plain");
    await seed("pair-slashed", owner, "/pair.md", "slashed");

    const found = await runWithRequestContext(
      { userEmail: owner, orgScope: "personal" },
      async () => {
        const read = async (path: string) =>
          (await readScopedResourceForMcp({ scope: "personal", path }))?.id;
        return {
          legacy: await read("notes.md"),
          slashed: await read("/plan.md"),
          pairPlain: await read("pair.md"),
          pairSlashed: await read("/pair.md"),
          missing: await read("/missing.md"),
        };
      },
    );

    expect(found).toEqual({
      legacy: "old",
      slashed: "plan",
      pairPlain: "pair-plain",
      pairSlashed: "pair-slashed",
      missing: undefined,
    });
  });
});
