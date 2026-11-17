import { findCompleteDesignToolMarker } from "@shared/design-tool-markers";
import type { FigmaPasteLayer } from "@shared/figma-paste-plan";

import { detectFigma, readFigma } from "./figma";
import type { PasteWarnings } from "./ir";
import { detectPaper, readPaper } from "./paper";
import { detectWonder, readWonder } from "./wonder";

export type DesignTool = "paper" | "wonder" | "figma";

/**
 * `absent` means the clipboard is not from a supported design tool. `invalid`
 * means it is, but could not be read; callers must say so rather than treat it
 * as absent.
 */
export type DesignToolRead =
  | { status: "absent" }
  | { status: "invalid"; tool: DesignTool; reason: string }
  | {
      status: "ok";
      tool: DesignTool;
      layers: FigmaPasteLayer[];
      warnings: PasteWarnings;
      /** Images the copy references but could not carry; the editor offers to fill them. */
      unresolvedImages?: number;
      /** Remote images the layers link to, for the editor to host in our storage. */
      remoteImages?: string[];
    };

export type DesignToolPaste = Extract<DesignToolRead, { status: "ok" }>;

interface Adapter {
  tool: DesignTool;
  /** Cheap marker check; `read` only ever runs on a copy that matched. */
  detect(html: string): boolean;
  read(html: string): DesignToolRead | Promise<DesignToolRead>;
}

const ADAPTERS: Adapter[] = [
  { tool: "figma", detect: detectFigma, read: readFigma },
  { tool: "paper", detect: detectPaper, read: readPaper },
  { tool: "wonder", detect: detectWonder, read: readWonder },
];

/** A copy that matched a tool, captured while the paste event is still live. */
export interface DesignToolSource {
  tool: DesignTool;
  html: string;
}

export function findDesignToolPasteHtml(
  html: string | undefined,
  flavor: "html" | "text" = "html",
): DesignToolSource | null {
  if (!html) return null;
  if (flavor === "text") {
    const tool = findCompleteDesignToolMarker(html);
    return tool ? { tool, html } : null;
  }
  const adapter = ADAPTERS.find((candidate) => candidate.detect(html));
  return adapter ? { tool: adapter.tool, html } : null;
}

/**
 * Detection is synchronous so the paste handler can claim the event before it
 * ends; reading is async because a scene may need a worker to decode.
 */
export function findDesignToolPaste(
  clipboardData: Pick<DataTransfer, "getData"> | null | undefined,
): DesignToolSource | null {
  // A scene can also land in the plain-text flavor, which is held to the whole
  // envelope so ordinary text that mentions a marker is left alone.
  return (
    findDesignToolPasteHtml(clipboardData?.getData("text/html"), "html") ??
    findDesignToolPasteHtml(clipboardData?.getData("text/plain"), "text")
  );
}

export async function readDesignToolSource(
  source: DesignToolSource,
): Promise<DesignToolRead> {
  const adapter = ADAPTERS.find((candidate) => candidate.tool === source.tool);
  if (!adapter) return { status: "absent" };
  try {
    return await adapter.read(source.html);
  } catch (error) {
    return {
      status: "invalid",
      tool: source.tool,
      reason: error instanceof Error ? error.message : "could not be read",
    };
  }
}

export async function readDesignToolPasteHtml(
  html: string | undefined,
): Promise<DesignToolRead> {
  const source = findDesignToolPasteHtml(html);
  return source ? readDesignToolSource(source) : { status: "absent" };
}
