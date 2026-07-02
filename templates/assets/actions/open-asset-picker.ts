import { defineAction, embedApp } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestRunContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { IMAGE_QUALITY_TIERS, STYLE_STRENGTHS } from "../shared/api.js";

const mediaTypeSchema = z.enum(["image", "video"]);
const layoutSchema = z.enum(["default", "vertical"]);
const booleanParam = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["", "0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

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
  libraryHint: z
    .string()
    .optional()
    .describe(
      "Brand, campaign, or use-case hint used to preselect the best-matching library when libraryId is omitted.",
    ),
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
  candidateRunIds: z
    .array(z.string())
    .optional()
    .describe(
      "Generation run IDs to show as the candidate set when returning from a tool-generated batch.",
    ),
  autoGenerate: booleanParam
    .default(false)
    .describe(
      "When true and prompt is provided, generate candidates as soon as the picker opens.",
    ),
  tier: z
    .enum(IMAGE_QUALITY_TIERS)
    .optional()
    .describe("Optional image quality tier to use for auto-generation."),
  styleStrength: z
    .enum(STYLE_STRENGTHS)
    .default("balanced")
    .describe("How strongly to follow the library style during generation."),
  includeLogo: booleanParam
    .optional()
    .describe(
      "Override logo compositing for auto-generation. When omitted, the selected preset's logo setting decides whether the library's canonical logo is composited.",
    ),
  callerAppId: z
    .string()
    .optional()
    .describe("Calling app id, for audit grouping, e.g. design."),
  layout: layoutSchema
    .default("default")
    .describe(
      "Picker layout density. Use vertical when embedding in a narrow sidebar.",
    ),
});

type OpenAssetPickerArgs = z.infer<typeof schema>;
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

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

const FALLBACK_INSTRUCTIONS =
  'If the picker opens in a normal browser tab instead of inline, the user has two ways to choose: (1) click an asset — the picker auto-copies a short handoff summary they paste back into chat, or (2) just tell you which one in words (e.g. "use the second image"). Either way, continue with the chosen asset. In Codex, Claude Code, and other code-editor chats, do not expect MCP Apps to render inline; provide the asset link, and if the final answer needs an inline image preview, download the selected image URL locally and embed the absolute local file path because remote CDN markdown previews may not render there.';

function pickerPath(args: Partial<OpenAssetPickerArgs>): string {
  const params = new URLSearchParams();
  params.set("__an_picker", "1");
  params.set("mediaType", args.mediaType ?? "image");
  if (args.prompt?.trim()) params.set("prompt", args.prompt.trim());
  if (args.query?.trim()) params.set("q", args.query.trim());
  if (args.libraryId?.trim()) params.set("libraryId", args.libraryId.trim());
  if (args.libraryHint?.trim()) {
    params.set("libraryHint", args.libraryHint.trim());
  }
  if (args.aspectRatio?.trim()) {
    params.set("aspectRatio", args.aspectRatio.trim());
  }
  if (args.presetId?.trim()) params.set("presetId", args.presetId.trim());
  if (args.count && args.count !== 3) params.set("count", String(args.count));
  if (args.tier) params.set("tier", args.tier);
  if (args.styleStrength && args.styleStrength !== "balanced") {
    params.set("styleStrength", args.styleStrength);
  }
  if (args.includeLogo) params.set("includeLogo", "1");
  if (args.callerAppId?.trim()) params.set("callerAppId", args.callerAppId);
  if (args.layout === "vertical") params.set("layout", "vertical");
  for (const runId of args.candidateRunIds ?? []) {
    if (runId.trim()) params.append("candidateRunIds", runId.trim());
  }
  if (args.autoGenerate) params.set("autoGenerate", "1");
  return `/library?${params.toString()}`;
}

function navigateCommandKey(): string | null {
  const browserTabId = getRequestRunContext()?.browserTabId?.trim();
  if (browserTabId && SAFE_BROWSER_TAB_ID_RE.test(browserTabId)) {
    return `navigate:${browserTabId}`;
  }
  return null;
}

function shouldWriteNavigateCommand(
  context: ActionRunContext | undefined,
  commandKey: string | null,
): commandKey is string {
  return Boolean(commandKey) && context?.caller !== "mcp";
}

const action = defineAction({
  description:
    'Open the image Library picker inline so a person can browse, search, generate, and select an image or video asset. When the user asks to create a specific image and choose the best one, pass prompt, autoGenerate: true, and count: 3 so the Library opens with generated candidates. If the host can only open a browser link (e.g. a CLI or code editor), surface that link: after the user picks, the page auto-copies a short paste-back summary — or the user can simply tell you which candidate they want (e.g. "use image A"). Use search-assets, generate-image, generate-video, and export-asset for unattended flows.',
  schema,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Open Assets Library picker",
    description:
      "Open the real Assets app Library picker for image or video selection.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Assets Library picker",
      description:
        "Browse, search, generate, and select image or video assets from the real Assets app.",
      iframeTitle: "Agent-Native Assets",
      openLabel: "Open Assets Library picker",
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
      label: "Open Assets Library picker",
      view: "picker",
    };
  },
  run: async (args, context) => {
    const path = pickerPath(args);
    const commandKey = navigateCommandKey();
    if (shouldWriteNavigateCommand(context, commandKey)) {
      const command = {
        view: "picker" as const,
        mediaType: args.mediaType,
        path,
        libraryId: args.libraryId ?? null,
        query: args.query ?? null,
        prompt: args.prompt ?? null,
        aspectRatio: args.aspectRatio ?? null,
        presetId: args.presetId ?? null,
        layout: args.layout,
        _writeId: `open-asset-picker-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      };
      await writeAppState(commandKey, command);
    }
    return {
      app: "assets",
      view: "picker",
      mediaType: args.mediaType,
      path,
      url: path,
      embed: true,
      layout: args.layout,
      title:
        args.mediaType === "video"
          ? "Select a video asset"
          : "Select an image asset",
      message:
        args.mediaType === "video"
          ? 'Assets video picker is ready. If it opens in a browser tab, the user can click an asset (the page auto-copies a summary to paste back) or just tell you which one (e.g. "use the second image"). Codex and Claude Code use this link-out flow rather than inline MCP Apps.'
          : args.autoGenerate && args.prompt
            ? 'Assets image picker is ready. It will generate candidates in the picker when image generation is configured, or show setup guidance if generation needs configuration. If it opens in a browser tab, the user can click an asset (the page auto-copies a summary to paste back) or just tell you which one (e.g. "use the second image"). Codex and Claude Code use this link-out flow rather than inline MCP Apps.'
            : 'Assets image picker is ready. If it opens in a browser tab, the user can click an asset (the page auto-copies a summary to paste back) or just tell you which one (e.g. "use the second image"). Codex and Claude Code use this link-out flow rather than inline MCP Apps.',
      fallbackInstructions: FALLBACK_INSTRUCTIONS,
      query: args.query ?? null,
      prompt: args.prompt ?? null,
      libraryId: args.libraryId ?? null,
      libraryHint: args.libraryHint ?? null,
      aspectRatio: args.aspectRatio ?? null,
      presetId: args.presetId ?? null,
      count: args.count,
      tier: args.tier ?? null,
      styleStrength: args.styleStrength,
      includeLogo: args.includeLogo,
      callerAppId: args.callerAppId ?? null,
      candidateRunIds: args.candidateRunIds ?? [],
      autoGenerate: args.autoGenerate,
    };
  },
});

export default allowStringifiedCountInToolSchema(action);
