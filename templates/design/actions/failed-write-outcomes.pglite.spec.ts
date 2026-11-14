import { closeDbExec, type DbExec } from "@agent-native/core/db";
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
}));

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

import {
  agentToolContext,
  bootDesignDatabase,
  countRows,
  runCall,
  seedDesign,
} from "../server/lib/failed-write-test-harness.js";
import createFile from "./create-file.js";
import editDesign from "./edit-design.js";
import exportPng from "./export-png.js";
import generateDesign from "./generate-design.js";
import updateFile from "./update-file.js";

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
