import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Read the full content of a documentation page by its slug (e.g. 'getting-started', 'actions', 'authentication')",
  schema: z.object({
    slug: z.string().describe("Doc page slug, e.g. 'getting-started'"),
  }),
  http: false,
  run: async ({ slug }) => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const matter = (await import("gray-matter")).default;

    const sanitized = slug.replace(/[^a-z0-9-]/gi, "");
    const filePath = join(
      import.meta.dirname,
      "../../public/docs",
      `${sanitized}.md`,
    );

    try {
      const raw = await readFile(filePath, "utf-8");
      const { data, content } = matter(raw);
      return `# ${data.title || sanitized}\n\n${content}`;
    } catch {
      return `Documentation page "${slug}" not found. Use list-docs to see available pages.`;
    }
  },
});
