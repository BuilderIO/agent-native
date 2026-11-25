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

describe("one path form for resource files", () => {
  it("makes a created file and an upload with the same name one file", async () => {
    await create({ path: "notes.md", content: "", shared: false });
    const uploaded = await upload("notes.md", "uploaded text");

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.path).toBe("notes-2.md");
    expect(await stored("erin@example.test")).toEqual([
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
    expect(await stored("erin@example.test")).toEqual([
      ["notes-2.md", ""],
      ["notes.md", "uploaded text"],
    ]);
  });

  it("finds an upload stored before this change under its canonical name", async () => {
    await seed("old", "erin@example.test", "/notes.md", "old upload");

    const created = await create({
      path: "notes.md",
      content: "",
      shared: false,
      uniquePath: true,
    });
    const uploaded = await upload("notes.md", "old upload");

    expect(created.body.path).toBe("notes-2.md");
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.id).toBe("old");
    expect(await stored("erin@example.test")).toEqual([
      ["/notes.md", "old upload"],
      ["notes-2.md", ""],
    ]);
  });

  it("refuses a rename onto the other form of a taken name", async () => {
    await seed("old", "erin@example.test", "/notes.md", "old upload");
    await seed("todo", "erin@example.test", "todo.md", "todo");
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
    expect(await stored("erin@example.test")).toEqual([
      ["/notes.md", "old upload"],
      ["a.md", "a"],
      ["b.md", "b"],
      ["todo.md", "todo"],
    ]);
  });

  it("keeps a rename that only adds or drops the leading slash on the same file", async () => {
    await seed("old", "erin@example.test", "/notes.md", "old upload");

    const renamed = await rename("old", "notes.md");

    expect(renamed.status).toBe(200);
    expect(await stored("erin@example.test")).toEqual([
      ["/notes.md", "old upload"],
    ]);
  });

  it("stores a shared upload in an organization under the created file's form", async () => {
    session.orgId = "org-1";
    const owner = "__organization__:org-1";
    await create({ path: "team.md", content: "", shared: true });
    const uploaded = await upload("team.md", "uploaded", true);

    expect(uploaded.body.path).toBe("team-2.md");
    expect(await stored(owner)).toEqual([
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
});

describe("agent reads and writes by path", () => {
  it("reach the same file with or without a leading slash", async () => {
    const { resourceGetByPath, resourcePut } = await import("./store.js");
    const owner = "erin@example.test";

    const written = await resourcePut(owner, "/plan.md", "v1");
    const plain = await resourceGetByPath(owner, "plan.md");
    const slashed = await resourceGetByPath(owner, "/plan.md");
    await resourcePut(owner, "plan.md", "v2");

    expect(written.path).toBe("plan.md");
    expect(plain?.id).toBe(written.id);
    expect(slashed?.id).toBe(written.id);
    expect(await stored(owner)).toEqual([["plan.md", "v2"]]);
  });

  it("write onto a file stored with a leading slash in place", async () => {
    const { resourceGetByPath, resourcePut, resourcePutIfSnapshot } =
      await import("./store.js");
    const owner = "erin@example.test";
    await seed("old", owner, "/notes.md", "v1");

    const read = await resourceGetByPath(owner, "notes.md");
    const put = await resourcePut(owner, "notes.md", "v2");
    const current = await resourceGetByPath(owner, "notes.md");
    const snapshot = await resourcePutIfSnapshot({
      previous: current,
      owner,
      path: "notes.md",
      content: "v3",
      mimeType: "text/markdown",
    });

    expect(read?.id).toBe("old");
    expect(put.id).toBe("old");
    expect(snapshot?.resource.id).toBe("old");
    expect(await stored(owner)).toEqual([["/notes.md", "v3"]]);
  });

  it("create only where neither form is stored", async () => {
    const { resourcePutIfAbsent, resourcePutIfSnapshot } =
      await import("./store.js");
    const owner = "erin@example.test";
    await seed("old", owner, "/notes.md", "v1");

    await expect(
      resourcePutIfAbsent(owner, "notes.md", "new"),
    ).resolves.toBeNull();
    await expect(
      resourcePutIfSnapshot({
        previous: null,
        owner,
        path: "notes.md",
        content: "new",
        mimeType: "text/markdown",
      }),
    ).resolves.toBeNull();
    expect(await stored(owner)).toEqual([["/notes.md", "v1"]]);
  });

  it("delete the file a read by that path finds", async () => {
    const { resourceDeleteByPath } = await import("./store.js");
    const owner = "erin@example.test";
    await seed("old", owner, "/notes.md", "v1");

    await expect(resourceDeleteByPath(owner, "notes.md")).resolves.toBe(true);
    expect(await stored(owner)).toEqual([]);
  });

  it("find a file over MCP with or without a leading slash", async () => {
    const { readScopedResourceForMcp } = await import("./store.js");
    const owner = "erin@example.test";
    await seed("old", owner, "/notes.md", "legacy");
    await seed("plan", owner, "plan.md", "plan");

    const found = await runWithRequestContext(
      { userEmail: owner, orgScope: "personal" },
      async () => ({
        legacy: await readScopedResourceForMcp({
          scope: "personal",
          path: "notes.md",
        }),
        slashed: await readScopedResourceForMcp({
          scope: "personal",
          path: "/plan.md",
        }),
      }),
    );

    expect(found.legacy?.id).toBe("old");
    expect(found.slashed?.id).toBe("plan");
  });

  it("leave both rows of a name already stored in both forms, each reachable by its own spelling", async () => {
    const { resourceGetByPath, resourcePut, resourceList } =
      await import("./store.js");
    const owner = "erin@example.test";
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
  });
});
