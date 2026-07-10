const FIGMA_URL_RE = /https?:\/\/[^\s<>"']+/gi;
const SUPPORTED_FIGMA_PATHS = new Set(["design", "file", "proto", "board"]);

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
 * Only known Figma editor paths are accepted; lookalike hosts and community
 * links are intentionally ignored.
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

    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "figma.com" && !hostname.endsWith(".figma.com")) {
      continue;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (!SUPPORTED_FIGMA_PATHS.has(segments[0] ?? "")) continue;
    const fileKey = segments[1]?.trim();
    if (!fileKey || !/^[A-Za-z0-9_-]+$/.test(fileKey)) continue;

    const rawNodeId = parsed.searchParams.get("node-id")?.trim() ?? "";
    const nodeId = rawNodeId || null;
    return {
      url: raw,
      fileKey,
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
): { message: string; context?: string } {
  const context = designId ? `Current Design id: ${designId}` : undefined;

  if (action === "import") {
    return {
      message:
        link.kind === "frame"
          ? `Import this Figma frame into the current Design and report any fidelity differences: ${link.url}`
          : `Open this Figma file, list its top-level frames, and ask me which frame to import: ${link.url}`,
      context,
    };
  }

  if (action === "inspect") {
    return {
      message: `Inspect this Figma ${link.kind} and summarize its structure, components, styles, and reusable tokens: ${link.url}`,
      context,
    };
  }

  return {
    message:
      "Export the current Design screen as Figma-compatible SVG and explain which text, auto-layout, component, variable, and prototype behavior will not stay live in Figma.",
    context,
  };
}
