import { defineAction } from "@agent-native/core";
import { z } from "zod";

let cachedIndex: Array<{ slug: string; title: string }> | null = null;

async function loadDocsIndex() {
  if (cachedIndex) return cachedIndex;
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const docsDir = join(import.meta.dirname, "../../public/docs");
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(docsDir).filter((f: string) => f.endsWith(".md"));

  const matter = (await import("gray-matter")).default;
  const entries = [];
  for (const file of files) {
    const raw = await readFile(join(docsDir, file), "utf-8");
    const { data } = matter(raw);
    entries.push({
      slug: file.replace(/\.md$/, ""),
      title: data.title || file.replace(/\.md$/, ""),
    });
  }
  cachedIndex = entries;
  return entries;
}

export default defineAction({
  description: "List all documentation pages with their titles",
  schema: z.object({}),
  http: false,
  run: async () => {
    const docs = await loadDocsIndex();
    return docs.map((d) => `- [${d.title}](/docs/${d.slug})`).join("\n");
  },
});
