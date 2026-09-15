import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconBulb,
  IconCircleCheck,
  IconInfoCircle,
} from "@tabler/icons-react";

import { bannerSchema, bannerMdx, type BannerData } from "./banner.config";

export type { BannerData };

const BANNER_ICON = {
  info: IconInfoCircle,
  decision: IconBulb,
  risk: IconAlertOctagon,
  warning: IconAlertTriangle,
  success: IconCircleCheck,
} as const;

export function BannerBlock({ data, ctx }: BlockReadProps<BannerData>) {
  const Icon = BANNER_ICON[data.tone] ?? IconInfoCircle;
  return (
    <div className="docs-banner" data-tone={data.tone}>
      <Icon className="docs-banner-icon" aria-hidden="true" />
      <div className="docs-banner-body">
        {ctx.renderMarkdown?.(data.body) ?? data.body}
      </div>
    </div>
  );
}

export const bannerBlock = defineBlock<BannerData>({
  type: "banner",
  schema: bannerSchema,
  mdx: bannerMdx,
  Read: BannerBlock,
  placement: ["block"],
  label: "Banner",
  description:
    "A compact, full-width, single-line announcement strip for the top of a page or section — beta, deprecated, moved. Tones: info, decision, risk, warning, success.",
  empty: () => ({ tone: "info", body: "Banner text" }),
});
