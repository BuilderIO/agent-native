export type OfficeDocumentType = "pptx" | "docx" | "pdf" | "txt" | "md" | "csv";

export interface ParseOfficeDocumentInput {
  data: Uint8Array;
  fileName: string;
  mimeType?: string;
  signal?: AbortSignal;
}

export interface ParsedOfficeDocument {
  text: string;
  fileType: OfficeDocumentType;
  title: string;
  parser:
    | "structured-pptx"
    | "mammoth-docx"
    | "officeparser-pdf"
    | "plain-text";
  parts: OfficeDocumentPart[];
  metadata: Record<string, unknown>;
  warnings: string[];
}

export interface OfficeDocumentPart {
  kind: "slide" | "section" | "page" | "document";
  index: number;
  title: string;
  text: string;
  notes?: string;
  textRuns?: ParsedPptxTextRun[];
  images?: ParsedPptxImage[];
  metadata?: Record<string, unknown>;
}

export interface OfficeDocumentAst {
  type?: string;
  metadata?: Record<string, unknown>;
  warnings?: unknown[];
  toText(): string | Promise<string>;
}

export interface OfficeDocumentParser {
  parseOffice(
    data: Uint8Array,
    options: {
      fileType: OfficeDocumentType;
      abortSignal?: AbortSignal;
      extractAttachments: boolean;
      ignoreNotes: boolean;
    },
  ): Promise<OfficeDocumentAst>;
}

export async function parseOfficeDocument(
  input: ParseOfficeDocumentInput,
  parser?: OfficeDocumentParser,
): Promise<ParsedOfficeDocument> {
  const fileType = detectOfficeDocumentType(input.fileName, input.mimeType);
  if (fileType === "txt" || fileType === "md" || fileType === "csv") {
    const text = normalizeDocumentText(new TextDecoder().decode(input.data));
    return {
      text,
      fileType,
      title: input.fileName,
      parser: "plain-text",
      parts: [{ kind: "document", index: 0, title: input.fileName, text }],
      metadata: {},
      warnings: [],
    };
  }
  if (fileType === "pptx") {
    const presentation = await parsePptxPresentation(input.data);
    const parts = presentation.slides.map((slide, index) => {
      const body = normalizeDocumentText(
        slide.texts.map((run) => run.content).join("\n"),
      );
      return {
        kind: "slide" as const,
        index,
        title:
          slide.texts
            .find((run) => run.content.trim())
            ?.content.trim()
            .slice(0, 160) ?? `Slide ${index + 1}`,
        text: normalizeDocumentText(
          [body, slide.notes ? `Speaker notes\n${slide.notes}` : ""]
            .filter(Boolean)
            .join("\n\n"),
        ),
        notes: slide.notes,
        textRuns: slide.texts,
        images: slide.images,
        metadata: {
          layoutHint: slide.layoutHint,
          theme: presentation.theme,
        },
      };
    });
    return {
      text: parts.map((part) => part.text).join("\n\n"),
      fileType,
      title: presentation.title,
      parser: "structured-pptx",
      parts,
      metadata: { theme: presentation.theme, slideCount: parts.length },
      warnings: [],
    };
  }
  if (fileType === "docx") {
    const document = await parseDocxDocument(input.data);
    const parts = document.sections.map((section, index) => {
      const html = sanitizeInertDocumentHtml(section.html);
      return {
        kind: "section" as const,
        index,
        title: section.heading || `Section ${index + 1}`,
        text: normalizeDocumentText(
          [section.heading, section.text].filter(Boolean).join("\n\n"),
        ),
        metadata: { html },
      };
    });
    return {
      text: normalizeDocumentText(document.text),
      fileType,
      title: document.title,
      parser: "mammoth-docx",
      parts,
      metadata: { sectionCount: parts.length },
      warnings: [],
    };
  }
  const resolvedParser = parser ?? (await loadOfficeParser());
  if (!resolvedParser) {
    throw new Error(
      `Parsing ${fileType.toUpperCase()} uploads requires the optional officeparser dependency.`,
    );
  }
  const ast = await resolvedParser.parseOffice(input.data, {
    fileType,
    abortSignal: input.signal,
    extractAttachments: false,
    ignoreNotes: false,
  });
  const text = normalizeDocumentText(await ast.toText());
  const pages = text.split(/\f+/).map(normalizeDocumentText).filter(Boolean);
  const parts = (pages.length > 0 ? pages : [text]).map((page, index) => ({
    kind: "page" as const,
    index,
    title: `Page ${index + 1}`,
    text: page,
  }));
  return {
    text,
    fileType: isOfficeDocumentType(ast.type) ? ast.type : fileType,
    title: input.fileName,
    parser: "officeparser-pdf",
    parts,
    metadata: ast.metadata ?? {},
    warnings: (ast.warnings ?? []).map(String),
  };
}

export function detectOfficeDocumentType(
  fileName: string,
  mimeType?: string,
): OfficeDocumentType {
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime.includes("presentationml")) return "pptx";
  if (mime.includes("wordprocessingml")) return "docx";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("markdown")) return "md";
  if (mime.includes("csv")) return "csv";
  if (mime.startsWith("text/")) return "txt";
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (isOfficeDocumentType(extension)) return extension;
  throw new Error(
    `Unsupported upload type ${mimeType ?? extension ?? "unknown"}; supported formats are PPTX, DOCX, PDF, and text.`,
  );
}

export function normalizeDocumentText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadOfficeParser(): Promise<OfficeDocumentParser | null> {
  try {
    const module = (await import("officeparser")) as unknown as {
      OfficeParser?: OfficeDocumentParser;
    };
    return module.OfficeParser ?? null;
  } catch {
    return null;
  }
}

function isOfficeDocumentType(value: unknown): value is OfficeDocumentType {
  return (
    typeof value === "string" &&
    (["pptx", "docx", "pdf", "txt", "md", "csv"] as string[]).includes(value)
  );
}
import { parseDocxDocument, sanitizeInertDocumentHtml } from "./docx.js";
import {
  parsePptxPresentation,
  type ParsedPptxImage,
  type ParsedPptxTextRun,
} from "./pptx.js";
