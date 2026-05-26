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
});

type OpenAssetPickerArgs = z.infer<typeof schema>;

function pickerPath(args: Partial<OpenAssetPickerArgs>): string {
  const params = new URLSearchParams();
  params.set("mediaType", args.mediaType ?? "image");
  if (args.prompt?.trim()) params.set("prompt", args.prompt.trim());
  if (args.query?.trim()) params.set("q", args.query.trim());
  if (args.libraryId?.trim()) params.set("libraryId", args.libraryId.trim());
  if (args.aspectRatio?.trim()) {
    params.set("aspectRatio", args.aspectRatio.trim());
  }
  return `/picker?${params.toString()}`;
}

export default defineAction({
  description:
    "Open the Assets picker inline so a person can browse, search, generate, and select an image or video asset. Use this for human-in-the-loop asset choice; use search-assets, generate-image, generate-video, and export-asset for unattended flows.",
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
          ? "Assets video picker is ready."
          : "Assets image picker is ready.",
      query: args.query ?? null,
      prompt: args.prompt ?? null,
      libraryId: args.libraryId ?? null,
      aspectRatio: args.aspectRatio ?? null,
    };
  },
});
