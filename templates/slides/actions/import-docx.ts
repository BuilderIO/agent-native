import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { parseDocx } from "../server/handlers/import/docx-parser.js";
import { convertSectionsToSlides } from "../server/handlers/import/html-converter.js";
import fs from "fs";
import { resolveUserUploadedFile } from "./_uploaded-files.js";

export default defineAction({
  description:
    "Import a DOCX file and extract its content as structured sections. " +
    "Returns the document title, sections with headings and content, " +
    "and pre-converted slide HTML that can be used with create-deck or add-slide. " +
    "The agent can use the extracted content directly or refine it before creating slides.",
  schema: z.object({
    filePath: z
      .string()
      .describe(
        "Server path to the uploaded DOCX file (e.g. data/uploads/document.docx)",
      ),
    convertToSlides: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "If true, also returns pre-converted slide HTML for each section (default: true)",
      ),
  }),
  run: async ({ filePath, convertToSlides }) => {
    const absPath = resolveUserUploadedFile(filePath);

    const fileBuffer = await fs.promises.readFile(absPath);
    const doc = await parseDocx(fileBuffer);

    const result: Record<string, unknown> = {
      title: doc.title,
      sectionCount: doc.sections.length,
      sections: doc.sections.map((s) => ({
        heading: s.heading,
        content: stripTags(s.content).trim(),
      })),
      textLength: doc.text.length,
    };

    if (convertToSlides) {
      const slideHtmlArray = convertSectionsToSlides(doc.sections);
      result.slideCount = slideHtmlArray.length;
      result.slides = slideHtmlArray.map((html, i) => ({
        index: i,
        content: html,
        layout: "content",
      }));
    }

    return result;
  },
});

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
