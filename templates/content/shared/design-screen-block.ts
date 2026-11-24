import {
  defineBlock,
  serializeSpecBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import {
  checkEmbedAudience,
  designScreenSourceSchema,
  type EmbedAudienceCheck,
  type EmbedVisibility,
} from "@agent-native/core/shared";
import { z } from "zod";

import { privateMediaIdFromSrc } from "./private-media.js";

export const DESIGN_SCREEN_BLOCK_TYPE = "design-screen";
export const DESIGN_SCREEN_TAG = "DesignScreen";

export const designScreenSchema = designScreenSourceSchema.extend({
  image: z.object({
    src: z
      .string()
      .max(200)
      .refine((src) => privateMediaIdFromSrc(src) !== null, {
        message: "Expected one of the page's private images.",
      }),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    alt: z.string().max(1000),
  }),
  capturedAt: z.string().datetime(),
  capturedBy: z.string().max(200),
});

export type DesignScreenData = z.infer<typeof designScreenSchema>;

const MISSING_DESIGN: DesignScreenData["design"] = {
  id: "",
  title: "",
  url: "",
  visibility: "private",
};
const MISSING_SCREEN: DesignScreenData["screen"] = {
  id: "",
  name: "",
  width: 0,
  fingerprint: "",
  url: "",
};
const MISSING_IMAGE: DesignScreenData["image"] = {
  src: "",
  width: 0,
  height: 0,
  alt: "",
};

export const designScreenMdx: BlockMdxConfig<DesignScreenData> = {
  tag: DESIGN_SCREEN_TAG,
  toAttrs: (data) => ({
    design: data.design,
    screen: data.screen,
    image: data.image,
    capturedAt: data.capturedAt,
    capturedBy: data.capturedBy,
  }),
  fromAttrs: (attrs) => ({
    design:
      attrs.object<DesignScreenData["design"]>("design") ?? MISSING_DESIGN,
    screen:
      attrs.object<DesignScreenData["screen"]>("screen") ?? MISSING_SCREEN,
    image: attrs.object<DesignScreenData["image"]>("image") ?? MISSING_IMAGE,
    capturedAt: attrs.string("capturedAt") ?? "",
    capturedBy: attrs.string("capturedBy") ?? "",
  }),
};

const ServerReadStub = () => null;

export const designScreenBlockConfig: BlockSpec<DesignScreenData> =
  defineBlock<DesignScreenData>({
    type: DESIGN_SCREEN_BLOCK_TYPE,
    schema: designScreenSchema,
    mdx: designScreenMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Design screen",
    description:
      "A picture of one Design screen at one width, from when it was pinned or last refreshed, with who pinned it and a link back to the screen in Design. Add or refresh one with capture-design-screen; never write its picture by hand.",
  });

export function readDesignScreenData(data: unknown): DesignScreenData | null {
  const parsed = designScreenSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function designScreenBlockRaw(
  blockId: string,
  data: DesignScreenData,
): string {
  return serializeSpecBlock(designScreenBlockConfig, { id: blockId, data });
}

export function designScreenAudience(
  action: "insert" | "widen",
  page: EmbedVisibility,
  data: Pick<DesignScreenData, "design">,
): EmbedAudienceCheck {
  return checkEmbedAudience({
    action,
    page,
    source: data.design.visibility,
  });
}

export function designScreensWiderThan(
  page: EmbedVisibility,
  screens: readonly Pick<DesignScreenData, "design" | "screen">[],
): Pick<DesignScreenData, "design" | "screen">[] {
  return screens.filter(
    (screen) => designScreenAudience("widen", page, screen).verdict !== "ok",
  );
}

export function describeDesignScreen(
  data: Pick<DesignScreenData, "design" | "screen">,
): string {
  return `The ${data.screen.name} screen from the ${data.design.title} design in Design, at ${data.screen.width} pixels wide.`;
}
