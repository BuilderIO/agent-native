import { defineAction } from "@agent-native/core/action";
import {
  navigationIntentSchema,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { z } from "zod";

import { SELECTABLE_INTERACT_DEVICE_PRESETS } from "../shared/interact-device-presets.js";
import { INTERACT_THEME_MODES } from "../shared/preview-color-scheme.js";

const interactDeviceNames = SELECTABLE_INTERACT_DEVICE_PRESETS.map(
  (preset) => preset.name,
);

const designEditorToolSchema = z.enum([
  "move",
  "frame",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
  "text",
  "pen",
  "hand",
  "comment",
  "scale",
]);

// The Agent and Draw tools are retired. A stale agent or URL that still asks
// for one gets Move, not an error; leftPanel=agent opens the Agent panel.
const retiredToolToMove = (value: unknown) =>
  value === "agent" || value === "draw" ? "move" : value;

const designLeftPanelSchema = z.preprocess(
  (value) => (value === "tokens" ? "library" : value),
  z.enum(["file", "agent", "library", "assets", "tools", "threads"]),
);

export default defineAction({
  description:
    "Navigate the UI to a specific view or path. Views: list, templates, editor, present, settings. Use --templateId with templates, --designId with editor/present views. Use view=list with --search to land on Design home filtered by that text (for example to show the designs matching a name), from any screen including an open editor. For designs, use editorView=overview to show the infinite screens canvas, or editorView=single with fileId/filename/screen to focus a screen. Use leftPanel=agent|file|library (or assets|tools) to pick the left panel tab: agent is the chat, file is the File tab with pages and the layer tree, library hosts the design tokens (the legacy value tokens is an alias for library); leftPanel=threads opens the Comments panel in the right column in place of the inspector. The inspector has no tabs, so inspectorTab is accepted and ignored; the legacy value extensions still opens Tools. Use tool to activate a design editor tool. In Interact mode, use interactDevice to pick the preview device and interactTheme=light|dark|system to pick the preview color scheme.",
  schema: z
    .object({
      view: z
        .enum(["list", "templates", "editor", "present", "settings"])
        .optional()
        .describe("View name to navigate to"),
      designId: z.string().optional().describe("Design ID for editor/present"),
      editorView: z
        .enum(["single", "overview"])
        .optional()
        .describe(
          "Design editor view: overview for the infinite screens canvas, single for a focused screen",
        ),
      viewMode: z
        .enum(["single", "overview"])
        .optional()
        .describe("Alias for editorView"),
      inspectorTab: z
        .enum(["design", "comments", "tweaks", "code", "extensions"])
        .optional()
        .describe(
          "Ignored: the inspector has no tabs. Only the legacy value extensions is read, as an alias for leftPanel=tools.",
        ),
      inspector: z
        .enum(["design", "comments", "tweaks", "code", "extensions"])
        .optional()
        .describe("Alias for inspectorTab"),
      leftPanel: designLeftPanelSchema
        .optional()
        .describe("Design editor left panel tab to show"),
      panel: designLeftPanelSchema.optional().describe("Alias for leftPanel"),
      fileId: z.string().optional().describe("Design file/screen ID to focus"),
      screenId: z.string().optional().describe("Alias for fileId"),
      filename: z
        .string()
        .optional()
        .describe("Design screen filename to focus, such as checkout.html"),
      screen: z
        .string()
        .optional()
        .describe("Screen id, filename, or name to focus"),
      zoom: z
        .number()
        .optional()
        .describe("Optional design canvas zoom percentage"),
      tool: z
        .preprocess(retiredToolToMove, designEditorToolSchema)
        .optional()
        .describe(
          "Optional design editor tool to activate. comment arms the comment pin tool and opens the Comments panel. To open the Agent panel use leftPanel=agent.",
        ),
      interactDevice: z
        .string()
        .refine((name) => interactDeviceNames.includes(name), {
          message: `interactDevice must be one of: ${interactDeviceNames.join(", ")}`,
        })
        .optional()
        .describe(
          `Interact mode device preset (${interactDeviceNames.join(", ")})`,
        ),
      interactTheme: z
        .enum(INTERACT_THEME_MODES)
        .optional()
        .describe(
          "Interact mode color scheme for the preview: light, dark or system. system is the default and shows the design exactly as authored, with no scheme forced. light and dark force that scheme. Dark only changes designs that have dark styles; without them the preview stays as it is and the user is asked to add some. A screen served from a URL or running app takes no theme.",
        ),
      templateId: z
        .string()
        .optional()
        .describe("Saved or built-in template ID for templates view"),
      path: z.string().optional().describe("URL path to navigate to"),
      search: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe(
          "With view=list: filter Design home by this text (case-insensitive match on design titles)",
        ),
      intent: navigationIntentSchema,
    })
    .superRefine((args, ctx) => {
      const editorView = args.editorView ?? args.viewMode;
      if (
        (args.view === "editor" || args.view === "present") &&
        !args.designId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["designId"],
          message: `designId is required for ${args.view} view`,
        });
      }
      if (
        args.view === "editor" &&
        editorView === "single" &&
        !args.fileId &&
        !args.screenId &&
        !args.filename &&
        !args.screen
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["editorView"],
          message:
            "single editor view requires a fileId, screenId, filename, or screen",
        });
      }
    }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      throw new Error("At least --view or --path is required.");
    }
    const nav: Record<string, unknown> = {};
    if (args.view) nav.view = args.view;
    if (args.designId) nav.designId = args.designId;
    const editorView = args.editorView ?? args.viewMode;
    if (editorView) nav.editorView = editorView;
    const legacyInspectorPanel =
      (args.inspectorTab ?? args.inspector) === "extensions"
        ? "tools"
        : undefined;
    const leftPanel = args.leftPanel ?? args.panel ?? legacyInspectorPanel;
    if (leftPanel) nav.leftPanel = leftPanel;
    if (args.fileId) nav.fileId = args.fileId;
    if (args.screenId) nav.screenId = args.screenId;
    if (args.filename) nav.filename = args.filename;
    if (args.screen) nav.screen = args.screen;
    if (args.zoom !== undefined) nav.zoom = args.zoom;
    if (args.tool) nav.tool = args.tool;
    if (args.interactDevice) nav.interactDevice = args.interactDevice;
    if (args.interactTheme) nav.interactTheme = args.interactTheme;
    if (args.templateId) nav.templateId = args.templateId;
    if (args.path) nav.path = args.path;
    if (args.search) nav.search = args.search;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || args.path}${
      args.designId ? ` (design: ${args.designId})` : ""
    }${editorView ? ` (${editorView} view)` : ""}${
      leftPanel ? ` (${leftPanel} panel)` : ""
    }${
      args.fileId || args.screenId || args.filename || args.screen
        ? ` (screen: ${args.fileId ?? args.screenId ?? args.filename ?? args.screen})`
        : ""
    }${args.search ? ` (search: ${JSON.stringify(args.search)})` : ""}${args.tool ? ` (${args.tool} tool)` : ""}${
      args.interactDevice ? ` (device: ${args.interactDevice})` : ""
    }${args.interactTheme ? ` (theme: ${args.interactTheme})` : ""}`;
  },
});
