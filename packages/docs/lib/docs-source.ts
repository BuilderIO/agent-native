export const DOC_SOURCE_EXTENSIONS = [".mdx", ".md"] as const;

export type DocSourceExtension = (typeof DOC_SOURCE_EXTENSIONS)[number];

export function docSourceExtension(
  filename: string,
): DocSourceExtension | undefined {
  if (filename.endsWith(".mdx")) return ".mdx";
  if (filename.endsWith(".md")) return ".md";
  return undefined;
}

export function isDocSourceFile(filename: string): boolean {
  return docSourceExtension(filename) !== undefined;
}

export function docSourcePathWithoutExtension(filename: string): string {
  return filename.replace(/\.(?:mdx|md)$/, "");
}

export function docSourceSlugFromFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  return docSourcePathWithoutExtension(basename);
}

export function docSourceFilenamesForSlug(slug: string): string[] {
  return DOC_SOURCE_EXTENSIONS.map((extension) => `${slug}${extension}`);
}

export function preferMdxDocSourceFiles(files: string[]): string[] {
  const byPath = new Map<string, string>();

  for (const file of [...files].sort()) {
    if (!isDocSourceFile(file)) continue;

    const pathWithoutExtension = docSourcePathWithoutExtension(file);
    const existing = byPath.get(pathWithoutExtension);
    if (!existing || docSourceExtension(file) === ".mdx") {
      byPath.set(pathWithoutExtension, file);
    }
  }

  return Array.from(byPath.values()).sort((a, b) =>
    docSourcePathWithoutExtension(a).localeCompare(
      docSourcePathWithoutExtension(b),
    ),
  );
}
