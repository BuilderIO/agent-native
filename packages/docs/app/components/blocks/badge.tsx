import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconBan,
  IconCircleCheck,
  IconClock,
  IconFlame,
  IconInfoCircle,
  IconLock,
  IconRocket,
  IconSparkles,
  IconStar,
  type Icon as TablerIcon,
} from "@tabler/icons-react";

import { badgeSchema, badgeMdx, type BadgeData } from "./badge.config";

export type { BadgeData };

const BADGE_ICON: Record<string, TablerIcon> = {
  "circle-check": IconCircleCheck,
  "circle-info": IconInfoCircle,
  "alert-triangle": IconAlertTriangle,
  "alert-octagon": IconAlertOctagon,
  ban: IconBan,
  clock: IconClock,
  star: IconStar,
  flame: IconFlame,
  sparkles: IconSparkles,
  lock: IconLock,
  rocket: IconRocket,
};

export function BadgeBlock({ data }: BlockReadProps<BadgeData>) {
  const Icon = data.icon ? BADGE_ICON[data.icon] : undefined;
  const color = data.color ?? "gray";
  const size = data.size ?? "sm";
  const shape = data.shape ?? "rounded";

  return (
    <span
      className="docs-badge"
      data-color={color}
      data-size={size}
      data-shape={shape}
      data-stroke={data.stroke ? "true" : undefined}
      data-disabled={data.disabled ? "true" : undefined}
    >
      {Icon && <Icon className="docs-badge-icon" aria-hidden="true" />}
      {data.label}
    </span>
  );
}

export const badgeBlock = defineBlock<BadgeData>({
  type: "badge",
  schema: badgeSchema,
  mdx: badgeMdx,
  Read: BadgeBlock,
  placement: ["block"],
  label: "Badge",
  description:
    "A small status/label chip for the top of a page or section — Beta, Deprecated, v9.1+. Block-level only, not embeddable mid-sentence.",
  empty: () => ({ label: "Beta", color: "orange" }),
});
