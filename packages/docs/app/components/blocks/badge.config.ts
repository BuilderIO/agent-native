import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

export const BADGE_COLORS = [
  "gray",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "white",
  "surface",
  "white-destructive",
  "surface-destructive",
] as const;

export const BADGE_SIZES = ["xs", "sm", "md", "lg"] as const;

export const BADGE_SHAPES = ["rounded", "pill"] as const;

export const BADGE_ICONS = [
  "circle-check",
  "circle-info",
  "alert-triangle",
  "alert-octagon",
  "ban",
  "clock",
  "star",
  "flame",
  "sparkles",
  "lock",
  "rocket",
] as const;

export type BadgeColor = (typeof BADGE_COLORS)[number];
export type BadgeSize = (typeof BADGE_SIZES)[number];
export type BadgeShape = (typeof BADGE_SHAPES)[number];
export type BadgeIcon = (typeof BADGE_ICONS)[number];

export interface BadgeData {
  label: string;
  color?: BadgeColor;
  size?: BadgeSize;
  shape?: BadgeShape;
  icon?: BadgeIcon;
  stroke?: boolean;
  disabled?: boolean;
}

export const badgeSchema = z.object({
  label: z.string().trim().min(1).max(60),
  color: z.enum(BADGE_COLORS).optional(),
  size: z.enum(BADGE_SIZES).optional(),
  shape: z.enum(BADGE_SHAPES).optional(),
  icon: z.enum(BADGE_ICONS).optional(),
  stroke: z.boolean().optional(),
  disabled: z.boolean().optional(),
}) as unknown as z.ZodType<BadgeData>;

export const badgeMdx: BlockMdxConfig<BadgeData> = {
  tag: "Badge",
  toAttrs: (data) => ({
    label: data.label,
    color: data.color,
    size: data.size,
    shape: data.shape,
    icon: data.icon,
    stroke: data.stroke,
    disabled: data.disabled,
  }),
  fromAttrs: (attrs) => ({
    label: attrs.string("label") ?? "",
    color: attrs.string("color") as BadgeColor | undefined,
    size: attrs.string("size") as BadgeSize | undefined,
    shape: attrs.string("shape") as BadgeShape | undefined,
    icon: attrs.string("icon") as BadgeIcon | undefined,
    stroke: attrs.bool("stroke"),
    disabled: attrs.bool("disabled"),
  }),
};
