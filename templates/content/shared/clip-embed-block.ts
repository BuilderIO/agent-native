import {
  defineBlock,
  serializeSpecBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import { z } from "zod";

/**
 * A Clip played inside a page. The block stores only which Clip it plays and
 * how it got there; the video, its sharing and its comments stay in Clips.
 * `upload` is a Clip made from a file uploaded into this page, whose
 * visibility follows the page. `link` is an existing Clip someone linked,
 * which keeps its own sharing.
 */
export const CLIP_EMBED_BLOCK_TYPE = "clip-embed";
export const CLIP_EMBED_TAG = "ClipEmbed";

export const CLIP_EMBED_ORIGINS = ["upload", "link"] as const;
export type ClipEmbedOrigin = (typeof CLIP_EMBED_ORIGINS)[number];

export interface ClipEmbedData {
  recordingId: string;
  origin: ClipEmbedOrigin;
}

// Clips' recording ids are URL path segments; nothing else may reach a URL.
const RECORDING_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isClipRecordingId(value: unknown): value is string {
  return typeof value === "string" && RECORDING_ID.test(value);
}

export const clipEmbedSchema = z.object({
  recordingId: z.string().regex(RECORDING_ID),
  origin: z.enum(CLIP_EMBED_ORIGINS),
}) as unknown as z.ZodType<ClipEmbedData>;

export const clipEmbedMdx: BlockMdxConfig<ClipEmbedData> = {
  tag: CLIP_EMBED_TAG,
  toAttrs: (data) => ({
    recordingId: data.recordingId,
    origin: data.origin,
  }),
  fromAttrs: (attrs) => ({
    recordingId: attrs.string("recordingId") ?? "",
    origin: (attrs.string("origin") ?? "") as ClipEmbedOrigin,
  }),
};

const ServerReadStub = () => null;

export const clipEmbedBlockConfig: BlockSpec<ClipEmbedData> =
  defineBlock<ClipEmbedData>({
    type: CLIP_EMBED_BLOCK_TYPE,
    schema: clipEmbedSchema,
    mdx: clipEmbedMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Clip",
    description:
      "A Clips recording played in the page. Stores the recording id and whether it was uploaded into this page or linked; the video stays in Clips.",
  });

export function readClipEmbedData(data: unknown): ClipEmbedData | null {
  const parsed = clipEmbedSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function clipEmbedBlockRaw(
  blockId: string,
  data: ClipEmbedData,
): string {
  return serializeSpecBlock(clipEmbedBlockConfig, { id: blockId, data });
}

const RAW_RECORDING_ID = /^<ClipEmbed\b[^>]*\srecordingId="([^"]*)"/;

/**
 * The recording a block's saved source names, read without the MDX parser so
 * the editor can report it synchronously. Null for any other block.
 */
export function clipEmbedRecordingIdFromRaw(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = RAW_RECORDING_ID.exec(raw.trim())?.[1];
  return isClipRecordingId(id) ? id : null;
}
