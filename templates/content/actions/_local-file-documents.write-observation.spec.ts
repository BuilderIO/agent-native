import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Removing a root rewrites the workspace's agent-native.json, so the rewrite
// reports itself as a local-file write before it touches the manifest.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  getLocalArtifactApp: vi.fn(),
  loadAgentNativeManifest: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("@agent-native/core/local-artifacts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/local-artifacts")
  >()),
  getLocalArtifactApp: mocks.getLocalArtifactApp,
  loadAgentNativeManifest: mocks.loadAgentNativeManifest,
}));

const { removeContentLocalFileRoots } = await import("./_local-file-documents");

const tmpRoots: string[] = [];

/** A temp workspace whose agent-native.json declares one Content docs root. */
function workspace() {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "an-content-roots-"));
  tmpRoots.push(root);
  const manifestPath = path.join(root, "agent-native.json");
  fsSync.writeFileSync(
    manifestPath,
    JSON.stringify({
      mode: "local-files",
      apps: {
        content: {
          mode: "local-files",
          roots: [{ path: "docs", extensions: [".md", ".mdx"] }],
        },
      },
    }),
    "utf8",
  );
  mocks.getLocalArtifactApp.mockResolvedValue({ mode: "local-files" });
  mocks.loadAgentNativeManifest.mockResolvedValue({
    path: manifestPath,
    rootDir: root,
    manifest: {},
  });
  return manifestPath;
}

beforeEach(() => {
  mocks.noteExternalWrite.mockClear();
  mocks.getLocalArtifactApp.mockReset();
  mocks.loadAgentNativeManifest.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tmpRoots.splice(0)) {
    fsSync.rmSync(root, { recursive: true, force: true });
  }
});

describe("removeContentLocalFileRoots write observation", () => {
  it("notes a local-file write before the manifest is rewritten without the root", async () => {
    const manifestPath = workspace();
    const writeFile = vi.spyOn(fs, "writeFile");

    const result = await removeContentLocalFileRoots("docs");

    expect(result).toEqual({
      removed: 1,
      roots: ["docs"],
      manifestPath,
    });
    expect(writeFile).toHaveBeenCalledWith(
      manifestPath,
      expect.any(String),
      "utf8",
    );
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-file");
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      writeFile.mock.invocationCallOrder[0],
    );
    expect(
      JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown,
    ).toEqual({
      mode: "local-files",
      apps: { content: { mode: "database", roots: [] } },
    });
  });

  it("notes nothing when the requested root is not declared", async () => {
    const manifestPath = workspace();
    const writeFile = vi.spyOn(fs, "writeFile");

    await expect(removeContentLocalFileRoots("blog")).rejects.toThrow(
      "No matching local file root was found.",
    );

    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(
      JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown,
    ).toMatchObject({
      apps: { content: { roots: [{ path: "docs" }] } },
    });
  });
});
