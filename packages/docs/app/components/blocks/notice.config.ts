import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

/**
 * Notice: a bold, filled alert card — title + icon + markdown body, colored by
 * tone. Distinct from `Callout` (a subtle left-border note meant to sit inline
 * in a paragraph flow without breaking stride) — Notice is a standalone,
 * higher-attention block for something a reader must not skim past. Reuses the
 * same five-tone vocabulary as `Callout` (info/decision/risk/warning/success)
 * so the two components share one color language instead of introducing a
 * second, parallel tone naming.
 */

export const NOTICE_TONES = [
  "info",
  "decision",
  "risk",
  "warning",
  "success",
] as const;

export type NoticeTone = (typeof NOTICE_TONES)[number];

export interface NoticeData {
  tone: NoticeTone;
  title?: string;
  body: string;
}

export const noticeSchema = z.object({
  tone: z.enum(NOTICE_TONES),
  title: z.string().trim().max(200).optional(),
  body: z.string(),
}) as unknown as z.ZodType<NoticeData>;

/**
 * MDX config: `tone` and `title` are flat attrs; the body is the element's
 * markdown children (`<Notice tone="risk" title="...">` … `</Notice>`), same
 * shape as `Callout` so authoring feels familiar.
 */
export const noticeMdx: BlockMdxConfig<NoticeData> = {
  tag: "Notice",
  childrenField: "body" as never,
  toAttrs: (data) => ({ tone: data.tone, title: data.title }),
  fromAttrs: (attrs, children) => ({
    tone: (attrs.string("tone") as NoticeTone) ?? "info",
    title: attrs.string("title"),
    body: children.trim(),
  }),
  serializeChildren: (data) => data.body,
};
