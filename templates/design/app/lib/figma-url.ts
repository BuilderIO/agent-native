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

/**
 * Extract the first Figma file/frame URL from arbitrary composer text.
 * The shared parser validates the hostname, effective branch file key, and
 * optional node id so lookalike hosts cannot trigger the integration UI.
 */
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

export function buildFigmaLinkChatPrompt(
  action: FigmaLinkChatAction,
  link: FigmaLink,
  designId?: string | null,
): { message: string } {
  if (action === "import") {
    const destination = designId
      ? "the current Design"
      : "a Design (ask me which Design to use if needed)";
    return {
      message:
        link.kind === "frame"
          ? `Import this Figma frame into ${destination} and report any fidelity differences: ${link.url}`
          : `Open this Figma file, list its top-level frames, and ask me which frame to import: ${link.url}`,
    };
  }

  if (action === "inspect") {
    return {
      message: `Inspect this Figma ${link.kind} and summarize its structure, components, styles, and reusable tokens: ${link.url}`,
    };
  }

  return {
    message:
      "Export the current Design screen as Figma-compatible SVG and explain which text, auto-layout, component, variable, and prototype behavior will not stay live in Figma.",
  };
}
