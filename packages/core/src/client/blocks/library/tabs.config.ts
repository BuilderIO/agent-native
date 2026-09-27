import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";
import type { NestedBlock } from "../types.js";

export interface TabsTab {
  id: string;
  label: string;
  blocks: NestedBlock[];
}

export type TabsOrientation = "horizontal" | "vertical";

export interface TabsData {
  tabs: TabsTab[];
  orientation?: TabsOrientation;
}

const tabIdSchema = z.string().trim().min(1).max(120);

export const tabsSchema = z.object({
  tabs: z
    .array(
      z.object({
        id: tabIdSchema,
        label: z.string().trim().min(1).max(120),
        blocks: z.array(z.any()).max(40),
      }),
    )
    .min(1)
    .max(12),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
}) as unknown as z.ZodType<TabsData>;

export const tabsMdx: BlockMdxConfig<TabsData> = {
  tag: "TabsBlock",
  toAttrs: (data) => ({
    tabs: data.tabs,
    orientation: data.orientation === "vertical" ? data.orientation : undefined,
  }),
  fromAttrs: (attrs) => ({
    tabs: (attrs.array<TabsTab>("tabs") ?? []) as TabsTab[],
    orientation:
      attrs.string("orientation") === "vertical" ? "vertical" : undefined,
  }),
};
