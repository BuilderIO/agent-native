import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import main from "./edit-image";

const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  resolveGeminiApiKey: vi.fn(),
  generateContent: vi.fn(),
}));

vi.mock("dotenv", () => ({ config: vi.fn() }));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  resolveGeminiApiKey: mocks.resolveGeminiApiKey,
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
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

// The CLI writes its variations to disk, so each write runs against a temp
// folder and reports itself before the folder is created.
let dir: string;
let input: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveGeminiApiKey.mockResolvedValue("test-gemini-key");
  mocks.generateContent.mockResolvedValue({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: "image/png",
                data: Buffer.from([9, 8, 7, 6]).toString("base64"),
              },
            },
          ],
        },
      },
    ],
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dir = mkdtempSync(path.join(os.tmpdir(), "slides-edit-image-observed-"));
  input = path.join(dir, "in.png");
  writeFileSync(input, Buffer.from([1, 2, 3, 4]));
  vi.mocked(mkdirSync).mockClear();
  vi.mocked(writeFileSync).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("edit-image write observation", () => {
  it("notes the write before creating the output folder and saving the variation", async () => {
    const outputFolder = path.join(dir, "out");
    const outputPrefix = path.join(outputFolder, "edited");

    await main([
      "--input",
      input,
      "--prompt",
      "make it blue",
      "--output",
      outputPrefix,
    ]);

    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(mkdirSync).toHaveBeenCalledWith(outputFolder, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      `${outputPrefix}-v1.png`,
      Buffer.from([9, 8, 7, 6]),
    );
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mkdirSync).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(mkdirSync).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeFileSync).mock.invocationCallOrder[0],
    );
  });

  it("notes nothing when no output prefix is given", async () => {
    await main(["--input", input, "--prompt", "make it blue"]);

    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
