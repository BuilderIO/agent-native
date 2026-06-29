import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  docSourceFilenamesForSlug,
  preferMdxDocSourceFiles,
} from "../lib/docs-source";

export const docsContentDir = fileURLToPath(
  new URL("../../core/docs/content/", import.meta.url),
);

export function sanitizeDocSlug(slug: string): string {
  return slug.replace(/[^a-z0-9-]/gi, "");
}

export function docPath(slug: string): string {
  const sanitizedSlug = sanitizeDocSlug(slug);
  for (const filename of docSourceFilenamesForSlug(sanitizedSlug)) {
    const candidate = join(docsContentDir, filename);
    if (existsSync(candidate)) return candidate;
  }
  return join(docsContentDir, `${sanitizedSlug}.mdx`);
}

export async function listDocFiles(): Promise<string[]> {
  return preferMdxDocSourceFiles(await readdir(docsContentDir));
}

export async function readDocFile(slug: string): Promise<string> {
  return readFile(docPath(slug), "utf-8");
}
