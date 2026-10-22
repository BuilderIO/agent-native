import {
  extractDocxSections,
  sanitizeInertDocumentHtml,
  type ParsedDocxDocument,
} from "@agent-native/core/ingestion";
import { convertToHtml, extractRawText } from "mammoth";

export type ParsedDocument = ParsedDocxDocument;

export async function parseDocx(data: Uint8Array): Promise<ParsedDocxDocument> {
  const buffer = Buffer.from(data);
  const [htmlResult, textResult] = await Promise.all([
    convertToHtml({ buffer }),
    extractRawText({ buffer }),
  ]);
  const html = sanitizeInertDocumentHtml(htmlResult.value);
  const text = textResult.value;
  const sections = extractDocxSections(html);
  const firstLine = text.split("\n").find((line) => line.trim());

  return {
    title:
      sections.find((section) => section.heading)?.heading ??
      (firstLine && firstLine.length < 200
        ? firstLine.trim()
        : "Imported Document"),
    html,
    text,
    sections,
  };
}
