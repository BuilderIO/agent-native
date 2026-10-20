import { listDocSourceFiles, readDocSource } from "../lib/docs-content-source";

export function sanitizeDocSlug(slug: string): string {
  return slug.replace(/[^a-z0-9-]/gi, "");
}

export async function listDocFiles(): Promise<string[]> {
  return listDocSourceFiles();
}

export async function readDocFile(slug: string): Promise<string> {
  const raw = await readDocSource(sanitizeDocSlug(slug));
  if (raw === undefined) {
    throw new Error(`Documentation page "${slug}" not found`);
  }
  return raw;
}
