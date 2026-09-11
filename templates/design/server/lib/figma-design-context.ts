export {
  summarizeFigmaNode,
  type FigmaContextNode,
  type SummarizeFigmaNodeResult,
} from "@agent-native/core/ingestion";

import { figmaGet, providerJson } from "./figma-node-import.js";

export async function fetchFigmaRenderUrl(
  fileKey: string,
  nodeId: string,
  format: "png" | "svg" = "png",
): Promise<string | null> {
  try {
    const envelope = await figmaGet(`/images/${fileKey}`, {
      ids: nodeId,
      format,
      scale: format === "png" ? 2 : undefined,
      svg_include_id: format === "svg" ? true : undefined,
    });
    const json = providerJson(envelope, "images") as {
      images?: Record<string, string | null | undefined>;
    };
    const url = json.images?.[nodeId];
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
}
