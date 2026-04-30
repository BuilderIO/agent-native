import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listDocFiles, readDocFile } from "./docs-files";

let cachedIndex: Array<{ slug: string; title: string }> | null = null;

async function loadDocsIndex() {
  if (cachedIndex) return cachedIndex;
  const files = await listDocFiles();

  const matter = (await import("gray-matter")).default;
  const entries = [];
  for (const file of files) {
    const raw = await readDocFile(file.replace(/\.md$/, ""));
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
    return docs
      .map((d) => {
        const path = d.slug === "getting-started" ? "/docs" : `/docs/${d.slug}`;
        return `- [${d.title}](${path})`;
      })
      .join("\n");
  },
});
