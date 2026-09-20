import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { readPublicJsonAsset } from "../actions/public-assets";
import {
  docSourceSlugFromFilename,
  isDocSourceFile,
  preferMdxDocSourceFiles,
} from "./docs-source";

const LOCAL_DOCS_ROOT = join(import.meta.dirname, "../../core/docs/content");
const GENERATED_DOCS_ASSET = "docs-source-index.json";

interface DocSourceAsset {
  filename: string;
  content: string;
}

interface DocSource {
  filename: string;
  slug: string;
  content: string;
}

function buildDocSources(entries: DocSourceAsset[]): DocSource[] {
  const entriesByFilename = new Map(
    entries
      .filter(
        (entry) =>
          typeof entry?.filename === "string" &&
          typeof entry?.content === "string" &&
          isDocSourceFile(entry.filename),
      )
      .map((entry) => [entry.filename, entry]),
  );

  return preferMdxDocSourceFiles(Array.from(entriesByFilename.keys())).flatMap(
    (filename) => {
      const entry = entriesByFilename.get(filename);
      if (!entry) return [];

      return [
        {
          filename,
          slug: docSourceSlugFromFilename(filename),
          content: entry.content,
        },
      ];
    },
  );
}

async function loadLocalDocSources(): Promise<DocSource[]> {
  const entries = await readdir(LOCAL_DOCS_ROOT, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && isDocSourceFile(entry.name))
    .map((entry) => entry.name);
  const sources = await Promise.all(
    files.map(async (filename) => ({
      filename,
      content: await readFile(join(LOCAL_DOCS_ROOT, filename), "utf-8"),
    })),
  );
  return buildDocSources(sources);
}

let docSourcesPromise: Promise<DocSource[]> | undefined;

async function loadDocSources(): Promise<DocSource[]> {
  // A source checkout may retain the ignored generated asset after a build.
  // Keep local actions aligned with edits to core docs until the next build.
  if (process.env.NODE_ENV !== "production") return loadLocalDocSources();

  const generated =
    await readPublicJsonAsset<DocSourceAsset[]>(GENERATED_DOCS_ASSET);
  if (Array.isArray(generated)) return buildDocSources(generated);
  return loadLocalDocSources();
}

function cachedDocSources(): Promise<DocSource[]> {
  docSourcesPromise ??= loadDocSources().catch((error) => {
    docSourcesPromise = undefined;
    throw error;
  });
  return docSourcesPromise;
}

export async function listDocSourceFiles(): Promise<string[]> {
  return (await cachedDocSources()).map((source) => source.filename);
}

export async function readDocSource(slug: string): Promise<string | undefined> {
  const source = (await cachedDocSources()).find(
    (candidate) => candidate.slug === slug,
  );
  return source?.content;
}
