import { closeDbExec, type DbExec } from "@agent-native/core/db";
import { mountActionRoutes } from "@agent-native/core/server";
import { H3 } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  bootDesignDatabase,
  DESIGN_OWNER,
} from "../server/lib/failed-write-test-harness.js";
import saveDesignAsTemplate from "./save-design-as-template.js";

let exec: DbExec;
const h3 = new H3();
mountActionRoutes(
  { h3, hooks: { hook: () => {} } },
  { "save-design-as-template": saveDesignAsTemplate as never },
  { appId: "design", getOwnerFromEvent: async () => DESIGN_OWNER },
);

async function save(designId: string) {
  return h3.fetch(
    new Request(
      "https://design.example.test/_agent-native/actions/save-design-as-template",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ designId, title: "Reusable template" }),
      },
    ),
  );
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

describe("save-design-as-template action route", () => {
  it("rejects a board and stylesheet without a screen without writing a template", async () => {
    await exec.execute({
      sql: "INSERT INTO designs (id, title, data, owner_email, visibility) VALUES (?, ?, ?, ?, ?)",
      args: ["empty-design", "Empty", "{}", DESIGN_OWNER, "private"],
    });
    await exec.execute({
      sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
      args: [
        "board",
        "empty-design",
        "__board__.html",
        "html",
        "<html></html>",
        "css",
        "empty-design",
        "styles.css",
        "css",
        "body {}",
      ],
    });

    const response = await save("empty-design");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      errorCode: "template_requires_screen",
      error: "Add at least one design screen before saving a template.",
    });
    const templates = await exec.execute({
      sql: "SELECT id FROM design_templates WHERE source_design_id = ?",
      args: ["empty-design"],
    });
    const files = await exec.execute({
      sql: "SELECT id FROM design_template_files",
      args: [],
    });
    expect(templates.rows).toEqual([]);
    expect(files.rows).toEqual([]);
  });

  it("saves a screen and its content successfully", async () => {
    await exec.execute({
      sql: "INSERT INTO designs (id, title, data, owner_email, visibility) VALUES (?, ?, ?, ?, ?)",
      args: ["screen-design", "Screen", "{}", DESIGN_OWNER, "private"],
    });
    await exec.execute({
      sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, ?, ?)",
      args: [
        "screen",
        "screen-design",
        "index.html",
        "html",
        "<html><body>Hello</body></html>",
      ],
    });

    const response = await save("screen-design");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ title: "Reusable template", fileCount: 1 });
    const templates = await exec.execute({
      sql: "SELECT id, title, source_design_id FROM design_templates WHERE id = ?",
      args: [result.id],
    });
    expect(templates.rows).toEqual([
      {
        id: result.id,
        title: "Reusable template",
        source_design_id: "screen-design",
      },
    ]);
    const files = await exec.execute({
      sql: "SELECT filename, content FROM design_template_files WHERE template_id = ?",
      args: [result.id],
    });
    expect(files.rows).toEqual([
      { filename: "index.html", content: "<html><body>Hello</body></html>" },
    ]);
  });
});
