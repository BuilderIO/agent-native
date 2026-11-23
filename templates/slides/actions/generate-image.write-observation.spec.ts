import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import main from "./generate-image";

const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  delegateImageGenerationToAssets: vi.fn(),
  getProvider: vi.fn(),
  generate: vi.fn(),
  fetchReferenceImages: vi.fn(),
}));

vi.mock("dotenv", () => ({ config: vi.fn() }));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("@agent-native/core/extensions/url-safety", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/extensions/url-safety")
  >()),
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("../server/lib/assets-image-delegation.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/assets-image-delegation.js")
  >()),
  delegateImageGenerationToAssets: mocks.delegateImageGenerationToAssets,
}));

vi.mock("../server/handlers/image-providers/index.js", () => ({
  getProvider: mocks.getProvider,
}));

vi.mock("../server/lib/reference-image-fetch.js", () => ({
  fetchReferenceImages: mocks.fetchReferenceImages,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(actual.mkdirSync),
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

// Both save paths write variations under a temp folder that does not exist
// yet, so each write reports itself before the folder is created.
const NO_REFERENCES = {
  requested: 0,
  attempted: 0,
  loaded: 0,
  failed: 0,
  skipped: 0,
  totalBytes: 0,
  images: [],
  failures: [],
  skippedReasons: [],
};
let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProvider.mockResolvedValue({ generate: mocks.generate });
  mocks.generate.mockResolvedValue({
    imageData: Buffer.from([1, 2, 3, 4]),
    mimeType: "image/png",
  });
  mocks.fetchReferenceImages.mockResolvedValue(NO_REFERENCES);
  mocks.ssrfSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array([9, 8]).buffer,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dir = mkdtempSync(path.join(os.tmpdir(), "slides-generate-image-observed-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("generate-image write observation", () => {
  it("notes the local provider write before creating the output folder", async () => {
    const outputFolder = path.join(dir, "gen");
    const outputPrefix = path.join(outputFolder, "hero");

    await main(["--prompt", "a hero image", "--output", outputPrefix]);

    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(mkdirSync).toHaveBeenCalledWith(outputFolder, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      `${outputPrefix}-v1.png`,
      Buffer.from([1, 2, 3, 4]),
    );
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mkdirSync).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(mkdirSync).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeFileSync).mock.invocationCallOrder[0],
    );
  });

  it("notes the Assets download write before creating the output folder", async () => {
    const outputFolder = path.join(dir, "brand");
    const outputPrefix = path.join(outputFolder, "hero");
    mocks.delegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "Done: https://assets.example.com/download/hero.png",
      target: "https://assets.example.com",
    });

    await main([
      "--prompt",
      "a hero image",
      "--use-brand-library",
      "true",
      "--output",
      outputPrefix,
    ]);

    expect(mocks.getProvider).not.toHaveBeenCalled();
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      "https://assets.example.com/download/hero.png",
      expect.anything(),
      { httpsOnly: true, maxRedirects: 2 },
    );
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(mkdirSync).toHaveBeenCalledWith(outputFolder, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      `${outputPrefix}-v1.png`,
      Buffer.from([9, 8]),
    );
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mkdirSync).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(mkdirSync).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeFileSync).mock.invocationCallOrder[0],
    );
  });
});
