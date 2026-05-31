import { defineAction, embedApp } from "@agent-native/core";
import { z } from "zod";

const mediaTypeSchema = z.enum(["image", "video"]);

const schema = z.object({
  mediaType: mediaTypeSchema.default("image"),
  prompt: z
    .string()
    .optional()
    .describe("Optional starting prompt for generation inside the picker."),
  query: z
    .string()
    .optional()
    .describe("Optional search query used to pre-filter visible assets."),
  libraryId: z
    .string()
    .optional()
    .describe("Optional asset library to open in the picker."),
  aspectRatio: z
    .string()
    .optional()
    .describe("Optional preferred aspect ratio for generation."),
  presetId: z
    .string()
    .optional()
    .describe("Optional generation preset to preselect in the picker."),
  count: z.coerce
    .number()
    .int()
    .min(1)
    .max(6)
    .default(3)
    .describe("Number of image candidates to generate in the picker."),
  autoGenerate: z.coerce
    .boolean()
    .default(false)
    .describe(
      "When true and prompt is provided, generate candidates as soon as the picker opens.",
    ),
});

type OpenAssetPickerArgs = z.infer<typeof schema>;

const FALLBACK_INSTRUCTIONS =
  'If the picker opens in a normal browser tab instead of inline, the user has two ways to choose: (1) click an asset — the picker auto-copies a short handoff summary they paste back into chat, or (2) just tell you which one in words (e.g. "use the second image"). Either way, continue with the chosen asset.';

function pickerPath(args: Partial<OpenAssetPickerArgs>): string {
  const params = new URLSearchParams();
  params.set("mediaType", args.mediaType ?? "image");
  if (args.prompt?.trim()) params.set("prompt", args.prompt.trim());
  if (args.query?.trim()) params.set("q", args.query.trim());
  if (args.libraryId?.trim()) params.set("libraryId", args.libraryId.trim());
  if (args.aspectRatio?.trim()) {
    params.set("aspectRatio", args.aspectRatio.trim());
  }
  if (args.presetId?.trim()) params.set("presetId", args.presetId.trim());
  if (args.count && args.count !== 3) params.set("count", String(args.count));
  if (args.autoGenerate) params.set("autoGenerate", "1");
  return `/picker?${params.toString()}`;
}

export default defineAction({
  description:
    'Open the Assets picker inline so a person can browse, search, generate, and select an image or video asset. When the user asks to create a specific image and choose the best one, pass prompt, autoGenerate: true, and count: 3 so the picker opens with generated candidates. If the host can only open a browser link (e.g. a CLI or code editor), surface that link: after the user picks, the page auto-copies a short paste-back summary — or the user can simply tell you which candidate they want (e.g. "use image A"). Use search-assets, generate-image, generate-video, and export-asset for unattended flows.',
  schema,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Open Assets picker",
    description:
      "Open the real Assets app picker for image or video selection.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Assets picker",
      description:
        "Browse, search, generate, and select image or video assets from the real Assets app.",
      iframeTitle: "Agent-Native Assets",
      openLabel: "Open Assets picker",
      height: 760,
      connectDomains: ["https://cdn.builder.io"],
      resourceDomains: ["https://cdn.builder.io"],
    }),
  },
  link: ({ args, result }) => {
    const url =
      result && typeof result === "object"
        ? (result as { url?: unknown }).url
        : null;
    return {
      url: typeof url === "string" && url ? url : pickerPath(args),
      label: "Open Assets picker",
      view: "picker",
    };
  },
  run: async (args) => {
    const path = pickerPath(args);
    return {
      app: "assets",
      view: "picker",
      mediaType: args.mediaType,
      path,
      url: path,
      embed: true,
      title:
        args.mediaType === "video"
          ? "Select a video asset"
          : "Select an image asset",
      message:
        args.mediaType === "video"
          ? 'Assets video picker is ready. If it opens in a browser tab, the user can click an asset (the page auto-copies a summary to paste back) or just tell you which one (e.g. "use the second image").'
          : args.autoGenerate && args.prompt
            ? 'Assets image picker is ready. It will generate candidates in the picker when image generation is configured, or show setup guidance if generation needs configuration. If it opens in a browser tab, the user can click an asset (the page auto-copies a summary to paste back) or just tell you which one (e.g. "use the second image").'
            : 'Assets image picker is ready. If it opens in a browser tab, the user can click an asset (the page auto-copies a summary to paste back) or just tell you which one (e.g. "use the second image").',
      fallbackInstructions: FALLBACK_INSTRUCTIONS,
      query: args.query ?? null,
      prompt: args.prompt ?? null,
      libraryId: args.libraryId ?? null,
      aspectRatio: args.aspectRatio ?? null,
      presetId: args.presetId ?? null,
      count: args.count,
      autoGenerate: args.autoGenerate,
    };
  },
});
