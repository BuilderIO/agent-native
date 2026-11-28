import { describe, expect, it } from "vitest";

import { readLocalFolderMarkdown } from "./local-folder-read";

type FakeEntry = FakeFile | FakeDirectory;
type FakeFile = { kind: "file"; name: string; getFile(): Promise<File> };
type FakeDirectory = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<FakeEntry>;
  getDirectoryHandle(name: string): Promise<FakeDirectory>;
};

function file(name: string, text: string, size = text.length): FakeFile {
  return {
    kind: "file",
    name,
    getFile: async () => ({ size, text: async () => text }) as File,
  };
}

function directory(
  name: string,
  entries: FakeEntry[],
  lookup?: (name: string) => Promise<FakeDirectory>,
): FakeDirectory {
  return {
    kind: "directory",
    name,
    async *values() {
      yield* entries;
    },
    getDirectoryHandle:
      lookup ??
      (async (child) => {
        const found = entries.find(
          (entry): entry is FakeDirectory =>
            entry.kind === "directory" && entry.name === child,
        );
        if (!found) throw new DOMException("Not there.", "NotFoundError");
        return found;
      }),
  };
}

describe("readLocalFolderMarkdown", () => {
  it("reads the content folder and lists the Markdown files it doesn't send", async () => {
    const root = directory("repo", [
      file("README.md", "# Repo"),
      directory("content", [
        file("guide.md", "# Guide"),
        file("huge.md", "# Huge", 3 * 1024 * 1024),
        file("notes.txt", "plain"),
        directory("node_modules", [file("dep.md", "# Dep")]),
        directory("nested", [file("deep.mdx", "# Deep")]),
      ]),
    ]);

    await expect(readLocalFolderMarkdown(root)).resolves.toEqual({
      files: {
        "content/guide.md": "# Guide",
        "content/nested/deep.mdx": "# Deep",
      },
      skippedPaths: ["content/huge.md"],
    });
  });

  it("reads the folder itself when it has no content folder", async () => {
    const root = directory("notes", [file("today.md", "# Today")]);

    await expect(readLocalFolderMarkdown(root)).resolves.toEqual({
      files: { "today.md": "# Today" },
      skippedPaths: [],
    });
  });

  it("fails the read when the content folder can't be opened, instead of reading the folder above it", async () => {
    const root = directory("repo", [file("README.md", "# Repo")], async () => {
      throw new DOMException("Permission lost.", "NotAllowedError");
    });

    await expect(readLocalFolderMarkdown(root)).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });
});
