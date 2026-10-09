import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import { SELECTABLE_INTERACT_DEVICE_PRESETS } from "../shared/interact-device-presets.js";
import {
  INTERACT_THEME_MODES,
  normalizeInteractThemeMode,
} from "../shared/preview-color-scheme.js";

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
  "draw",
  "scale",
  "agent",
]);

const designLeftPanelSchema = z.enum([
  "file",
  "agent",
  "assets",
  "import",
  "tools",
  "tokens",
  "code",
]);

export default defineAction({
  description:
    "Navigate the UI to a specific view or path. Views: list, templates, editor, design-systems, present, settings. Use --templateId with templates, --designId with editor/present views, and --designSystemId with design-systems. For designs, use editorView=overview to show the infinite screens canvas, or editorView=single with fileId/filename/screen to focus a screen. Use leftPanel=file|agent|assets|import|tools|tokens|code to focus the left rail, including Import and the wide Code workspace. The inspector has no tabs, so inspectorTab is accepted and ignored; the legacy value extensions still opens Tools. Use tool to activate a design editor tool. In Interact mode, use interactDevice to pick the preview device and interactTheme=light|dark to pick the preview color scheme.",
  schema: z
    .object({
      view: z
        .enum([
          "list",
          "templates",
          "editor",
          "design-systems",
          "present",
          "settings",
        ])
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
        .describe("Design editor left rail panel to focus"),
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
      tool: designEditorToolSchema
        .optional()
        .describe(
          "Optional design editor tool to activate. agent opens the Agent panel. draw only applies while the user has the Annotate lab on, and comment is hidden for now; either lands on move.",
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
        // A retired `system` request reads as Light rather than failing the call.
        .preprocess(
          (value) => normalizeInteractThemeMode(value) ?? value,
          z.enum(INTERACT_THEME_MODES),
        )
        .optional()
        .describe(
          "Interact mode color scheme for the preview: light or dark. Dark only changes designs that have dark styles; without them the preview stays light and the user is asked to add some.",
        ),
      designSystemId: z
        .string()
        .optional()
        .describe("Design system ID for design-systems view"),
      templateId: z
        .string()
        .optional()
        .describe("Saved or built-in template ID for templates view"),
      path: z.string().optional().describe("URL path to navigate to"),
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
    if (args.designSystemId) nav.designSystemId = args.designSystemId;
    if (args.templateId) nav.templateId = args.templateId;
    if (args.path) nav.path = args.path;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || args.path}${
      args.designId ? ` (design: ${args.designId})` : ""
    }${editorView ? ` (${editorView} view)` : ""}${
      leftPanel ? ` (${leftPanel} panel)` : ""
    }${
      args.fileId || args.screenId || args.filename || args.screen
        ? ` (screen: ${args.fileId ?? args.screenId ?? args.filename ?? args.screen})`
        : ""
    }${args.tool ? ` (${args.tool} tool)` : ""}${
      args.interactDevice ? ` (device: ${args.interactDevice})` : ""
    }${args.interactTheme ? ` (theme: ${args.interactTheme})` : ""}${args.designSystemId ? ` (design system: ${args.designSystemId})` : ""}`;
  },
});
