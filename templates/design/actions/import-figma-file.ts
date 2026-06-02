import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { decodeFig, buildImageMap } from "../server/lib/fig/decode.js";
import { renderHtmlTemplates } from "../server/lib/fig/fig-to-html.js";
import { extractDesignSystemFromFig } from "../server/lib/fig/extract-design-system.js";

/** Per-frame HTML is capped so the tool result stays a manageable size. The
 * agent can re-run with a smaller selection or fetch the full design via the
 * editor if it needs the complete markup. */
const MAX_FRAMES = 24;
const MAX_HTML_BYTES = 120 * 1024; // ~120 KB per frame
const MAX_FIG_BYTES = 80 * 1024 * 1024; // 80 MB upload guard

/** Accepts either a bare base64 string or a `data:...;base64,<payload>` URL
 * and returns the decoded bytes. */
function decodeBase64Input(input: string): Buffer {
  const trimmed = input.trim();
  const comma = trimmed.indexOf(",");
  const payload =
    trimmed.startsWith("data:") && comma >= 0
      ? trimmed.slice(comma + 1)
      : trimmed;
  return Buffer.from(payload, "base64");
}

export default defineAction({
  description:
    "Deeply parse an uploaded Figma `.fig` binary (modern fig-kiwi or legacy " +
    "zip format) entirely in-process — no Figma account or MCP needed. " +
    "Decodes the document node tree, renders each top-level frame to " +
    "standalone HTML, and extracts a design-system token set (colors, " +
    "typography, spacing, border radius, shadows). " +
    "Provide the file as a base64 string or data URL in `fileBase64` (or " +
    "`fileDataUrl`). This is read-only and writes nothing. " +
    "WORKFLOW: (1) call this action with the .fig contents; (2) review the " +
    "returned `designSystem` tokens and call `create-design-system` with them " +
    "(optionally set as default); (3) review the returned `frames` and call " +
    "`create-design` + `generate-design` with the frame HTML to import screens. " +
    "Convert nothing yourself — the colors are already hex, effects already " +
    "CSS, and spacing already snapped to a 4/8px scale.",
  schema: z
    .object({
      fileBase64: z
        .string()
        .optional()
        .describe(
          "The .fig file contents as a base64 string (or a data: URL). " +
            "Either fileBase64 or fileDataUrl is required.",
        ),
      fileDataUrl: z
        .string()
        .optional()
        .describe(
          "The .fig file as a data URL (data:application/octet-stream;base64,...). " +
            "Alias for fileBase64.",
        ),
      title: z
        .string()
        .optional()
        .describe("Optional title for the design being imported."),
    })
    .refine((v) => !!(v.fileBase64 || v.fileDataUrl), {
      message: "Provide the .fig file in fileBase64 or fileDataUrl",
    }),
  readOnly: true,
  run: async ({ fileBase64, fileDataUrl, title }) => {
    const raw = (fileBase64 ?? fileDataUrl) as string;
    let buffer: Buffer;
    try {
      buffer = decodeBase64Input(raw);
    } catch {
      throw new Error("Could not decode the provided base64 .fig payload.");
    }
    if (buffer.length === 0) {
      throw new Error("The provided .fig payload was empty.");
    }
    if (buffer.length > MAX_FIG_BYTES) {
      throw new Error(
        `The .fig file is too large to parse in-process (${buffer.length} bytes > ${MAX_FIG_BYTES}).`,
      );
    }

    let decoded;
    try {
      decoded = decodeFig(buffer);
    } catch (err) {
      throw new Error(
        `Failed to decode .fig file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!decoded.document) {
      throw new Error(
        "The .fig file decoded, but its document payload was empty or " +
          "malformed (no node tree). It may be an unsupported format version.",
      );
    }

    // Render frames. Image URLs line up with the hash-based filenames the
    // decoder emits, so a downstream importer can attach the images under an
    // `images/` directory if desired.
    const imageMap = buildImageMap(decoded.images);
    const rendered = renderHtmlTemplates(decoded.document, {
      imageMap,
      imageRefBase: "images",
    });

    const allFrames = rendered.frames;
    const truncatedFrames = allFrames.slice(0, MAX_FRAMES).map((frame) => {
      const safeName = frame.relativePath.replace(/\//g, ".");
      let html = frame.html;
      let truncated = false;
      if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
        html = html.slice(0, MAX_HTML_BYTES);
        truncated = true;
      }
      return {
        filename: safeName,
        pageName: frame.pageName,
        frameName: frame.frameName,
        html,
        ...(truncated ? { truncated: true } : {}),
      };
    });

    const designSystem = extractDesignSystemFromFig(decoded.document);

    const thumbnailDataUrl = decoded.thumbnail
      ? `data:image/png;base64,${decoded.thumbnail.toString("base64")}`
      : undefined;

    return {
      source: "fig-file",
      title: title ?? null,
      format: decoded.format,
      version: decoded.version ?? null,
      frames: truncatedFrames,
      frameCount: rendered.frameCount,
      pageCount: rendered.pageCount,
      framesTruncated: allFrames.length > MAX_FRAMES,
      designSystem,
      imageCount: decoded.images.length,
      images: decoded.images.map((img) => ({
        filename: `${img.hash}.${img.ext}`,
        ext: img.ext,
        sizeBytes: img.bytes.length,
      })),
      thumbnailDataUrl,
      instructions: [
        "Parsed the .fig file in-process. Next steps:",
        "1. Build the design system: call create-design-system using the " +
          "`designSystem` tokens above (colors are hex, effects are CSS, " +
          "spacing is snapped to a 4/8px scale). Set it as default if the " +
          "user wants it applied to new designs.",
        "2. Import screens: call create-design, then generate-design with the " +
          "`frames` HTML (one file per frame, or the most relevant frames). " +
          "Each frame is complete standalone HTML.",
        "3. Image fills reference `images/<hash>.<ext>` — upload those bytes " +
          "as design assets if you need the images to render.",
      ].join("\n"),
    };
  },
});
