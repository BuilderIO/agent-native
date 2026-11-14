import {
  closeDbExec,
  isUniqueViolation,
  type DbExec,
} from "@agent-native/core/db";
import { isNameTaken } from "@agent-native/core/free-name";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { renameLaterDuplicateDesignFilenames } from "../server/lib/design-filename-duplicates.js";
import {
  agentToolContext,
  bootDesignDatabase,
  runCall,
  seedDesign,
} from "../server/lib/failed-write-test-harness.js";
import createFile from "./create-file.js";

// Names that never overwrite, against a real database: copies made at the
// same moment both save under their own names, a taken name is refused with
// a free one to use instead, and rows that already share a name are given
// free ones so the unique filename index can hold.
let exec: DbExec;

// Runs once after the next create's checkpoint, before the transaction that
// inserts its file, as a writer that doesn't take the design's lock would.
const outsideWriter = vi.hoisted(() => ({
  next: undefined as undefined | (() => Promise<void>),
  armed: undefined as undefined | (() => Promise<void>),
}));
vi.mock("../server/lib/design-versions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/design-versions.js")>();
  return {
    ...actual,
    snapshotDesignBeforeAgentEdit: (async (...args) => {
      const checkpoint = await actual.snapshotDesignBeforeAgentEdit(...args);
      outsideWriter.armed = outsideWriter.next;
      outsideWriter.next = undefined;
      return checkpoint;
    }) as typeof actual.snapshotDesignBeforeAgentEdit,
  };
});
vi.mock("../server/source-workspace.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/source-workspace.js")>();
  return {
    ...actual,
    withDesignSourceMutationTransaction: (async (...args) => {
      const write = outsideWriter.armed;
      outsideWriter.armed = undefined;
      await write?.();
      return actual.withDesignSourceMutationTransaction(...args);
    }) as typeof actual.withDesignSourceMutationTransaction,
  };
});

function html(text: string): string {
  return `<!DOCTYPE html><html><head></head><body><p>${text}</p></body></html>`;
}

async function filesOf(designId: string) {
  const { rows } = await exec.execute({
    sql: "SELECT id, filename, content FROM design_files WHERE design_id = ? ORDER BY filename",
    args: [designId],
  });
  return rows as Array<{ id: string; filename: string; content: string }>;
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  exec = await bootDesignDatabase();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("create-file names", () => {
  it("saves copies asked for under one name at once under free names, each with its own content", async () => {
    await seedDesign(exec, "names-race", [
      { filename: "home.html", content: html("home") },
    ]);

    const results = await Promise.all(
      ["first", "second", "third"].map((text, index) =>
        runCall(
          createFile,
          {
            designId: "names-race",
            filename: "home-copy.html",
            content: html(text),
            ifNameTaken: "next-free",
          },
          agentToolContext("create-file", `turn-${index}`),
        ),
      ),
    );

    for (const { error } of results) expect(error).toBeUndefined();
    const saved = results.map(
      ({ result }) => (result as { filename: string }).filename,
    );
    expect(new Set(saved)).toEqual(
      new Set(["home-copy.html", "home-copy-2.html", "home-copy-3.html"]),
    );
    const files = await filesOf("names-race");
    expect(files.map((file) => file.filename)).toEqual([
      "home-copy-2.html",
      "home-copy-3.html",
      "home-copy.html",
      "home.html",
    ]);
    // Each result names the file holding its own content: nothing overwritten.
    for (const [index, text] of ["first", "second", "third"].entries()) {
      const file = files.find((row) => row.filename === saved[index]);
      expect(file?.content).toContain(`>${text}</p>`);
    }
    expect(
      files.find((row) => row.filename === "home.html")?.content,
    ).toContain("<p>home</p>");
  });

  it("refuses a taken name by default with a free one to use, and saves nothing", async () => {
    await seedDesign(exec, "names-refuse", [
      { filename: "home.html", content: html("home") },
      { filename: "home-2.html", content: html("home two") },
    ]);

    const { error } = await runCall(
      createFile,
      {
        designId: "names-refuse",
        filename: "home.html",
        content: html("mine"),
      },
      agentToolContext("create-file"),
    );

    expect(isNameTaken(error)).toBe(true);
    expect(error).toMatchObject({
      errorCode: "name_taken",
      statusCode: 409,
      details: { name: "home.html", suggestion: "home-3.html" },
    });
    expect((error as Error).message).not.toContain("names-refuse");
    expect((error as Error).message).toContain("edit-design");
    expect((await filesOf("names-refuse")).length).toBe(2);
  });

  it("saves under the next free name when an outside writer takes the name first, and refuses it by default", async () => {
    await exec.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS design_files_design_filename_unique_idx ON design_files (design_id, filename)",
    );
    try {
      const create = async (designId: string, ifNameTaken?: "next-free") => {
        await seedDesign(exec, designId, [
          { filename: "home.html", content: html("home") },
        ]);
        const insert = (id: string) =>
          exec.execute({
            sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, ?, ?)",
            args: [id, designId, "home-copy.html", "html", html(id)],
          });
        // The import saves after this create found the name free, so the
        // index refuses this create's insert.
        outsideWriter.next = async () => {
          await insert(`${designId}-import`);
          await insert(`${designId}-refused`);
        };
        return runCall(
          createFile,
          {
            designId,
            filename: "home-copy.html",
            content: html("mine"),
            ...(ifNameTaken ? { ifNameTaken } : {}),
          },
          agentToolContext("create-file"),
        );
      };

      const saved = await create("names-outside", "next-free");
      expect(saved.error).toBeUndefined();
      expect(saved.result).toMatchObject({ filename: "home-copy-2.html" });
      const files = await filesOf("names-outside");
      expect(
        files.find((row) => row.filename === "home-copy.html")?.content,
      ).toContain("<p>names-outside-import</p>");
      expect(
        files.find((row) => row.filename === "home-copy-2.html")?.content,
      ).toContain(">mine</p>");

      const refused = await create("names-outside-default");
      expect(refused.error).toMatchObject({
        errorCode: "name_taken",
        details: { name: "home-copy.html", suggestion: "home-copy-2.html" },
      });
      expect(
        (await filesOf("names-outside-default")).map((row) => row.filename),
      ).toEqual(["home-copy.html", "home.html"]);
    } finally {
      // Later rows share names on purpose to test the repair.
      await exec.execute(
        "DROP INDEX IF EXISTS design_files_design_filename_unique_idx",
      );
    }
  });
});

