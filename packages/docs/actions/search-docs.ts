import { defineAction } from "@agent-native/core";
import { z } from "zod";

interface DocSection {
  slug: string;
  title: string;
  heading: string;
  text: string;
}

let cachedSections: DocSection[] | null = null;

async function loadDocSections(): Promise<DocSection[]> {
  if (cachedSections) return cachedSections;
  const { readFile, readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const matter = (await import("gray-matter")).default;

  const docsDir = join(import.meta.dirname, "../../public/docs");
  const files = (await readdir(docsDir)).filter((f) => f.endsWith(".md"));

  const sections: DocSection[] = [];
  for (const file of files) {
    const raw = await readFile(join(docsDir, file), "utf-8");
    const { data, content } = matter(raw);
    const slug = file.replace(/\.md$/, "");
    const title = data.title || slug;

    const parts = content.split(/^(#{1,3}\s+.+)$/m);
    let currentHeading = title;
    let currentText = "";

    for (const part of parts) {
      const headingMatch = part.match(/^#{1,3}\s+(.+)$/);
      if (headingMatch) {
        if (currentText.trim()) {
          sections.push({
            slug,
            title,
            heading: currentHeading,
            text: currentText.trim().slice(0, 500),
          });
        }
        currentHeading = headingMatch[1];
        currentText = "";
      } else {
        currentText += part;
      }
    }
    if (currentText.trim()) {
      sections.push({
        slug,
        title,
        heading: currentHeading,
        text: currentText.trim().slice(0, 500),
      });
    }
  }

  cachedSections = sections;
  return sections;
}

export default defineAction({
  description:
    "Search documentation pages by keyword. Returns matching sections with page paths and snippets.",
  schema: z.object({
    query: z
      .string()
      .describe("Search term or phrase to find in documentation"),
  }),
  http: false,
  run: async ({ query }) => {
    const sections = await loadDocSections();
    const lower = query.toLowerCase();
    const matches = sections.filter(
      (s) =>
        s.heading.toLowerCase().includes(lower) ||
        s.text.toLowerCase().includes(lower),
    );

    if (matches.length === 0) {
      return `No documentation sections matched "${query}". Try a different search term.`;
    }

    return matches
      .slice(0, 10)
      .map(
        (m) =>
          `### ${m.title} > ${m.heading}\n**Path:** /docs/${m.slug}\n\n${m.text.slice(0, 300)}...`,
      )
      .join("\n\n---\n\n");
  },
});
