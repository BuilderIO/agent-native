import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  resourcePut: vi.fn(),
}));

vi.mock("../../resources/store.js", () => ({
  resourcePut: mocks.resourcePut,
  SHARED_OWNER: "__shared__",
}));

import migrateLearningsScript from "./migrate-learnings.js";

let tempDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-learnings-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
});

afterAll(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("migrate-learnings script", () => {
  beforeEach(() => {
    mocks.resourcePut.mockReset();
    mocks.resourcePut.mockResolvedValue({ size: 42 });
    fs.rmSync(path.join(tempDir, "learnings.md"), { force: true });
  });

  it("does nothing when no learnings.md exists", async () => {
    await migrateLearningsScript([]);

    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });

  it("writes the file to the SHARED scope at path LEARNINGS.md", async () => {
    // This exact owner/path pair is what loadResourcesForPrompt reads via an
    // exact-match lookup — lowercase "learnings.md" or a personal owner would
    // never reach the production agent's prompt.
    const content = "# Learnings\n\n- Something worth keeping\n";
    fs.writeFileSync(path.join(tempDir, "learnings.md"), content);

    await migrateLearningsScript([]);

    expect(mocks.resourcePut).toHaveBeenCalledOnce();
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "__shared__",
      "LEARNINGS.md",
      content,
      "text/markdown",
    );
  });
});
