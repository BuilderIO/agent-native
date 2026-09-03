import type {
  AspectRatio,
  GenerationPresetReferencePolicy,
  ImageCategory,
  ImageModel,
  ImageSize,
} from "./api.js";

export type DefaultGenerationPresetSeed = {
  seedId: string;
  title: string;
  description: string;
  category: ImageCategory;
  promptTemplate: string;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  model: ImageModel;
  textPolicy: string;
  referencePolicy: GenerationPresetReferencePolicy;
  settings: Record<string, unknown>;
};

export const DEFAULT_GENERATION_PRESET_SEEDS: DefaultGenerationPresetSeed[] = [
  {
    seedId: "social-square",
    title: "Social image",
    description:
      "Feed-ready visual with a strong subject, safe crop, and very light embedded text.",
    category: "social",
    promptTemplate:
      "Create a square social post visual about {{prompt}}. Keep the subject readable at feed scale, reserve negative space for editable caption overlays, and avoid clutter.",
    aspectRatio: "1:1",
    imageSize: "2K",
    model: "gemini-3.1-flash-image",
    textPolicy:
      "Prefer no embedded text. If exact text is requested, keep it to 5 words or fewer and make it large enough to read on mobile.",
    referencePolicy: "auto",
    settings: {
      cropSafety: "Keep the main subject inside the center 80%.",
      channel: "social",
    },
  },
  {
    seedId: "blog-hero-wide",
    title: "Blog hero",
    description:
      "Wide editorial hero image with clear hierarchy and room for headline overlays.",
    category: "hero",
    promptTemplate:
      "Create a blog post hero image for {{prompt}}. Use an editorial composition, leave calm negative space for an editable headline, and make the concept understandable without reading text.",
    aspectRatio: "16:9",
    imageSize: "2K",
    model: "gemini-3.1-flash-image",
    textPolicy:
      "Do not render headlines or body copy inside the image. Leave open space for editable text in the layout.",
    referencePolicy: "auto",
    settings: {
      cropSafety:
        "Works as a 16:9 header and can crop to 4:3 without losing the subject.",
      channel: "blog",
    },
  },
  {
    seedId: "diagram-clean",
    title: "Diagram",
    description:
      "Clear conceptual diagram with controlled labels, consistent line weights, and whitespace.",
    category: "diagram",
    promptTemplate:
      "Create a clean diagram for {{prompt}}. Show the main entities, relationships, and flow direction with precise hierarchy and generous whitespace.",
    aspectRatio: "16:9",
    imageSize: "2K",
    model: "gemini-3.1-flash-image",
    textPolicy:
      "Use labels only when they are necessary for comprehension. Keep labels short, high contrast, and evenly aligned.",
    referencePolicy: "collection",
    settings: {
      lineWeight: "consistent",
      labelDensity: "low",
      channel: "diagram",
    },
  },
];
