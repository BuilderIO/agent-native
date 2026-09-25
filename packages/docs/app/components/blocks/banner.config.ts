import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

/**
 * Banner: a compact, full-width, single-line announcement strip meant to sit
 * right under a page's H1 or a section's heading — "this page moved", "beta
 * feature", "deprecated in v9". Distinct from `Notice` (a boxed, multi-line
 * card for content the reader must stop and read) and `Callout` (an inline
 * note within the body copy): Banner is a header-adjacent marker, not body
 * content, so it stays terse — one line of markdown, optionally linking out.
 * Reuses the same five-tone vocabulary as `Callout`/`Notice`.
 */

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

/**
 * MDX config: self-closing `<Banner tone="warning" body="..." />`. Kept as a
 * flat `body` attribute (not markdown children) because a banner is meant to
 * stay a single terse line — an attribute discourages authors from growing it
 * into multi-paragraph content the way an open/close markdown-children block
 * would invite.
 */
export const bannerMdx: BlockMdxConfig<BannerData> = {
  tag: "Banner",
  toAttrs: (data) => ({ tone: data.tone, body: data.body }),
  fromAttrs: (attrs) => ({
    tone: (attrs.string("tone") as BannerTone) ?? "info",
    body: attrs.string("body") ?? "",
  }),
};
