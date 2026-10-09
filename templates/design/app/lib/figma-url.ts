import { parseFigmaUrl } from "@shared/figma-url";

const FIGMA_URL_RE = /https?:\/\/[^\s<>"']+/gi;

export interface FigmaLink {
  url: string;
  fileKey: string;
  nodeId: string | null;
  kind: "file" | "frame";
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, "");
}

export function extractFigmaLink(text: string): FigmaLink | null {
  const candidates = text.match(FIGMA_URL_RE) ?? [];
  for (const candidate of candidates) {
    const raw = trimTrailingPunctuation(candidate);
    if (raw.length > 2_048) continue;

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }

    const parsedFigma = parseFigmaUrl(parsed.toString());
    if (!parsedFigma.fileKey) continue;

    const nodeId = parsedFigma.nodeId;
    return {
      url: raw,
      fileKey: parsedFigma.fileKey,
      nodeId,
      kind: nodeId ? "frame" : "file",
    };
  }
  return null;
}

export type FigmaLinkChatAction = "import" | "inspect" | "export-svg";

export interface FigmaLinkChatPrompts {
  importFrame: string;
  importFile: string;
  inspectFrame: string;
  inspectFile: string;
  exportSvg: string;
}

export function buildFigmaLinkChatPrompt(
  action: FigmaLinkChatAction,
  link: FigmaLink,
  prompts: FigmaLinkChatPrompts,
): { message: string } {
  if (action === "import") {
    return {
      message: link.kind === "frame" ? prompts.importFrame : prompts.importFile,
    };
  }

  if (action === "inspect") {
    return {
      message:
        link.kind === "frame" ? prompts.inspectFrame : prompts.inspectFile,
    };
  }

  return { message: prompts.exportSvg };
}
