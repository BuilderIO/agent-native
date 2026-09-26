import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

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
