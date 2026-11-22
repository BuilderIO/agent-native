import {
  closeDbExec,
  isUniqueViolation,
  type DbExec,
} from "@agent-native/core/db";
import { isNameTaken } from "@agent-native/core/free-name";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const fake = vi.hoisted(() => ({
  screenshot: vi.fn(),
  upload: vi.fn(),
  seedFromTextFails: false,
  afterSnapshot: undefined as undefined | (() => Promise<void>),
  outsideWriterNext: undefined as undefined | (() => Promise<void>),
  outsideWriterArmed: undefined as undefined | (() => Promise<void>),
}));

vi.mock("../server/lib/design-versions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/design-versions.js")>();
  return {
    ...actual,
    snapshotDesignBeforeAgentEdit: (async (...args) => {
      const checkpoint = await actual.snapshotDesignBeforeAgentEdit(...args);
      fake.outsideWriterArmed = fake.outsideWriterNext;
      fake.outsideWriterNext = undefined;
      await fake.afterSnapshot?.();
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
      const write = fake.outsideWriterArmed;
      fake.outsideWriterArmed = undefined;
      await write?.();
      return actual.withDesignSourceMutationTransaction(...args);
    }) as typeof actual.withDesignSourceMutationTransaction,
  };
});

vi.mock("@agent-native/core/collab", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/collab")>();
  return {
    ...actual,
    seedFromText: (...args: Parameters<typeof actual.seedFromText>) => {
      if (fake.seedFromTextFails) {
        throw new Error("The collaboration store is unavailable.");
      }
      return actual.seedFromText(...args);
    },
  };
});

vi.mock("@agent-native/core/file-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/file-upload")>()),
  uploadFile: fake.upload,
}));

// A stand-in browser: only the renderer is faked, so the screenshot action,
// its nested call and the export action around it all run for real.
vi.mock("../server/lib/playwright-runtime.js", async (importOriginal) => {
  const page = {
    on: () => undefined,
    evaluate: async () => ({
      horizontalOverflowPx: 0,
      overflowingElements: [],
      lowContrastText: [],
      brokenImages: [],
      zeroSizeOrOffscreen: [],
    }),
    screenshot: (...args: unknown[]) => fake.screenshot(...args),
  };
  const context = {
    addInitScript: async () => undefined,
    route: async () => undefined,
    routeWebSocket: async () => undefined,
    newPage: async () => page,
    close: async () => undefined,
  };
  const browser = {
    newContext: async () => context,
    close: async () => undefined,
  };
  return {
    ...(await importOriginal<
      typeof import("../server/lib/playwright-runtime.js")
    >()),
    importPlaywright: async () => ({ chromium: {} }),
    launchChromium: async () => browser,
  };
});

vi.mock("../server/lib/screenshot-readiness.js", () => ({
  prepareScreenshotPage: async () => undefined,
}));

import { renameLaterDuplicateDesignFilenames } from "../server/lib/design-filename-duplicates.js";
import {
  agentToolContext,
  bootDesignDatabase,
  countRows,
  runCall,
  seedDesign,
} from "../server/lib/failed-write-test-harness.js";
import { BOARD_FILENAME } from "../shared/board-file.js";
import createFile from "./create-file.js";
import editDesign from "./edit-design.js";
import exportPng from "./export-png.js";
import generateDesign from "./generate-design.js";
import moveDesignElement from "./move-design-element.js";
import setLayoutGrid from "./set-layout-grid.js";
import updateFile from "./update-file.js";

// oracle-change(templates/design/actions/create-file.free-name.pglite.spec.ts): cases moved verbatim into this file (create-file free names)
// oracle-change(templates/design/actions/edit-design.introduced-ids.pglite.spec.ts): cases moved verbatim into this file (edit-design introduced ids)
// oracle-change(templates/design/actions/move-design-element.spec.ts): cases moved verbatim into this file (move-design-element db)
// oracle-change(templates/design/actions/set-layout-grid.spec.ts): cases moved verbatim into this file (set-layout-grid schema and run)

