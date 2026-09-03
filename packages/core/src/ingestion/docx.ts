export interface ParsedDocxSection {
  heading: string;
  content: string;
  html: string;
  text: string;
}

export interface ParsedDocxDocument {
  title: string;
  html: string;
  text: string;
  sections: ParsedDocxSection[];
}

export async function parseDocxDocument(
  data: Uint8Array,
): Promise<ParsedDocxDocument> {
  const mammoth = await loadMammoth();
  const buffer = Buffer.from(data);
  const [htmlResult, textResult] = await Promise.all([
    mammoth.convertToHtml({ buffer }),
    mammoth.extractRawText({ buffer }),
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

export function extractDocxSections(html: string): ParsedDocxSection[] {
  html = sanitizeInertDocumentHtml(html);
  const sections: ParsedDocxSection[] = [];
  for (const part of html.split(/(?=<h[1-3][^>]*>)/i)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^<h[1-3][^>]*>(.*?)<\/h[1-3]>/is);
    if (heading) {
      const sectionHtml = trimmed.slice(heading[0].length).trim();
      sections.push({
        heading: stripHtml(heading[1]).trim(),
        content: sectionHtml,
        html: sectionHtml,
        text: stripHtml(sectionHtml),
      });
    } else if (sections.length === 0) {
      sections.push({
        heading: "",
        content: trimmed,
        html: trimmed,
        text: stripHtml(trimmed),
      });
    } else {
      const previous = sections.at(-1)!;
      previous.html += `\n${trimmed}`;
      previous.content = previous.html;
      previous.text = stripHtml(previous.html);
    }
  }
  return sections.length > 0
    ? sections
    : html.trim()
      ? [{ heading: "", content: html, html, text: stripHtml(html) }]
      : [];
}

const SAFE_DOCUMENT_TAGS = new Set([
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "hr",
  "sup",
  "sub",
]);

export function sanitizeInertDocumentHtml(value: string): string {
  return value
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<!\s*(?:doctype|entity)[^>]*>/gi, "")
    .replace(/<\?[^>]*>/g, "")
    .replace(
      /<\s*(script|style|iframe|object|embed|svg|math|template|noscript|form)\b[^>]*>[^]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(
      /<\s*\/?\s*([a-z][a-z0-9:-]*)\b[^>]*>/gi,
      (tag, rawName: string) => {
        const name = rawName.toLowerCase();
        if (!SAFE_DOCUMENT_TAGS.has(name)) return "";
        const closing = /^<\s*\//.test(tag);
        if (closing && (name === "br" || name === "hr")) return "";
        return closing ? `</${name}>` : `<${name}>`;
      },
    )
    .trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

async function loadMammoth(): Promise<{
  convertToHtml(input: { buffer: Buffer }): Promise<{ value: string }>;
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
}> {
  const moduleName = "mammoth";
  try {
    return (await import(moduleName)) as {
      convertToHtml(input: { buffer: Buffer }): Promise<{ value: string }>;
      extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
    };
  } catch {
    throw new Error(
      "Structured DOCX parsing requires the optional mammoth dependency.",
    );
  }
}
