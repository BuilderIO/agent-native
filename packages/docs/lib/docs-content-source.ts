import {
  docSourceSlugFromFilename,
  preferMdxDocSourceFiles,
} from "./docs-source";

type DocSourceLoader = () => Promise<string>;

const docSourceLoaders = {
  ...import.meta.glob("../../core/docs/content/*.md", {
    query: "?raw",
    import: "default",
  }),
  ...import.meta.glob("../../core/docs/content/*.mdx", {
    query: "?raw",
    import: "default",
  }),
} as Record<string, DocSourceLoader>;

interface DocSource {
  filename: string;
  slug: string;
  load: DocSourceLoader;
}

const docSources: DocSource[] = preferMdxDocSourceFiles(
  Object.keys(docSourceLoaders),
).flatMap((path) => {
  const load = docSourceLoaders[path];
  if (!load) return [];

  return [
    {
      filename: path.split("/").pop() ?? path,
      slug: docSourceSlugFromFilename(path),
      load,
    },
  ];
});

const docSourcesBySlug = new Map(
  docSources.map((source) => [source.slug, source]),
);

export function listDocSourceFiles(): string[] {
  return docSources.map((source) => source.filename);
}

export async function readDocSource(slug: string): Promise<string | undefined> {
  const source = docSourcesBySlug.get(slug);
  return source ? source.load() : undefined;
}
