import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

const SOURCE_PATH = "content/getting-started.mdx";

async function installDirectoryPicker(page: Page, root: string) {
  await page.exposeBinding(
    "__contentE2eListDir",
    async (_source, dir: string) =>
      (
        await fs.readdir(dir, {
          withFileTypes: true,
        })
      ).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
        path: path.join(dir, entry.name),
      })),
  );
  await page.exposeBinding(
    "__contentE2eReadFile",
    async (_source, filePath: string) => {
      const stat = await fs.stat(filePath);
      return {
        content: await fs.readFile(filePath, "utf8"),
        lastModified: stat.mtimeMs,
      };
    },
  );
  await page.exposeBinding(
    "__contentE2eWriteFile",
    async (_source, filePath: string, content: string) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    },
  );
  await page.exposeBinding(
    "__contentE2eEnsureDirectory",
    async (_source, dir: string) => {
      await fs.mkdir(dir, { recursive: true });
    },
  );
  await page.exposeBinding(
    "__contentE2eEnsureFile",
    async (_source, filePath: string) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const handle = await fs.open(filePath, "a");
      await handle.close();
    },
  );

  await page.addInitScript(
    ({ rootPath, rootName }) => {
      type Entry = { name: string; kind: "directory" | "file"; path: string };
      const api = window as any;

      const joinPath = (base: string, segment: string) =>
        `${base.replace(/\/+$/, "")}/${segment}`;

      class E2EFileHandle {
        kind = "file" as const;
        name: string;
        path: string;

        constructor(filePath: string, name: string) {
          this.path = filePath;
          this.name = name;
        }

        async getFile() {
          const file = await api.__contentE2eReadFile(this.path);
          return new File([file.content], this.name, {
            lastModified: file.lastModified,
            type: this.name.endsWith(".mdx") ? "text/mdx" : "text/markdown",
          });
        }

        async createWritable() {
          return {
            write: async (data: unknown) => {
              await api.__contentE2eWriteFile(this.path, String(data));
            },
            close: async () => {},
          };
        }
      }

      class E2EDirectoryHandle {
        kind = "directory" as const;
        name: string;
        path: string;

        constructor(dirPath: string, name: string) {
          this.path = dirPath;
          this.name = name;
        }

        async *values() {
          const entries = (await api.__contentE2eListDir(this.path)) as Entry[];
          for (const entry of entries) {
            if (entry.kind === "directory") {
              yield new E2EDirectoryHandle(entry.path, entry.name);
            } else {
              yield new E2EFileHandle(entry.path, entry.name);
            }
          }
        }

        async getDirectoryHandle(name: string, options?: { create?: boolean }) {
          const dirPath = joinPath(this.path, name);
          if (options?.create) await api.__contentE2eEnsureDirectory(dirPath);
          return new E2EDirectoryHandle(dirPath, name);
        }

        async getFileHandle(name: string, options?: { create?: boolean }) {
          const filePath = joinPath(this.path, name);
          if (options?.create) await api.__contentE2eEnsureFile(filePath);
          return new E2EFileHandle(filePath, name);
        }

        async queryPermission() {
          return "granted";
        }

        async requestPermission() {
          return "granted";
        }
      }

      const createRootHandle = () => new E2EDirectoryHandle(rootPath, rootName);
      if (localStorage.getItem("__contentE2eDirectoryGranted") === "true") {
        api.__contentLocalSourceDirectoryHandle = createRootHandle();
      }
      api.showDirectoryPicker = async () => {
        localStorage.setItem("__contentE2eDirectoryGranted", "true");
        const handle = createRootHandle();
        api.__contentLocalSourceDirectoryHandle = handle;
        return handle;
      };
    },
    { rootPath: root, rootName: path.basename(root) },
  );
}

async function readSourceFile(root: string) {
  return fs.readFile(path.join(root, SOURCE_PATH), "utf8");
}

test("browser local folder edits write the selected MDX file", async ({
  page,
}) => {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "content-local-e2e-"));
  await fs.mkdir(path.join(root, "content"), { recursive: true });
  await fs.writeFile(
    path.join(root, SOURCE_PATH),
    [
      "---",
      'title: "Getting Started"',
      "---",
      "",
      "Original body from disk.",
    ].join("\n"),
    "utf8",
  );

  await installDirectoryPicker(page, root);

  await page.goto("/local-files", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /choose folder/i }).click();

  async function findImportedDocId() {
    const res = await page.request.get(
      "/_agent-native/actions/list-documents",
      {
        headers: {
          "X-Agent-Native-Frontend": "1",
          "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
          "X-Agent-Native-Build-Id": "development",
        },
      },
    );
    if (!res.ok()) return null;
    const body = await res.json();
    const docs = Array.isArray(body?.documents) ? body.documents : body;
    const doc = Array.isArray(docs)
      ? docs.find(
          (candidate) =>
            candidate?.source?.path === SOURCE_PATH &&
            candidate?.source?.rootPath === path.basename(root),
        )
      : null;
    return typeof doc?.id === "string" ? doc.id : null;
  }

  let importedDocId: string | null = null;
  await expect
    .poll(async () => (importedDocId = await findImportedDocId()), {
      timeout: 20_000,
    })
    .toBeTruthy();

  await page.goto(`/page/${importedDocId}`, { waitUntil: "domcontentloaded" });
  const editor = page.locator(".notion-editor.ProseMirror").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor).toContainText("Original body from disk.", {
    timeout: 20_000,
  });

  await editor.fill("Updated from browser folder smoke.");

  await expect
    .poll(async () => readSourceFile(root), { timeout: 20_000 })
    .toContain("Updated from browser folder smoke.");
  await expect
    .poll(async () => readSourceFile(root), { timeout: 20_000 })
    .toContain('title: "Getting Started"');
});
