import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Read a specific framework source file to understand implementation details",
  schema: z.object({
    path: z
      .string()
      .describe(
        "Relative path within the framework source, e.g. 'server/auth.ts' or 'client/AgentPanel.tsx'",
      ),
    startLine: z
      .number()
      .optional()
      .describe("Start reading from this line number"),
    endLine: z.number().optional().describe("Stop reading at this line number"),
  }),
  http: false,
  run: async ({ path, startLine, endLine }) => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    try {
      const indexPath = join(
        import.meta.dirname,
        "../../public/source-index.json",
      );
      const raw = await readFile(indexPath, "utf-8");
      const index: Array<{ path: string; content: string }> = JSON.parse(raw);

      const entry = index.find(
        (e) => e.path === path || e.path.endsWith("/" + path),
      );
      if (!entry) {
        const similar = index
          .filter((e) => e.path.includes(path.split("/").pop() || ""))
          .slice(0, 5)
          .map((e) => e.path);

        return similar.length
          ? `File "${path}" not found. Did you mean:\n${similar.map((s) => `- ${s}`).join("\n")}`
          : `File "${path}" not found in the source index.`;
      }

      let lines = entry.content.split("\n");
      if (startLine || endLine) {
        const start = Math.max(0, (startLine || 1) - 1);
        const end = endLine || lines.length;
        lines = lines.slice(start, end);
      }

      const maxLines = 200;
      if (lines.length > maxLines) {
        return `**${entry.path}** (showing first ${maxLines} of ${lines.length} lines)\n\n\`\`\`typescript\n${lines.slice(0, maxLines).join("\n")}\n\`\`\`\n\nUse startLine/endLine to read specific sections.`;
      }

      return `**${entry.path}**\n\n\`\`\`typescript\n${lines.join("\n")}\n\`\`\``;
    } catch {
      return "Source index not available. The source-index.json may not have been generated yet.";
    }
  },
});
