import { closeDbExec, type DbExec } from "@agent-native/core/db";
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
});

describe("renameLaterDuplicateDesignFilenames", () => {
  it("keeps the oldest file under the shared name, gives later ones free names, and lets the index be created", async () => {
    await seedDesign(exec, "names-legacy", [
      { filename: "about.html", content: html("about") },
    ]);
    const insert = (id: string, filename: string, createdAt: string) =>
      exec.execute({
        sql: "INSERT INTO design_files (id, design_id, filename, file_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [id, "names-legacy", filename, "html", html(id), createdAt],
      });
    await insert("newest", "home.html", "2026-03-01T00:00:00.000Z");
    await insert("oldest", "home.html", "2026-01-01T00:00:00.000Z");
    await insert("middle", "home.html", "2026-02-01T00:00:00.000Z");
    await insert("taken-two", "home-2.html", "2026-01-15T00:00:00.000Z");

    expect(await renameLaterDuplicateDesignFilenames()).toBe(2);

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

    await exec.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS design_files_design_filename_unique_idx ON design_files (design_id, filename)",
    );
    expect(await renameLaterDuplicateDesignFilenames()).toBe(0);
  });
});