describe("renameLaterDuplicateDesignFilenames", () => {
  it("keeps the oldest file under the shared name, gives later ones free names, and lets the index be created", async () => {
    await seedDesign(exec, "names-legacy", [
      { filename: "about.html", content: html("about") },
    ]);
    await seedDesign(exec, "names-legacy-later");
    const insert = (
      id: string,
      filename: string,
      createdAt: string,
      designId = "names-legacy",
    ) =>
      exec.execute({
        sql: "INSERT INTO design_files (id, design_id, filename, file_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [id, designId, filename, "html", html(id), createdAt],
      });
    await insert("newest", "home.html", "2026-03-01T00:00:00.000Z");
    await insert("oldest", "home.html", "2026-01-01T00:00:00.000Z");
    await insert("middle", "home.html", "2026-02-01T00:00:00.000Z");
    await insert("taken-two", "home-2.html", "2026-01-15T00:00:00.000Z");
    const later = "names-legacy-later";
    await insert("later-old", "home.html", "2026-01-01T00:00:00.000Z", later);
    await insert("later-new", "home.html", "2026-02-01T00:00:00.000Z", later);
    const createIndex = () =>
      exec.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS design_files_design_filename_unique_idx ON design_files (design_id, filename)",
      );
    // Boot repairs only when the index is blocked by duplicates.
    const blocked = await createIndex().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isUniqueViolation(blocked)).toBe(true);

    // A boot repairs a bounded number of designs; the next one carries on.
    expect(await renameLaterDuplicateDesignFilenames(1)).toEqual({
      renamed: 2,
      remaining: true,
    });
    expect(await renameLaterDuplicateDesignFilenames(1)).toEqual({
      renamed: 1,
      remaining: false,
    });
    expect(
      (await filesOf("names-legacy-later")).map((file) => file.filename),
    ).toEqual(["home-2.html", "home.html"]);

    const byId = Object.fromEntries(
      (await filesOf("names-legacy")).map((file) => [file.id, file]),
    );
    expect(byId.oldest?.filename).toBe("home.html");
    expect(byId["taken-two"]?.filename).toBe("home-2.html");
    expect(byId.middle?.filename).toBe("home-3.html");
    expect(byId.newest?.filename).toBe("home-4.html");
    // Only the names changed.
    expect(byId.newest?.content).toContain("<p>newest</p>");
    expect(byId["names-legacy:about.html"]?.filename).toBe("about.html");

    await createIndex();
    expect(await renameLaterDuplicateDesignFilenames()).toEqual({
      renamed: 0,
      remaining: false,
    });
  });
});
