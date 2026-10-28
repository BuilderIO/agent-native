import {
  isJsonStringComplete,
  parsePartialJson,
  readJsonPath,
  type PartialJson,
  useStreamingToolInput,
  type StreamingToolInputStatus,
} from "@agent-native/core/client/generation-stream";

import {
  DEFAULT_GENERATION_VIEWPORT,
  devicesForPrimaryViewport,
  GENERATION_VIEWPORT_SIZES,
  type GenerationViewport,
  resolveCanvasIntent,
  widestGenerationDevice,
} from "../../shared/canvas-dimensions";

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

/**
 * How long a finished call's preview stays up so the frames drafted from its
 * last burst of content finish drawing before the saved screen replaces it.
 */
export const GENERATION_DRAFT_SETTLE_MS = 1600;

const GENERATION_VIEWPORTS: readonly string[] = ["mobile", "tablet", "desktop"];

function isGenerationViewport(value: unknown): value is GenerationViewport {
  return typeof value === "string" && GENERATION_VIEWPORTS.includes(value);
}

/**
 * The frame `generate-design` saves the screen at, read from the same
 * arguments in the same order: a fixed size in the prompt, then the screen's
 * own canvas frame, then the widest requested device.
 */
export function previewFrameSize(
  input: PartialJson,
  screenFilename: string | undefined,
): { width: number; height: number } {
  if (isJsonStringComplete(input, ["prompt"])) {
    const prompt = readJsonPath(input.value, ["prompt"]);
    const intent =
      typeof prompt === "string" ? resolveCanvasIntent(prompt) : undefined;
    if (intent?.kind === "fixed" && intent.dimensions) return intent.dimensions;
  }
  const frames = readJsonPath(input.value, ["canvasFrames"]);
  const placed = Array.isArray(frames)
    ? frames.find(
        (frame) =>
          screenFilename !== undefined &&
          readJsonPath(frame, ["filename"]) === screenFilename,
      )
    : undefined;
  const width = readJsonPath(placed, ["width"]);
  const height = readJsonPath(placed, ["height"]);
  if (
    typeof width === "number" &&
    typeof height === "number" &&
    width > 0 &&
    height > 0
  ) {
    return { width, height };
  }
  const devices = readJsonPath(input.value, ["devices"]);
  const primaryViewport = readJsonPath(input.value, ["primaryViewport"]);
  const resolvedDevices = Array.isArray(devices)
    ? devices.filter(isGenerationViewport)
    : devicesForPrimaryViewport(
        isGenerationViewport(primaryViewport)
          ? primaryViewport
          : DEFAULT_GENERATION_VIEWPORT,
      );
  return GENERATION_VIEWPORT_SIZES[widestGenerationDevice(resolvedDevices)];
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
      const size = previewFrameSize(input, screen?.filename);
      // A matched call previews from its first byte: the frame holds its
      // skeleton at the final size until the screen HTML starts.
      return { html: screen?.content ?? "", ...size };
    },
  });
  if (!preview) return null;
  return { ...preview.value, status: preview.status };
}
