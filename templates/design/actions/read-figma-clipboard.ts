import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { importFigmaClipboardFromBuffer } from "../server/lib/figma-clipboard-local-decode.js";
import { mintFigmaReference } from "../server/lib/figma-reference-attachment.js";
import { parseVisibleClipboardHtml } from "../server/lib/visible-clipboard-html.js";
import {
  figmaReferenceFrameSchema,
  type FigmaReferenceFrame,
} from "../shared/figma-reference.js";
import { parseFigmaFileKey } from "../shared/figma-url.js";

export default defineAction({
  description:
    "Decode a selection copied from Figma (Cmd+C) into reference frames for the chat composer, and store them as an attachment ref that place-figma-frames can place exactly. Nothing lands on a design. UI-only, because only the browser has the clipboard.",
  schema: z.object({
    figmetaFileKey: z.string().trim().min(1),
    clipboardHtml: z.string(),
    clipboardBuffer: z.string().max(15_000_000).optional(),
    clipboardBufferOmittedBytes: z.number().int().positive().optional(),
  }),
  outputSchema: z.object({
    frames: z.array(figmaReferenceFrameSchema),
    unresolvedImages: z.number().int().nonnegative(),
    ref: z.string(),
  }),
  http: { method: "POST" },
  agentTool: false,
  toolCallable: false,
  run: async ({
    figmetaFileKey,
    clipboardHtml,
    clipboardBuffer,
    clipboardBufferOmittedBytes,
  }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to attach a Figma selection.", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    const stage = async (
      frames: FigmaReferenceFrame[],
      unresolvedImages: number,
    ) => ({
      frames,
      unresolvedImages,
      ref: await mintFigmaReference(
        { frames, frameCount: frames.length, unresolvedImages },
        ownerEmail,
      ),
    });
    const fileKey = parseFigmaFileKey(figmetaFileKey);
    if (!fileKey) {
      fail("The clipboard's Figma file key could not be parsed.", {
        errorCode: "figma_url_invalid",
      });
    }
    if (clipboardBufferOmittedBytes) {
      fail(
        `This Figma selection carries ${Math.round(clipboardBufferOmittedBytes / 1024 / 1024)} MB of clipboard data, more than a paste can carry. Attach the .fig file instead, or copy fewer layers.`,
        { errorCode: "figma_clipboard_too_large", statusCode: 413 },
      );
    }
    if (clipboardBuffer) {
      const decoded = await importFigmaClipboardFromBuffer({
        bufferBase64: clipboardBuffer,
        fileKey,
      });
      const frames = decoded.files
        .filter((file) => file.fileType === "html")
        .map((file) => ({
          name: file.preferredFrame?.title ?? null,
          ...(file.preferredFrame?.width !== undefined
            ? { width: file.preferredFrame.width }
            : {}),
          ...(file.preferredFrame?.height !== undefined
            ? { height: file.preferredFrame.height }
            : {}),
          html: file.content,
        }));
      if (frames.length) {
        return stage(frames, decoded.unresolvedImageRefs.length);
      }
    }
    const fallbackHtml = parseVisibleClipboardHtml(clipboardHtml).fallbackHtml;
    if (!fallbackHtml) {
      fail(
        "That clipboard has no copied Figma layers in it. Select a frame in Figma, copy it, and paste again.",
        { errorCode: "figma_clipboard_empty" },
      );
    }
    return stage([{ name: null, html: fallbackHtml }], 0);
  },
});
