import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listDocFiles, readDocFile } from "./docs-files";

interface DocSection {
  slug: string;
  title: string;
  heading: string;
  text: string;
}

let cachedSections: DocSection[] | null = null;

async function loadDocSections(): Promise<DocSection[]> {
  if (cachedSections) return cachedSections;
  const matter = (await import("gray-matter")).default;

  const files = await listDocFiles();

  const sections: DocSection[] = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const raw = await readDocFile(slug);
    const { data, content } = matter(raw);
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
      .map((m) => {
        const path = m.slug === "getting-started" ? "/docs" : `/docs/${m.slug}`;
        return `### ${m.title} > ${m.heading}\n**Path:** ${path}\n\n${m.text.slice(0, 300)}...`;
      })
      .join("\n\n---\n\n");
  },
});
