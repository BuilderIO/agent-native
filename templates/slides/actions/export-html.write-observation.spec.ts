import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  resolveAccess: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("@agent-native/core/server", () => ({}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "local@example.com",
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("../server/db/index.js", () => ({}));

import { tenantExportDir } from "../server/lib/tenant-files";
import exportHtml from "./export-html";

// Serverless runtimes skip the local write entirely, so the local path needs
// every serverless flag cleared and the working directory set to a temp root.
const SERVERLESS_ENV = ["NETLIFY", "VERCEL", "AWS_LAMBDA_FUNCTION_NAME"];
let root: string;

beforeEach(() => {
  mocks.noteExternalWrite.mockClear();
  mocks.track.mockReset();
  mocks.resolveAccess.mockResolvedValue({
    resource: {
      title: "Deck",
      data: JSON.stringify({
        slides: [{ id: "s1", content: "<p>First</p>" }],
      }),
    },
  });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slides-html-observed-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  for (const name of SERVERLESS_ENV) vi.stubEnv(name, "");
  vi.spyOn(fs, "mkdirSync");
  vi.spyOn(fs, "writeFileSync");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("export-html write observation", () => {
  it("notes the write before creating the export folder and saving the HTML", async () => {
    const exportDir = tenantExportDir("local@example.com");

    const result = await exportHtml.run({ deckId: "deck-1" }, {
      caller: "ui",
    } as never);

    expect(result.filePath).toBeDefined();
    expect(fs.existsSync(result.filePath ?? "")).toBe(true);
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    const mkdir = vi.mocked(fs.mkdirSync);
    const write = vi.mocked(fs.writeFileSync);
    expect(mkdir).toHaveBeenCalledWith(exportDir, { recursive: true });
    expect(write).toHaveBeenCalledWith(result.filePath, result.html);
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mkdir.mock.invocationCallOrder[0],
    );
    expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0],
    );
  });

  it("notes nothing and writes nothing on a serverless runtime", async () => {
    vi.stubEnv("NETLIFY", "1");

    const result = await exportHtml.run({ deckId: "deck-1" }, {
      caller: "ui",
    } as never);

    expect(result.filePath).toBeUndefined();
    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