// A failed Design call is classified by the writes the framework saw it make.
// These run the real actions against a real database: a rejection raised
// before the first write must leave the agent free to fix its request and
// retry, and a failure after a write must still stop it.
const originalFetch = globalThis.fetch;
const INVALID_X_DATA =
  '<!DOCTYPE html><html><head></head><body x-data="{ a: }"><p>Hi</p></body></html>';
const VALID_HTML =
  "<!DOCTYPE html><html><head></head><body><p>Hi</p></body></html>";
const HUBSPOT_MARKER =
  '<html><head><meta name="agent-native:frame-type" content="hubspot-email"></head><body></body></html>';
let exec: DbExec;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  exec = await bootDesignDatabase();
});

afterEach(() => {
  fake.seedFromTextFails = false;
  fake.afterSnapshot = undefined;
  fake.outsideWriterNext = undefined;
  fake.outsideWriterArmed = undefined;
  fake.screenshot.mockReset();
  fake.upload.mockReset();
  Object.defineProperty(globalThis, "fetch", {
    value: originalFetch,
    writable: true,
    configurable: true,
    enumerable: true,
  });
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("edit-design", () => {
  it("is none when the file id is not in the design", async () => {
    await seedDesign(exec, "edit-missing", [
      { filename: "index.html", content: VALID_HTML },
    ]);

    const { error, effect, outcome } = await runCall(
      editDesign,
      {
        designId: "edit-missing",
        fileId: "no-such-file",
        mode: "replace-file",
        replacementContent: VALID_HTML,
      },
      agentToolContext("edit-design"),
    );

    expect(error).toMatchObject({ errorCode: "design_file_not_found" });
    expect(effect).toEqual({ effect: "none", changed: false });
    expect(outcome.evidence?.writeObserved).toBe(false);
    expect(await countRows(exec, "design_versions", "edit-missing")).toBe(0);
  });

  it("is none when a search block matches nothing", async () => {
    await seedDesign(exec, "edit-nomatch", [
      { filename: "index.html", content: VALID_HTML },
    ]);

    const { error, effect } = await runCall(
      editDesign,
      {
        designId: "edit-nomatch",
        filename: "index.html",
        edits: [{ search: "<p>Absent</p>", replace: "<p>Present</p>" }],
      },
      agentToolContext("edit-design"),
    );

    expect(error).toBeDefined();
    expect(effect).toMatchObject({ effect: "none" });
    expect(await countRows(exec, "design_versions", "edit-nomatch")).toBe(0);
  });
});

describe("create-file", () => {
  it("is none when a HubSpot email frame is not an HTML file", async () => {
    await seedDesign(exec, "cf-marker");

    const { error, effect, outcome } = await runCall(
      createFile,
      {
        designId: "cf-marker",
        filename: "email.css",
        fileType: "css",
        content: HUBSPOT_MARKER,
      },
      agentToolContext("create-file"),
    );

    expect(error).toMatchObject({ errorCode: "hubspot_email_html_required" });
    expect(effect).toMatchObject({ effect: "none" });
    expect(outcome.evidence?.writeObserved).toBe(false);
    // Rejected before the checkpoint, so nothing was written at all.
    expect(await countRows(exec, "design_versions", "cf-marker")).toBe(0);
    expect(await countRows(exec, "design_files", "cf-marker")).toBe(0);
  });

  it("is none when the HTML fails its integrity check", async () => {
    await seedDesign(exec, "cf-integrity");

    const { error, effect } = await runCall(
      createFile,
      {
        designId: "cf-integrity",
        filename: "bad.html",
        content: INVALID_X_DATA,
      },
      agentToolContext("create-file"),
    );

    expect(String((error as Error).message)).toContain("DESIGN_HTML_INTEGRITY");
    expect(effect).toMatchObject({ effect: "none" });
    expect(await countRows(exec, "design_versions", "cf-integrity")).toBe(0);
  });

  it("is none when the name is taken, although the checkpoint already ran", async () => {
    await seedDesign(exec, "cf-taken", [
      { filename: "index.html", content: VALID_HTML },
    ]);

    const { error, effect, outcome } = await runCall(
      createFile,
      { designId: "cf-taken", filename: "index.html", content: VALID_HTML },
      agentToolContext("create-file"),
    );

    expect(error).toMatchObject({
      errorCode: "name_taken",
      details: { name: "index.html", suggestion: "index-2.html" },
    });
    expect(await countRows(exec, "design_versions", "cf-taken")).toBe(1);
    expect(effect).toMatchObject({ effect: "none" });
    expect(outcome.evidence?.writeObserved).toBe(false);
  });

  it("is unknown when it fails after the file was inserted", async () => {
    await seedDesign(exec, "cf-after-insert");
    fake.seedFromTextFails = true;

    const { error, effect, outcome } = await runCall(
      createFile,
      {
        designId: "cf-after-insert",
        filename: "new.html",
        content: VALID_HTML,
      },
      agentToolContext("create-file"),
    );

    expect(error).toBeDefined();
    expect(await countRows(exec, "design_files", "cf-after-insert")).toBe(1);
    expect(effect).toEqual({ effect: "unknown", changed: true });
    expect(outcome.evidence).toMatchObject({
      writeObserved: true,
      writeObservedChannel: "db",
    });
  });
});

describe("update-file", () => {
  it("is none when the new content fails the integrity check, after the table lock", async () => {
    await seedDesign(exec, "uf-integrity", [
      { filename: "index.html", content: VALID_HTML },
    ]);

    const { error, effect, outcome } = await runCall(
      updateFile,
      { id: "uf-integrity:index.html", content: INVALID_X_DATA },
      agentToolContext("update-file"),
    );

    expect(String((error as Error).message)).toContain("DESIGN_HTML_INTEGRITY");
    expect(effect).toMatchObject({ effect: "none" });
    expect(outcome.evidence?.writeObserved).toBe(false);
  });
});

describe("generate-design", () => {
  const generate = (designId: string, filename: string, content: string) => ({
    designId,
    prompt: "A landing page",
    files: [{ filename, fileType: "html", content }],
  });

  it("is none when a new screen's x-data is not valid JavaScript", async () => {
    await seedDesign(exec, "gen-new");

    const { error, effect, outcome } = await runCall(
      generateDesign,
      generate("gen-new", "landing.html", INVALID_X_DATA),
      agentToolContext("generate-design"),
    );

    expect(String((error as Error).message)).toContain("DESIGN_HTML_INTEGRITY");
    expect(String((error as Error).message)).toContain("x-data");
    expect(effect).toMatchObject({ effect: "none" });
    expect(outcome.evidence?.writeObserved).toBe(false);
    expect(await countRows(exec, "design_versions", "gen-new")).toBe(0);
    expect(await countRows(exec, "design_files", "gen-new")).toBe(0);
  });

  it("reports an existing screen's invalid x-data in fileErrors instead of failing", async () => {
    await seedDesign(exec, "gen-existing", [
      { filename: "landing.html", content: VALID_HTML },
    ]);

    const { error, result } = await runCall(
      generateDesign,
      generate("gen-existing", "landing.html", INVALID_X_DATA),
      agentToolContext("generate-design"),
    );

    expect(error).toBeUndefined();
    expect(result).toMatchObject({
      savedFiles: [],
      fileErrors: [{ filename: "landing.html" }],
    });
  });

  it("is unknown when it fails after a screen was inserted", async () => {
    await seedDesign(exec, "gen-after-insert");
    fake.seedFromTextFails = true;

    const { error, effect } = await runCall(
      generateDesign,
      generate("gen-after-insert", "landing.html", VALID_HTML),
      agentToolContext("generate-design"),
    );

    expect(error).toBeDefined();
    expect(await countRows(exec, "design_files", "gen-after-insert")).toBe(1);
    expect(effect).toMatchObject({ effect: "unknown" });
  });
});

describe("export-png", () => {
  const exportArgs = (designId: string) => ({
    designId,
    filename: "index.html",
  });
  const sendUpload = (outcome: "stored" | "rejected") => {
    globalThis.fetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    fake.upload.mockImplementation(async () => {
      await fetch("https://files.example.test/upload", { method: "PUT" });
      if (outcome === "rejected") throw new Error("The file store said no.");
      return { url: "https://files.example.test/screen.png" };
    });
  };

  it.each([
    ["a screenshot timeout", "page.screenshot: Timeout 30000ms exceeded."],
    ["a renderer crash", "page.screenshot: Target crashed"],
  ])(
    "is none after %s, before anything was uploaded",
    async (_name, message) => {
      await seedDesign(exec, `png-${message.length}`, [
        { filename: "index.html", content: VALID_HTML },
      ]);
      fake.screenshot.mockRejectedValue(new Error(message));

      const { error, effect, outcome } = await runCall(
        exportPng,
        exportArgs(`png-${message.length}`),
        agentToolContext("export-png"),
      );

      expect((error as Error).message).toContain(message);
      expect(fake.upload).not.toHaveBeenCalled();
      expect(effect).toMatchObject({ effect: "none" });
      expect(outcome.evidence?.writeObserved).toBe(false);
    },
  );

  it("is unknown when the upload was sent and the file store then rejected it", async () => {
    await seedDesign(exec, "png-upload-rejected", [
      { filename: "index.html", content: VALID_HTML },
    ]);
    fake.screenshot.mockResolvedValue(Buffer.from("png"));
    sendUpload("rejected");

    const { error, effect, outcome } = await runCall(
      exportPng,
      exportArgs("png-upload-rejected"),
      agentToolContext("export-png"),
    );

    expect(error).toMatchObject({ errorCode: "file_upload_failed" });
    expect(effect).toEqual({ effect: "unknown", changed: true });
    expect(outcome.evidence).toMatchObject({
      writeObserved: true,
      nestedWriteObserved: true,
      writeObservedChannel: "http",
    });
  });

  it("returns the stored image's URL when the upload succeeds", async () => {
    await seedDesign(exec, "png-ok", [
      { filename: "index.html", content: VALID_HTML },
    ]);
    fake.screenshot.mockResolvedValue(Buffer.from("png"));
    sendUpload("stored");

    const { error, result } = await runCall(
      exportPng,
      exportArgs("png-ok"),
      agentToolContext("export-png"),
    );

    expect(error).toBeUndefined();
    expect(result).toMatchObject({
      ok: true,
      url: "https://files.example.test/screen.png",
    });
  });
});

describe("edit-design introduced ids (db)", () => {
  const CARD =
    '<section id="card" data-agent-native-node-id="n1"><p>A</p></section>';
  const page = (body: string) =>
    `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
  let counter = 0;

  async function seedAndEdit(
    initial: string,
    edit: { search: string; replace: string },
  ): Promise<{ error: unknown; stored: string }> {
    const designId = `intro-ids-${++counter}`;
    await seedDesign(exec, designId, [
      { filename: "index.html", content: initial },
    ]);
    const { error } = await runCall(
      editDesign,
      { designId, filename: "index.html", edits: [edit] },
      agentToolContext("edit-design"),
    );
    const { rows } = await exec.execute({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: [`${designId}:index.html`],
    });
    return { error, stored: String(rows[0]?.content) };
  }

  describe("edit-design introduced ids", () => {
    it("saves a copied element with fresh ids and leaves the original alone", async () => {
      const { error, stored } = await seedAndEdit(page(CARD), {
        search: CARD,
        replace: CARD + CARD,
      });

      expect(error).toBeUndefined();
      expect(stored.match(/ id="card"/g)).toHaveLength(1);
      expect(stored.match(/ id="card-2"/g)).toHaveLength(1);
      const nodeIds = Array.from(
        stored.matchAll(/data-agent-native-node-id="([^"]*)"/g),
        ([, id]) => id,
      );
      expect(nodeIds).toHaveLength(2);
      expect(new Set(nodeIds).size).toBe(2);
      expect(nodeIds[0]).toBe("n1");
      expect(stored.indexOf('id="card"')).toBeLessThan(
        stored.indexOf('id="card-2"'),
      );
    });

    it("saves an edit that adds no copy exactly as sent", async () => {
      const { error, stored } = await seedAndEdit(page(CARD), {
        search: "<p>A</p>",
        replace: "<p>B</p>",
      });

      expect(error).toBeUndefined();
      expect(stored).toBe(page(CARD.replace("<p>A</p>", "<p>B</p>")));
    });
  });
});

describe("create-file free names (db)", () => {
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
          fake.outsideWriterNext = async () => {
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
      const blocked = await createIndex().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(isUniqueViolation(blocked)).toBe(true);

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
      expect(byId.oldest.filename).toBe("home.html");
      expect(byId["taken-two"].filename).toBe("home-2.html");
      expect(byId.middle.filename).toBe("home-3.html");
      expect(byId.newest.filename).toBe("home-4.html");
      expect(byId.newest.content).toContain("<p>newest</p>");
      expect(byId["names-legacy:about.html"].filename).toBe("about.html");

      await createIndex();
      expect(await renameLaterDuplicateDesignFilenames()).toEqual({
        renamed: 0,
        remaining: false,
      });
    });
  });
});

describe("move-design-element (db)", () => {
  const SOURCE_HTML =
    '<main><section data-agent-native-node-id="moved">Card</section><p data-agent-native-node-id="stay">Stay</p></main>';
  const DEST_HTML =
    '<main><p data-agent-native-node-id="dest-p">Dest</p></main>';
  let counter = 0;

  async function seedPair(
    source = SOURCE_HTML,
    dest = DEST_HTML,
  ): Promise<{ designId: string; sourceId: string; destId: string }> {
    const designId = `move-${++counter}`;
    await seedDesign(exec, designId, [
      { filename: "index.html", content: source },
      { filename: "second.html", content: dest },
    ]);
    return {
      designId,
      sourceId: `${designId}:index.html`,
      destId: `${designId}:second.html`,
    };
  }

  async function storedContent(fileId: string): Promise<string> {
    const { rows } = await exec.execute({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: [fileId],
    });
    return String(rows[0]?.content);
  }

  function nodeIdsOf(html: string): string[] {
    return Array.from(
      html.matchAll(/data-agent-native-node-id="([^"]*)"/g),
      ([, id]) => id,
    );
  }

  function move(args: Record<string, unknown>) {
    return runCall(
      moveDesignElement,
      args,
      agentToolContext("move-design-element"),
    );
  }

  async function moveError(args: Record<string, unknown>): Promise<unknown> {
    const { error, result } = await move(args);
    expect(result).toBeUndefined();
    return error;
  }

  describe("move-design-element", () => {
    it("moves an element to the second screen and persists both screens", async () => {
      const { designId, sourceId, destId } = await seedPair();

      const { error, result } = await move({
        designId,
        sourceFileId: sourceId,
        destFileId: destId,
        nodeId: "moved",
      });

      expect(error).toBeUndefined();
      expect(result).toMatchObject({
        designId,
        sourceFileId: sourceId,
        destFileId: destId,
        moved: true,
        movedNodeId: expect.any(String),
      });
      const sourceAfter = await storedContent(sourceId);
      const destAfter = await storedContent(destId);
      expect(sourceAfter).not.toContain("Card");
      expect(sourceAfter).toContain('data-agent-native-node-id="stay"');
      expect(destAfter).toContain("Card");
      expect(destAfter).toContain('data-agent-native-node-id="dest-p"');
      const movedNodeId = (result as { movedNodeId: string }).movedNodeId;
      expect(nodeIdsOf(destAfter)).toContain(movedNodeId);
    });

    it("keeps node ids unique in the destination when it already uses the moved id", async () => {
      const { designId, sourceId, destId } = await seedPair(
        SOURCE_HTML,
        '<main><div data-agent-native-node-id="moved">Existing</div></main>',
      );

      const { error, result } = await move({
        designId,
        sourceFileId: sourceId,
        destFileId: destId,
        nodeId: "moved",
      });

      expect(error).toBeUndefined();
      const destAfter = await storedContent(destId);
      const ids = nodeIdsOf(destAfter);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      expect(destAfter).toContain(
        `data-agent-native-node-id="moved">Existing</div>`,
      );
      expect(ids).toContain((result as { movedNodeId: string }).movedNodeId);
    });

    it("places the element before the anchor when placement is before", async () => {
      const { designId, sourceId, destId } = await seedPair(
        SOURCE_HTML,
        '<main><p data-agent-native-node-id="a1">A</p><p data-agent-native-node-id="a2">B</p></main>',
      );

      const { error } = await move({
        designId,
        sourceFileId: sourceId,
        destFileId: destId,
        nodeId: "moved",
        anchorNodeId: "a2",
        placement: "before",
      });

      expect(error).toBeUndefined();
      const destAfter = await storedContent(destId);
      const aIndex = destAfter.indexOf(">A</p>");
      const cardIndex = destAfter.indexOf(">Card<");
      const bIndex = destAfter.indexOf(">B</p>");
      expect(aIndex).toBeGreaterThan(-1);
      expect(cardIndex).toBeGreaterThan(aIndex);
      expect(bIndex).toBeGreaterThan(cardIndex);
    });

    it("rejects a move to the same screen and writes nothing", async () => {
      const { designId, sourceId } = await seedPair();

      expect(
        await moveError({
          designId,
          sourceFileId: sourceId,
          destFileId: sourceId,
          nodeId: "moved",
        }),
      ).toMatchObject({ errorCode: "same_screen", statusCode: 400 });
      expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
    });

    it("rejects an unknown destination screen with a 404 and writes nothing", async () => {
      const { designId, sourceId, destId } = await seedPair();

      expect(
        await moveError({
          designId,
          sourceFileId: sourceId,
          destFileId: `${designId}:missing.html`,
          nodeId: "moved",
        }),
      ).toMatchObject({ errorCode: "screen_not_found", statusCode: 404 });
      expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
      expect(await storedContent(destId)).toBe(DEST_HTML);
    });

    it("rejects an element that does not exist with a 409 and writes nothing", async () => {
      const { designId, sourceId, destId } = await seedPair();

      expect(
        await moveError({
          designId,
          sourceFileId: sourceId,
          destFileId: destId,
          nodeId: "no-such-node",
        }),
      ).toMatchObject({ errorCode: "move_unsupported", statusCode: 409 });
      expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
      expect(await storedContent(destId)).toBe(DEST_HTML);
    });

    it("rejects a CSS file as the destination screen", async () => {
      const { designId, sourceId } = await seedPair();
      const cssId = `${designId}:styles.css`;
      await exec.execute({
        sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, 'css', ?)",
        args: [cssId, designId, "styles.css", "main { color: red; }"],
      });

      expect(
        await moveError({
          designId,
          sourceFileId: sourceId,
          destFileId: cssId,
          nodeId: "moved",
        }),
      ).toMatchObject({ errorCode: "screen_not_found", statusCode: 404 });
      expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
      expect(await storedContent(cssId)).toBe("main { color: red; }");
    });

    it("refuses to move a locked element and leaves both screens unchanged", async () => {
      const locked =
        '<main><section data-agent-native-node-id="moved" data-agent-native-locked="true">Card</section><p data-agent-native-node-id="stay">Stay</p></main>';
      const { designId, sourceId, destId } = await seedPair(locked);

      expect(
        await moveError({
          designId,
          sourceFileId: sourceId,
          destFileId: destId,
          nodeId: "moved",
        }),
      ).toMatchObject({
        errorCode: "locked_layer_edit_rejected",
        statusCode: 409,
      });
      expect(await storedContent(sourceId)).toBe(locked);
      expect(await storedContent(destId)).toBe(DEST_HTML);
    });

    it("refuses to move an element inside a locked ancestor and leaves both screens unchanged", async () => {
      const locked =
        '<main><div data-agent-native-node-id="frame" data-agent-native-locked="true"><section data-agent-native-node-id="moved">Card</section></div><p data-agent-native-node-id="stay">Stay</p></main>';
      const { designId, sourceId, destId } = await seedPair(locked);

      expect(
        await moveError({
          designId,
          sourceFileId: sourceId,
          destFileId: destId,
          nodeId: "moved",
        }),
      ).toMatchObject({
        errorCode: "locked_layer_edit_rejected",
        statusCode: 409,
      });
      expect(await storedContent(sourceId)).toBe(locked);
      expect(await storedContent(destId)).toBe(DEST_HTML);
    });

    it("refuses to move the document shell and leaves both screens unchanged", async () => {
      const shell =
        '<html data-agent-native-node-id="root"><body><main><section data-agent-native-node-id="moved">Card</section></main></body></html>';
      const { designId, sourceId, destId } = await seedPair(shell);

      expect(
        await moveError({
          designId,
          sourceFileId: sourceId,
          destFileId: destId,
          nodeId: "root",
        }),
      ).toMatchObject({ errorCode: "move_unsupported", statusCode: 409 });
      expect(await storedContent(sourceId)).toBe(shell);
      expect(await storedContent(destId)).toBe(DEST_HTML);
    });

    it("reports a stale write as a conflict and leaves both screens unchanged", async () => {
      const { designId, sourceId, destId } = await seedPair();
      const concurrent =
        '<main><p data-agent-native-node-id="dest-p">Edited elsewhere</p></main>';
      fake.afterSnapshot = async () => {
        await exec.execute({
          sql: "UPDATE design_files SET content = ? WHERE id = ?",
          args: [concurrent, destId],
        });
      };

      const { error, effect } = await move({
        designId,
        sourceFileId: sourceId,
        destFileId: destId,
        nodeId: "moved",
      });

      expect(error).toMatchObject({
        errorCode: "design_edit_conflict",
        statusCode: 409,
        noWrite: true,
      });
      expect(effect).toMatchObject({ effect: "none" });
      expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
      expect(await storedContent(destId)).toBe(concurrent);
    });
  });
});

const action = setLayoutGrid;

describe("set-layout-grid schema", () => {
  const base = { designId: "design_1", screenId: "screen_1" };

  it("accepts a size, a visibility change, and a removal", () => {
    expect(action.schema.safeParse({ ...base, size: 8 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, visible: false }).success).toBe(
      true,
    );
    expect(action.schema.safeParse({ ...base, remove: true }).success).toBe(
      true,
    );
  });

  it("takes designId and screenId, since grids are per-screen", () => {
    expect(action.schema.safeParse({ screenId: "screen_1" }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      false,
    );
  });

  it("bounds size to the supported whole-pixel range", () => {
    expect(action.schema.safeParse({ ...base, size: 0 }).success).toBe(false);
    expect(action.schema.safeParse({ ...base, size: 1 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, size: 1000 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, size: 1001 }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ ...base, size: 8.5 }).success).toBe(false);
  });

  it("teaches the agent to author positions on the grid's multiples", () => {
    expect(action.tool.description).toMatch(/multiples of its size/);
  });
});

describe("set-layout-grid run", () => {
  let counter = 0;

  async function seedScreens(layoutGrids?: Record<string, unknown>): Promise<{
    designId: string;
    screenId: string;
    boardId: string;
    cssId: string;
  }> {
    const designId = `grid-${++counter}`;
    await seedDesign(exec, designId, [
      { filename: "index.html", content: "<main>Home</main>" },
      { filename: BOARD_FILENAME, content: "<body></body>" },
    ]);
    const cssId = `${designId}:styles.css`;
    await exec.execute({
      sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, 'css', ?)",
      args: [cssId, designId, "styles.css", "main { margin: 0; }"],
    });
    if (layoutGrids) {
      await exec.execute({
        sql: "UPDATE designs SET data = ? WHERE id = ?",
        args: [JSON.stringify({ layoutGrids }), designId],
      });
    }
    return {
      designId,
      screenId: `${designId}:index.html`,
      boardId: `${designId}:${BOARD_FILENAME}`,
      cssId,
    };
  }

  async function storedDesign(
    designId: string,
  ): Promise<{ data: string; updatedAt: unknown }> {
    const { rows } = await exec.execute({
      sql: "SELECT data, updated_at FROM designs WHERE id = ?",
      args: [designId],
    });
    return { data: String(rows[0]?.data), updatedAt: rows[0]?.updated_at };
  }

  async function storedGrids(designId: string): Promise<unknown> {
    const { data } = await storedDesign(designId);
    return (JSON.parse(data) as { layoutGrids?: unknown }).layoutGrids;
  }

  function setGrid(args: Record<string, unknown>) {
    return runCall(action, args, agentToolContext("set-layout-grid"));
  }

  async function expectRefused(
    designId: string,
    screenId: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const before = await storedDesign(designId);
    const { error, result, effect } = await setGrid({
      designId,
      screenId,
      ...extra,
    });
    expect(result).toBeUndefined();
    expect(error).toMatchObject({
      errorCode: "screen_not_found",
      statusCode: 404,
      noWrite: true,
    });
    expect(effect).toMatchObject({ effect: "none" });
    expect(await storedDesign(designId)).toEqual(before);
  }

  it("writes a grid for a real screen", async () => {
    const { designId, screenId } = await seedScreens();

    const { error, result } = await setGrid({ designId, screenId, size: 16 });

    expect(error).toBeUndefined();
    expect(result).toEqual({
      screenId,
      grid: { kind: "uniform", size: 16, visible: true },
      removed: false,
    });
    expect(await storedGrids(designId)).toEqual({
      [screenId]: { kind: "uniform", size: 16, visible: true },
    });
  });

  it("refuses the design id and writes no orphan entry", async () => {
    const { designId } = await seedScreens();

    await expectRefused(designId, designId, { size: 8 });
  });

  it("refuses a filename, which is not a screen id", async () => {
    const { designId } = await seedScreens();

    await expectRefused(designId, "index.html", { size: 8 });
  });

  it("refuses a screen id that belongs to another design", async () => {
    const { designId } = await seedScreens();
    const other = await seedScreens();

    await expectRefused(designId, other.screenId, { size: 8 });
    expect(await storedGrids(other.designId)).toBeUndefined();
  });

  it("refuses the board file and a non-HTML file", async () => {
    const { designId, boardId, cssId } = await seedScreens();

    await expectRefused(designId, boardId, { size: 8 });
    await expectRefused(designId, cssId, { size: 8 });
  });

  it("refuses to remove a grid from an id that never had one", async () => {
    const { designId } = await seedScreens();

    await expectRefused(designId, designId, { remove: true });
    await expectRefused(designId, "constructor", { remove: true });
  });

  it("removes an existing orphan grid so earlier wrong ids can be cleaned up", async () => {
    const orphan = { kind: "uniform", size: 8, visible: true };
    const { designId, screenId } = await seedScreens();
    const real = { kind: "uniform", size: 4, visible: false };
    await exec.execute({
      sql: "UPDATE designs SET data = ? WHERE id = ?",
      args: [
        JSON.stringify({
          layoutGrids: { "grid-orphan": orphan, [screenId]: real },
        }),
        designId,
      ],
    });

    const { error, result } = await setGrid({
      designId,
      screenId: "grid-orphan",
      remove: true,
    });

    expect(error).toBeUndefined();
    expect(result).toEqual({
      screenId: "grid-orphan",
      grid: null,
      removed: true,
    });
    expect(await storedGrids(designId)).toEqual({ [screenId]: real });
  });

  it("still refuses to set a grid on an id that already holds an orphan", async () => {
    const { designId } = await seedScreens({
      "grid-orphan": { kind: "uniform", size: 8, visible: true },
    });

    await expectRefused(designId, "grid-orphan", { size: 24 });
  });

  it("removes a real screen's grid and leaves other screens' grids alone", async () => {
    const { designId, screenId } = await seedScreens();
    await setGrid({ designId, screenId, size: 8 });

    const { error, result } = await setGrid({
      designId,
      screenId,
      remove: true,
    });

    expect(error).toBeUndefined();
    expect(result).toEqual({ screenId, grid: null, removed: true });
    expect(await storedGrids(designId)).toEqual({});
  });
});
