import {
  isJsonStringComplete,
  parsePartialJson,
  readJsonPath,
  useStreamingToolInput,
  type StreamingToolInputStatus,
} from "@agent-native/core/client/generation-stream";

import { resolveCanvasIntent } from "../../shared/canvas-dimensions";

export interface GeneratingDesignPreview {
  html: string;
  width: number;
  height: number;
  status: StreamingToolInputStatus;
}

function isStreamingScreenFile(
  file: unknown,
): file is { filename: string; content: string } {
  if (typeof file !== "object" || file === null) return false;
  const { filename, content, fileType } = file as Record<string, unknown>;
  if (typeof filename !== "string" || typeof content !== "string") {
    return false;
  }
  // `fileType` follows `content` in the schema, so while content streams the
  // filename is the only signal that this is a screen and not a stylesheet.
  return fileType === undefined
    ? /\.html?$/i.test(filename)
    : fileType === "html";
}

const DEFAULT_FRAME = { width: 1440, height: 900 };

/**
 * How long a finished call's preview stays up so the frames drafted from its
 * last burst of content finish drawing before the saved screen replaces it.
 */
export const GENERATION_DRAFT_SETTLE_MS = 1600;

function frameSize(prompt: unknown): { width: number; height: number } {
  if (typeof prompt !== "string") return DEFAULT_FRAME;
  const intent = resolveCanvasIntent(prompt);
  return intent.kind === "fixed" && intent.dimensions
    ? intent.dimensions
    : DEFAULT_FRAME;
}

/** The screen HTML the agent's current `generate-design` call has streamed. */
export function useGeneratingDesignPreview({
  designId,
  generating,
}: {
  designId: string;
  generating: boolean;
}): GeneratingDesignPreview | null {
  const preview = useStreamingToolInput({
    tools: ["generate-design"],
    enabled: generating && !!designId,
    scope: designId,
    matches: (input) =>
      isJsonStringComplete(input, ["designId"])
        ? readJsonPath(input.value, ["designId"]) === designId
        : undefined,
    select: (input) => {
      const raw = readJsonPath(input.value, ["files"]);
      // The action also accepts `files` as a JSON-encoded string.
      const files = typeof raw === "string" ? parsePartialJson(raw).value : raw;
      const screen = Array.isArray(files)
        ? [...files].reverse().find(isStreamingScreenFile)
        : undefined;
      const size = isJsonStringComplete(input, ["prompt"])
        ? frameSize(readJsonPath(input.value, ["prompt"]))
        : DEFAULT_FRAME;
      // A matched call previews from its first byte: the frame holds its
      // skeleton at the final size until the screen HTML starts.
      return { html: screen?.content ?? "", ...size };
    },
  });
  if (!preview) return null;
  return { ...preview.value, status: preview.status };
}
