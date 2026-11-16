import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.stubEnv("APP_NAME", "generation-read-test");
vi.stubEnv("GENERATION_READ_TEST_DATABASE_URL", "pglite:memory://");

const state = vi.hoisted(() => ({
  checkpoint: vi.fn(),
  liveReads: vi.fn(),
  observeRows: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({
    role: "editor",
    resource: { id: "design-1", data: "{}" },
  })),
  registerShareableResource: vi.fn(),
  resolveAccess: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn().mockResolvedValue(null),
  writeAppState: vi.fn(),
}));
vi.mock("@agent-native/core/collab", () => ({
  seedFromText: vi.fn(),
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
  agentUpdateSelection: vi.fn(),
}));
vi.mock("../server/lib/design-tracking.js", () => ({
  trackDesign: vi.fn(),
  trackingErrorType: () => "test",
}));
vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: state.checkpoint,
}));
vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: state.liveReads,
  SourceWorkspaceEditConflictError: class extends Error {},
  withDesignSourceMutationTransaction: vi.fn(),
  writeInlineSourceFile: vi.fn(),
}));
vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: vi.fn(),
  recordGenerationCreativeContext: vi.fn(),
  replaceCreativeContextElementProvenance: vi.fn(),
  resolveGenerationCreativeContext: vi.fn(),
  validateCreativeContextReuseLabels: vi.fn(),
  validateGenerationCreativeContext: vi.fn().mockResolvedValue({
    contextMode: "off",
    contextPackId: null,
    reuseLabels: [],
  }),
}));

vi.mock("../server/db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/db/index.js")>();
  return {
    ...actual,
    getDb: () => {
      const database = actual.getDb();
      return new Proxy(database, {
        get(target, key, receiver) {
          if (key !== "select") return Reflect.get(target, key, receiver);
          return (...args: Parameters<typeof database.select>) => {
            const builder = database.select(...args);
            const from = builder.from.bind(builder);
            vi.spyOn(builder, "from").mockImplementation(
              (...tables: Parameters<typeof builder.from>) => {
                const query = from(...tables);
                const execute = query.execute.bind(query);
                vi.spyOn(query, "execute").mockImplementation(
                  async (...parameters: Parameters<typeof query.execute>) => {
                    const rows = await execute(...parameters);
                    state.observeRows(rows);
                    return rows;
                  },
                );
                return query;
              },
            );
            return builder;
          };
        },
      });
    },
  };
});

import { closeDbExec, getDbExec } from "@agent-native/core/db";

import { getDb, schema } from "../server/db/index.js";
import action from "./generate-design.js";

const checkpoint = new Error("source preflight complete");
const observed: unknown[][] = [];
const db = getDb();

beforeAll(async () => {
  await getDbExec().execute({
    sql: `CREATE TABLE design_files (
    id TEXT PRIMARY KEY, design_id TEXT NOT NULL, filename TEXT NOT NULL,
    content TEXT NOT NULL, file_type TEXT NOT NULL,
    content_operation_source TEXT, content_operation_revision INTEGER,
    content_operation_result_hash TEXT,
    content_operation_revisions TEXT NOT NULL DEFAULT '{}',
    created_at TEXT, updated_at TEXT
  )`,
  });
});
afterAll(async () => {
  vi.restoreAllMocks();
  await closeDbExec();
});
beforeEach(async () => {
  await db.delete(schema.designFiles);
  observed.length = 0;
  state.observeRows.mockImplementation((rows: unknown[]) =>
    observed.push(rows),
  );
  state.checkpoint.mockReset().mockRejectedValue(checkpoint);
  state.liveReads.mockReset().mockImplementation(async (file) => ({
    ...file,
    versionHash: "existing-version",
  }));
});
const run = (filename: string, content: string, fileType = "html") =>
  action.run({
    designId: "generation-design",
    prompt: "Add this screen",
    contextModeOverride: "off",
    files: [{ filename, content, fileType }],
  });
async function insert(id: string, content: string, fileType = "html") {
  await db.insert(schema.designFiles).values({
    id,
    designId: "generation-design",
    filename: id + (fileType === "jsx" ? ".jsx" : ".html"),
    content,
    fileType,
  });
}

describe("generation sibling source transport", () => {
  it("does not return unrelated bodies when appending HTML", async () => {
    await insert("large", "<main>" + "existing".repeat(100_000) + "</main>");
    await expect(
      run("new.html", "<html><body>New page</body></html>"),
    ).rejects.toBe(checkpoint);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual([
      expect.objectContaining({ id: "large", content: null }),
    ]);
    expect(state.liveReads).not.toHaveBeenCalled();
  });
  it("loads replacement source and rejects editing its locked layer before checkpointing", async () => {
    const locked =
      '<html><body><div data-agent-native-node-id="locked" data-agent-native-locked="true">Legal</div></body></html>';
    await insert("locked", locked);
    await insert("unrelated", "<main>Unrelated</main>");
    await expect(
      run("locked.html", "<html><body>Removed</body></html>"),
    ).rejects.toMatchObject({
      errorCode: "locked_layer_edit_rejected",
      noWrite: true,
    });
    expect(observed[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "locked", content: locked }),
        expect.objectContaining({ id: "unrelated", content: null }),
      ]),
    );
    expect(state.liveReads).toHaveBeenCalledWith(
      expect.objectContaining({ content: locked }),
    );
    expect(state.checkpoint).not.toHaveBeenCalled();
  });
  it("rejects CSS-only output when all existing HTML and JSX are Unicode whitespace", async () => {
    for (let index = 0; index < 18; index++)
      await insert(
        String(index).padStart(2, "0"),
        "\u00a0\ufeff\u2003\u2028\u2029",
        index % 2 ? "jsx" : "html",
      );
    await expect(
      run("styles.css", "body { color: red }", "css"),
    ).rejects.toMatchObject({ noWrite: true });
    expect(state.checkpoint).not.toHaveBeenCalled();
    expect(observed.map((rows) => rows.length)).toEqual([18, 0]);
  });
  it("accepts CSS-only output when one existing JSX file is nonblank, without reading bodies", async () => {
    for (let index = 0; index < 17; index++)
      await insert(String(index).padStart(2, "0"), "\u00a0\ufeff");
    await insert("zz", "<main>Existing JSX</main>", "jsx");
    await expect(run("styles.css", "body { color: red }", "css")).rejects.toBe(
      checkpoint,
    );
    expect(observed).toHaveLength(2);
    expect(observed[1]).toEqual([{ id: "zz" }]);
  });
});
