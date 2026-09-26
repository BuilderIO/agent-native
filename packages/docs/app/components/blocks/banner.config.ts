import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

export const BANNER_TONES = [
  "info",
  "decision",
  "risk",
  "warning",
  "success",
] as const;

export type BannerTone = (typeof BANNER_TONES)[number];

export interface BannerData {
  tone: BannerTone;
  body: string;
}

export const bannerSchema = z.object({
  tone: z.enum(BANNER_TONES),
  body: z.string().trim().min(1).max(400),
}) as unknown as z.ZodType<BannerData>;

export const bannerMdx: BlockMdxConfig<BannerData> = {
  tag: "Banner",
  toAttrs: (data) => ({ tone: data.tone, body: data.body }),
  fromAttrs: (attrs) => ({
    tone: (attrs.string("tone") as BannerTone) ?? "info",
    body: attrs.string("body") ?? "",
  }),
};
