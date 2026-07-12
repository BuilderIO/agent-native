/**
 * Navigate the UI to a view.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=list
 *   pnpm action navigate --view=editor --designId=abc123
 *   pnpm action navigate --view=editor --designId=abc123 --editorView=overview
 *   pnpm action navigate --view=editor --designId=abc123 --filename=checkout.html
 *   pnpm action navigate --view=design-systems
 *   pnpm action navigate --view=templates
 *   pnpm action navigate --view=design-systems --designSystemId=abc123
 *   pnpm action navigate --view=settings
 *   pnpm action navigate --path=/some/route
 *
 * Options:
 *   --view       View name (list, editor, design-systems, present, settings)
 *   --designId   Design ID (for editor/present views)
 *   --editorView Editor mode for designs: single or overview
 *   --inspectorTab Inspector tab for designs: design or tweaks (extensions opens Tools for compatibility)
 *   --leftPanel  Left editor panel: file, agent, assets, import, tools, tokens, or code
 *   --fileId     Screen/file id to focus in the design editor
 *   --filename   Screen filename to focus in the design editor
 *   --tool       Design editor tool to activate
 *   --designSystemId Design system ID (for design-systems view)
 *   --templateId Saved or starter template ID (for templates view)
 *   --path       URL path to navigate to
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

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
    "Navigate the UI to a specific view or path. Views: list, templates, editor, design-systems, present, settings. Use --templateId with templates, --designId with editor/present views, and --designSystemId with design-systems. For designs, use editorView=overview to show the infinite screens canvas, or editorView=single with fileId/filename/screen to focus a screen. Use leftPanel=file|agent|assets|import|tools|tokens|code to focus the left rail, including Import and the wide Code workspace. Legacy inspectorTab=extensions opens Tools. Use tool to activate a design editor tool.",
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
        .enum(["design", "tweaks", "extensions"])
        .optional()
        .describe("Design editor inspector tab to focus"),
      inspector: z
        .enum(["design", "tweaks", "extensions"])
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
        .describe("Optional design editor tool to activate"),
      designSystemId: z
        .string()
        .optional()
        .describe("Design system ID for design-systems view"),
      templateId: z
        .string()
        .optional()
        .describe("Saved or starter template ID for templates view"),
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
    const inspectorTab = args.inspectorTab ?? args.inspector;
    if (inspectorTab) nav.inspectorTab = inspectorTab;
    const leftPanel = args.leftPanel ?? args.panel;
    if (leftPanel) nav.leftPanel = leftPanel;
    if (args.fileId) nav.fileId = args.fileId;
    if (args.screenId) nav.screenId = args.screenId;
    if (args.filename) nav.filename = args.filename;
    if (args.screen) nav.screen = args.screen;
    if (args.zoom !== undefined) nav.zoom = args.zoom;
    if (args.tool) nav.tool = args.tool;
    if (args.designSystemId) nav.designSystemId = args.designSystemId;
    if (args.templateId) nav.templateId = args.templateId;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.view || args.path}${
      args.designId ? ` (design: ${args.designId})` : ""
    }${editorView ? ` (${editorView} view)` : ""}${
      inspectorTab ? ` (${inspectorTab} inspector)` : ""
    }${leftPanel ? ` (${leftPanel} panel)` : ""}${
      args.fileId || args.screenId || args.filename || args.screen
        ? ` (screen: ${args.fileId ?? args.screenId ?? args.filename ?? args.screen})`
        : ""
    }${args.tool ? ` (${args.tool} tool)` : ""}${args.designSystemId ? ` (design system: ${args.designSystemId})` : ""}`;
  },
});
