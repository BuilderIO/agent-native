import { defineAction, embedApp } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import {
  ASPECT_RATIOS,
  IMAGE_QUALITY_TIERS,
  STYLE_STRENGTHS,
} from "../shared/api.js";
import openAssetPicker from "./open-asset-picker.js";

const booleanParam = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["", "0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const schema = z.object({
  mediaType: z.enum(["image", "video"]).default("image"),
  prompt: z
    .string()
    .min(1)
    .describe("The asset brief to generate or prepare in the picker."),
  libraryId: z
    .string()
    .optional()
    .describe("Known Assets library ID. Omit to match the best library."),
  libraryHint: z
    .string()
    .optional()
    .describe(
      "Brand, campaign, or use-case hint used when matching a library.",
    ),
  aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
  presetId: z
    .string()
    .optional()
    .describe("Optional generation preset ID from the selected library."),
  count: z.coerce
    .number()
    .int()
    .min(1)
    .max(6)
    .default(3)
    .describe("Number of image candidates to generate in the picker."),
  tier: z.enum(IMAGE_QUALITY_TIERS).optional(),
  styleStrength: z.enum(STYLE_STRENGTHS).default("balanced"),
  includeLogo: booleanParam.default(false),
  callerAppId: z
    .string()
    .optional()
    .describe("Calling app id, for audit grouping, e.g. design."),
});

type ActionWithToolParameters = {
  tool: { parameters?: { properties?: Record<string, any> } };
};

function allowStringifiedCountInToolSchema<T extends ActionWithToolParameters>(
  action: T,
): T {
  const parameters = action.tool.parameters;
  const count = parameters?.properties?.count;
  if (count && typeof count === "object" && !Array.isArray(count)) {
    parameters!.properties!.count = {
      description: count.description,
      default: count.default,
      anyOf: [
        count,
        {
          type: "string",
          pattern: "^[1-6]$",
          description: count.description,
        },
      ],
    };
  }
  return action;
}

const action = defineAction({
  description:
    "Open the real Assets picker and start on-brand image generation there so the tool returns immediately and the user can choose the final image/video. Use this for human-in-the-loop brand media requests from Design, Slides, ChatGPT, Claude, or Codex. Preserve returned asset IDs and URLs exactly after the user picks.",
  schema,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    title: "Generate an on-brand asset",
    description:
      "Start brand-consistent image generation in the Assets picker.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Generate Assets",
      description:
        "Generate image candidates and choose the final asset in the real Assets Library picker.",
      iframeTitle: "Agent-Native Assets",
      openLabel: "Open Assets picker",
      height: 760,
      connectDomains: ["https://cdn.builder.io"],
      resourceDomains: ["https://cdn.builder.io"],
    }),
  },
  link: ({ result }) => {
    const url =
      result && typeof result === "object"
        ? (result as { url?: unknown }).url
        : null;
    return {
      url: typeof url === "string" && url ? url : "/library",
      label: "Open Assets picker",
      view: "picker",
    };
  },
  run: async (args, context?: ActionRunContext) => {
    if (args.mediaType === "video") {
      const picker = (await openAssetPicker.run(
        {
          mediaType: "video",
          prompt: args.prompt,
          libraryId: args.libraryId,
          libraryHint: args.libraryHint,
          count: args.count,
          callerAppId: args.callerAppId,
        },
        context,
      )) as Record<string, unknown>;
      return {
        ...picker,
        generated: false,
        message:
          "Assets video picker is ready. Generate or select the video in the picker, then choose the asset to send it back.",
      };
    }

    const picker = (await openAssetPicker.run(
      {
        mediaType: "image",
        prompt: args.prompt,
        libraryId: args.libraryId,
        libraryHint: args.libraryHint,
        aspectRatio: args.aspectRatio,
        presetId: args.presetId,
        count: args.count,
        autoGenerate: true,
        tier: args.tier,
        styleStrength: args.styleStrength,
        includeLogo: args.includeLogo,
        callerAppId: args.callerAppId,
      },
      context,
    )) as Record<string, unknown>;
    return {
      ...picker,
      generated: false,
      generationStarted: false,
      generationMode: "picker-auto-generate",
      message:
        "Assets picker is ready and will start image generation inside the picker. If this org has no libraries yet, the picker will create a starter library first. Ask the user to pick one candidate; preserve the chosen assetId, runId, and URLs exactly.",
    };
  },
});

export default allowStringifiedCountInToolSchema(action);
