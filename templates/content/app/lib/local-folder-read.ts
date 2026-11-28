import { CONTENT_SOURCE_ROOT } from "@shared/content-source";

export const LOCAL_FOLDER_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "dist",
  "node_modules",
]);

const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

type FolderFile = { kind: "file"; name: string; getFile(): Promise<File> };
type FolderDirectory = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<FolderFile | FolderDirectory>;
  getDirectoryHandle(name: string): Promise<FolderDirectory>;
};

export type LocalFolderMarkdown = {
  files: Record<string, string>;
  skippedPaths: string[];
};

export function isLocalMarkdownPath(path: string) {
  return /\.(md|mdx)$/i.test(path);
}

async function sourceReadRoot(handle: FolderDirectory) {
  if (handle.name === CONTENT_SOURCE_ROOT) {
    return { handle, prefix: `${CONTENT_SOURCE_ROOT}/` };
  }
  try {
    return {
      handle: await handle.getDirectoryHandle(CONTENT_SOURCE_ROOT),
      prefix: `${CONTENT_SOURCE_ROOT}/`,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotFoundError" || error.name === "TypeMismatchError")
    ) {
      return { handle, prefix: "" };
    }
    throw error;
  }
}

async function collectMarkdownFiles(
  handle: FolderDirectory,
  prefix: string,
  read: LocalFolderMarkdown,
) {
  for await (const entry of handle.values()) {
    const path = `${prefix}${entry.name}`;
    if (entry.kind === "directory") {
      if (LOCAL_FOLDER_IGNORED_DIRECTORIES.has(entry.name)) continue;
      await collectMarkdownFiles(entry, `${path}/`, read);
      continue;
    }
    if (!isLocalMarkdownPath(path)) continue;
    const file = await entry.getFile();
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      read.skippedPaths.push(path);
      continue;
    }
    read.files[path] = await file.text();
  }
}

export async function readLocalFolderMarkdown(
  handle: FolderDirectory,
): Promise<LocalFolderMarkdown> {
  const root = await sourceReadRoot(handle);
  const read: LocalFolderMarkdown = { files: {}, skippedPaths: [] };
  await collectMarkdownFiles(root.handle, root.prefix, read);
  return read;
}
