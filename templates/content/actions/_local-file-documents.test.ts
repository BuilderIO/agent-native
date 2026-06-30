import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLocalFileDocument,
  localFileDocumentId,
  moveLocalFileDocument,
  updateLocalFileDocument,
} from "./_local-file-documents";
import editDocument from "./edit-document";
import pullDocument from "./pull-document";
import searchDocuments from "./search-documents";

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
  appStateGet: vi.fn(),
  appStatePut: vi.fn(),
  appStateDelete: vi.fn(),
}));

const tmpRoots: string[] = [];
const OLD_ENV = {
  AGENT_NATIVE_MODE: process.env.AGENT_NATIVE_MODE,
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
  process.env.AGENT_NATIVE_MODE = "local-files";
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

  it("lets agent edit/search/pull actions operate on local files", async () => {
    const root = setupLocalContentRepo();
    writeFile(
      root,
      "docs/guide.mdx",
      '---\ntitle: "Guide"\n---\n\nAlpha beta needle.',
    );
    writeFile(
      root,
      "blog/hidden.mdx",
      '---\ntitle: "Hidden"\nhideFromSearch: true\n---\n\nneedle secret',
    );
    const id = localFileDocumentId("docs/guide.mdx");

    await expect(
      editDocument.run({ id, find: "beta", replace: "gamma" }),
    ).resolves.toMatchObject({ applied: 1, total: 1 });
    expect(readFile(root, "docs/guide.mdx")).toContain("Alpha gamma needle.");

    await expect(
      searchDocuments.run({ query: "needle", limit: 10 }),
    ).resolves.toMatchObject({
      documents: [
        expect.objectContaining({
          id,
          title: "Guide",
          snippet: expect.stringContaining("needle"),
        }),
      ],
    });

    await expect(
      pullDocument.run({ id, format: "markdown" }),
    ).resolves.toMatchObject({
      id,
      title: "Guide",
      content: expect.stringContaining("Alpha gamma needle."),
    });
  });

  it("reuses parsed local documents across repeated searches", async () => {
    const root = setupLocalContentRepo();
    writeFile(root, "docs/guide.mdx", "# Guide\n\nAlpha needle.");
    writeFile(root, "docs/other.mdx", "# Other\n\nBeta needle.");

    const openSpy = vi.spyOn(fs, "openSync");
    const localContentOpens = () =>
      openSpy.mock.calls.filter(
        ([filePath]) =>
          typeof filePath === "string" && filePath.endsWith(".mdx"),
      ).length;

    await searchDocuments.run({ query: "needle", limit: 10 });
    const opensAfterFirstSearch = localContentOpens();
    expect(opensAfterFirstSearch).toBeGreaterThan(0);

    await searchDocuments.run({ query: "alpha", limit: 10 });
    expect(localContentOpens()).toBe(opensAfterFirstSearch);

    await updateLocalFileDocument(localFileDocumentId("docs/guide.mdx"), {
      content: "# Guide\n\nFresh needle.",
    });

    openSpy.mockClear();
    await expect(
      searchDocuments.run({ query: "fresh", limit: 10 }),
    ).resolves.toMatchObject({
      documents: [
        expect.objectContaining({
          id: localFileDocumentId("docs/guide.mdx"),
          snippet: expect.stringContaining("Fresh needle"),
        }),
      ],
    });
    expect(localContentOpens()).toBeGreaterThan(0);
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
