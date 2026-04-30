import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { readDocFile, sanitizeDocSlug } from "./docs-files";

export default defineAction({
  description:
    "Read the full content of a documentation page by its slug (e.g. 'getting-started', 'actions', 'authentication')",
  schema: z.object({
    slug: z.string().describe("Doc page slug, e.g. 'getting-started'"),
  }),
  http: false,
  run: async ({ slug }) => {
    const matter = (await import("gray-matter")).default;
    const sanitized = sanitizeDocSlug(slug);

    try {
      const raw = await readDocFile(sanitized);
      const { data, content } = matter(raw);
      return `# ${data.title || sanitized}\n\n${content}`;
    } catch {
      return `Documentation page "${slug}" not found. Use list-docs to see available pages.`;
    }
  },
});
