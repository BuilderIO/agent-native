import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  resolveAccess: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: mocks.track,
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "local@example.com"),
}));

vi.mock("../server/db/index.js", () => ({}));

import {
  safeGeneratedFilename,
  tenantExportDir,
} from "../server/lib/tenant-files";
import exportPptx from "./export-pptx";

// A persisted PPTX export writes into the working directory's export folder,
// so the working directory is a temp root and hosted flags are off.
const HOSTED_ENV = [
  "NETLIFY",
  "NETLIFY_LOCAL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "LAMBDA_TASK_ROOT",
  "VERCEL",
  "VERCEL_ENV",
  "CF_PAGES",
  "RENDER",
  "FLY_APP_NAME",
  "K_SERVICE",
];
let root: string;

beforeEach(() => {
  mocks.noteExternalWrite.mockClear();
  mocks.track.mockReset();
  mocks.resolveAccess.mockResolvedValue({
    resource: {
      title: "Deck",
      data: JSON.stringify({
        slides: [{ id: "s1", content: importedSlide("") }],
      }),
    },
  });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slides-pptx-observed-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  for (const name of HOSTED_ENV) vi.stubEnv(name, "");
  vi.spyOn(fs, "mkdirSync");
  vi.spyOn(fs, "writeFileSync");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function importedSlide(element: string) {
  return `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" style="background:#000000;">${element}</div>`;
}

describe("export-pptx write observation", () => {
  it("notes the write before creating the export folder and saving the file", async () => {
    const filename = safeGeneratedFilename(
      "requested-export",
      ".pptx",
      "deck-1",
    );
    const exportDir = tenantExportDir("local@example.com");

    await exportPptx.run({ deckId: "deck-1", includeNotes: true }, {
      caller: "http",
      slidesPptxDownload: true,
      slidesPptxDownloadFilename: filename,
      slidesPptxDownloadPersist: true,
    } as never);

    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(fs.existsSync(path.join(exportDir, filename))).toBe(true);
    const mkdir = vi.mocked(fs.mkdirSync);
    const write = vi.mocked(fs.writeFileSync);
    expect(mkdir).toHaveBeenCalledWith(exportDir, { recursive: true });
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mkdir.mock.invocationCallOrder[0],
    );
    expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0],
    );
  });

  it("notes nothing for a direct download that is not persisted", async () => {
    const result = await exportPptx.run(
      { deckId: "deck-1", includeNotes: true },
      {
        caller: "http",
        slidesPptxDownload: true,
        slidesPptxDownloadFilename: "requested-export.pptx",
      } as never,
    );

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
