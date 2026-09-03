import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLocalFileDocument,
  listLocalFileDocuments,
  localFileDocumentId,
  moveLocalFileDocument,
  removeContentLocalFileRoots,
  updateLocalFileDocument,
} from "./_local-file-documents";

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
  appStateGet: vi.fn(),
  appStatePut: vi.fn(),
  appStateDelete: vi.fn(),
}));

const tmpRoots: string[] = [];
const OLD_ENV = {
  AGENT_NATIVE_DATA_MODE: process.env.AGENT_NATIVE_DATA_MODE,
  AGENT_NATIVE_MANIFEST: process.env.AGENT_NATIVE_MANIFEST,
  AGENT_NATIVE_MANIFEST_PATH: process.env.AGENT_NATIVE_MANIFEST_PATH,
};

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFile(root: string, filePath: string, content: string) {
  const absolutePath = path.join(root, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function readFile(root: string, filePath: string) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function setupLocalContentRepo(options: { profile?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-content-local-"));
  tmpRoots.push(root);
  const manifestPath = path.join(root, "agent-native.json");
  writeJson(manifestPath, {
    mode: "local-files",
    apps: {
      content: {
        profile: options.profile,
        roots: [
          { name: "Docs", path: "docs", extensions: [".md", ".mdx"] },
          { name: "Blog", path: "blog", extensions: [".md", ".mdx"] },
          {
            name: "Resources",
            path: "resources",
            extensions: [".md", ".mdx"],
          },
        ],
      },
    },
  });
  process.env.AGENT_NATIVE_MANIFEST_PATH = manifestPath;
  return root;
}

beforeEach(() => {
  for (const key of Object.keys(OLD_ENV)) {
    delete process.env[key as keyof typeof OLD_ENV];
  }
});

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.clearAllMocks();
});

describe("content local file documents", () => {
  it("leaves raw MDX bytes untouched for no-op content updates", async () => {
    const root = setupLocalContentRepo();
    const rawMdx = [
      "import { FrameworkTabs } from '../components/FrameworkTabs';",
      "",
      "<!-- keep this comment hidden -->",
      "",
      "| Name | Value |",
      "| ---- | ----- |",
      "| <A> | B |",
      "",
      '<FrameworkTabs value="react" />',
      "",
    ].join("\n");
    writeFile(root, "docs/raw.mdx", rawMdx);

    await updateLocalFileDocument(localFileDocumentId("docs/raw.mdx"), {
      content: rawMdx,
    });

    expect(readFile(root, "docs/raw.mdx")).toBe(rawMdx);
  });

  it("reuses parsed local documents across explicit compatibility reads", async () => {
    const root = setupLocalContentRepo();
    writeFile(root, "docs/guide.mdx", "# Guide\n\nAlpha needle.");
    writeFile(root, "docs/other.mdx", "# Other\n\nBeta needle.");

    const openSpy = vi.spyOn(fs, "openSync");
    const localContentOpens = () =>
      openSpy.mock.calls.filter(
        ([filePath]) =>
          typeof filePath === "string" && filePath.endsWith(".mdx"),
      ).length;

    const first = await listLocalFileDocuments();
    expect(
      first.filter((document) => document.source?.kind === "file"),
    ).toHaveLength(2);
    const opensAfterFirstRead = localContentOpens();
    expect(opensAfterFirstRead).toBeGreaterThan(0);

    await listLocalFileDocuments();
    expect(localContentOpens()).toBe(opensAfterFirstRead);

    await updateLocalFileDocument(localFileDocumentId("docs/guide.mdx"), {
      content: "# Guide\n\nFresh needle.",
    });

    openSpy.mockClear();
    await expect(listLocalFileDocuments()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: localFileDocumentId("docs/guide.mdx"),
          content: expect.stringContaining("Fresh needle"),
        }),
      ]),
    );
    expect(localContentOpens()).toBeGreaterThan(0);
  });

  it("removes configured local roots from the Content manifest without deleting files", async () => {
    const root = setupLocalContentRepo();
    writeFile(root, "docs/guide.mdx", "# Guide\n\nStill on disk.");

    await expect(removeContentLocalFileRoots("docs")).resolves.toMatchObject({
      removed: 1,
      roots: ["docs"],
    });

    const manifest = JSON.parse(readFile(root, "agent-native.json"));
    expect(manifest.apps.content).toMatchObject({
      mode: "local-files",
      roots: [
        { name: "Blog", path: "blog", extensions: [".md", ".mdx"] },
        {
          name: "Resources",
          path: "resources",
          extensions: [".md", ".mdx"],
        },
      ],
    });
    expect(readFile(root, "docs/guide.mdx")).toContain("Still on disk.");

    await expect(removeContentLocalFileRoots()).resolves.toMatchObject({
      removed: 2,
      roots: ["blog", "resources"],
    });

    const emptiedManifest = JSON.parse(readFile(root, "agent-native.json"));
    expect(emptiedManifest.apps.content).toMatchObject({
      mode: "database",
      roots: [],
    });
  });

  it("does not overwrite files during concurrent same-title creates", async () => {
    const root = setupLocalContentRepo();

    const [first, second] = await Promise.all([
      createLocalFileDocument({ title: "Launch Post", content: "First" }),
      createLocalFileDocument({ title: "Launch Post", content: "Second" }),
    ]);

    expect(first.source?.path).not.toBe(second.source?.path);
    expect([
      readFile(root, first.source?.path ?? ""),
      readFile(root, second.source?.path ?? ""),
    ]).toEqual(expect.arrayContaining([expect.stringContaining("First")]));
    expect([
      readFile(root, first.source?.path ?? ""),
      readFile(root, second.source?.path ?? ""),
    ]).toEqual(expect.arrayContaining([expect.stringContaining("Second")]));
  });

  it("keeps blank docs profile creates formatter-clean", async () => {
    const root = setupLocalContentRepo({ profile: "docs/no-bookkeeping" });

    const doc = await createLocalFileDocument({ title: "" });

    expect(readFile(root, doc.source?.path ?? "")).toBe(
      '---\ntitle: "Untitled"\n---\n',
    );
  });

  it("fails loudly instead of pretending local file moves succeeded", async () => {
    const root = setupLocalContentRepo();
    writeFile(root, "docs/guide.mdx", "# Guide");

    await expect(
      moveLocalFileDocument(localFileDocumentId("docs/guide.mdx"), {
        parentId: null,
      }),
    ).rejects.toThrow("not supported");
  });

  it("keeps default local file edits on the existing bookkeeping frontmatter path", async () => {
    const root = setupLocalContentRepo();
    writeFile(root, "docs/plain.mdx", "# Plain\n\nOld body");

    await updateLocalFileDocument(localFileDocumentId("docs/plain.mdx"), {
      content: "New body",
    });

    const written = readFile(root, "docs/plain.mdx");
    expect(written).toContain('title: "Plain"');
    expect(written).toContain("icon: null");
    expect(written).toContain("isFavorite: false");
    expect(written).toContain("updatedAt:");
    expect(written).toContain("New body");
  });

  it("does not add bookkeeping frontmatter for docs profile content-only edits", async () => {
    const root = setupLocalContentRepo({ profile: "docs/no-bookkeeping" });
    writeFile(root, "docs/plain.mdx", "# Plain\n\nOld body");

    await updateLocalFileDocument(localFileDocumentId("docs/plain.mdx"), {
      content: "# Plain\n\nNew body",
    });

    expect(readFile(root, "docs/plain.mdx")).toBe("# Plain\n\nNew body");
  });

  it("writes explicit metadata changes for docs profile local files", async () => {
    const root = setupLocalContentRepo({ profile: "docs/no-bookkeeping" });
    writeFile(root, "docs/plain.mdx", "# Plain\n\nBody");

    await updateLocalFileDocument(localFileDocumentId("docs/plain.mdx"), {
      icon: "book",
      isFavorite: true,
    });

    const written = readFile(root, "docs/plain.mdx");
    expect(written).toContain('icon: "book"');
    expect(written).toContain("isFavorite: true");
    expect(written).not.toContain("updatedAt:");
  });
});
