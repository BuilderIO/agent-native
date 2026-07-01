import { defineAction } from "@agent-native/core";
import { z } from "zod";

export const DESIGN_NATIVE_ASSET_KINDS = [
  "section-frame",
  "text-block",
  "button",
  "card",
  "input",
  "nav-bar",
  "hero",
  "feature-grid",
] as const;

export type DesignNativeAssetKind = (typeof DESIGN_NATIVE_ASSET_KINDS)[number];

type DesignNativeAsset = {
  kind: DesignNativeAssetKind;
  title: string;
  description: string;
  category: "primitive" | "component" | "layout";
  componentName: string;
};

export const DESIGN_NATIVE_ASSETS: DesignNativeAsset[] = [
  {
    kind: "section-frame",
    title: "Frame",
    description:
      "A flexible section container with padding and a subtle border.",
    category: "primitive",
    componentName: "Frame",
  },
  {
    kind: "text-block",
    title: "Text Block",
    description: "Headline, supporting copy, and compact spacing.",
    category: "primitive",
    componentName: "TextBlock",
  },
  {
    kind: "button",
    title: "Button",
    description: "Primary call-to-action with accessible focus styling.",
    category: "component",
    componentName: "Button",
  },
  {
    kind: "card",
    title: "Card",
    description: "Reusable content card with title, body, and action row.",
    category: "component",
    componentName: "Card",
  },
  {
    kind: "input",
    title: "Input",
    description: "Labeled input field with helper copy.",
    category: "component",
    componentName: "Input",
  },
  {
    kind: "nav-bar",
    title: "Nav Bar",
    description: "Compact navigation row for app or page headers.",
    category: "layout",
    componentName: "NavBar",
  },
  {
    kind: "hero",
    title: "Hero",
    description: "Product intro section with headline, copy, and action.",
    category: "layout",
    componentName: "Hero",
  },
  {
    kind: "feature-grid",
    title: "Feature Grid",
    description: "Three-item feature layout for scanning and comparison.",
    category: "layout",
    componentName: "FeatureGrid",
  },
];

export default defineAction({
  description:
    "List Design-native reusable assets and primitives that can be inserted into the active design screen. These are not external media; they are editable HTML components stamped with Design component/layer metadata.",
  schema: z.object({
    category: z.enum(["primitive", "component", "layout"]).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: ({ category }) => {
    const assets = category
      ? DESIGN_NATIVE_ASSETS.filter((asset) => asset.category === category)
      : DESIGN_NATIVE_ASSETS;
    return {
      source: "design-native",
      assets,
      guidance:
        "Use insert-design-native-asset to add one of these assets to the active Design screen. They are editable Design-native HTML components, unlike external media or rendered Figma nodes.",
    };
  },
});
