import type { BlockMdxConfig } from "@agent-native/toolkit/app/blocks";
import { z } from "zod";

export type GettingStartedPathsData = Record<string, never>;

export const gettingStartedPathsSchema = z
  .object({})
  .strict() as z.ZodType<GettingStartedPathsData>;

export const gettingStartedPathsMdx: BlockMdxConfig<GettingStartedPathsData> = {
  tag: "GettingStartedPaths",
  toAttrs: () => ({}),
  fromAttrs: () => ({}),
};
