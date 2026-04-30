import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const docsContentDir = fileURLToPath(
  new URL("../../core/docs/content/", import.meta.url),
);

export function sanitizeDocSlug(slug: string): string {
  return slug.replace(/[^a-z0-9-]/gi, "");
}

export function docPath(slug: string): string {
  return join(docsContentDir, `${sanitizeDocSlug(slug)}.md`);
}

export async function listDocFiles(): Promise<string[]> {
  return (await readdir(docsContentDir))
    .filter((file) => file.endsWith(".md"))
    .sort();
}

export async function readDocFile(slug: string): Promise<string> {
  return readFile(docPath(slug), "utf-8");
}
