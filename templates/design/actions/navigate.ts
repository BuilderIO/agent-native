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
 *   pnpm action navigate --view=design-systems --designSystemId=abc123
 *   pnpm action navigate --view=templates
 *   pnpm action navigate --view=settings
 *   pnpm action navigate --path=/some/route
 *
 * Options:
 *   --view       View name (list, editor, design-systems, present, templates, settings)
 *   --designId   Design ID (for editor/present views)
 *   --editorView Editor mode for designs: single or overview
 *   --inspectorTab Inspector tab for designs: design, tweaks, or extensions
 *   --fileId     Screen/file id to focus in the design editor
 *   --filename   Screen filename to focus in the design editor
 *   --designSystemId Design system ID (for design-systems view)
 *   --path       URL path to navigate to
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view or path. Views: list, editor, design-systems, present, templates, settings. Use --designId with editor/present views and --designSystemId with design-systems. For designs, use editorView=overview to show the infinite screens canvas, or editorView=single with fileId/filename/screen to focus a screen. Use inspectorTab=extensions to focus the in-editor extension panel.",
  schema: z.object({
    view: z
      .enum([
        "list",
        "editor",
        "design-systems",
        "present",
        "templates",
        "examples",
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
    designSystemId: z
      .string()
      .optional()
      .describe("Design system ID for design-systems view"),
    path: z.string().optional().describe("URL path to navigate to"),
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
    if (args.fileId) nav.fileId = args.fileId;
    if (args.screenId) nav.screenId = args.screenId;
    if (args.filename) nav.filename = args.filename;
    if (args.screen) nav.screen = args.screen;
    if (args.zoom !== undefined) nav.zoom = args.zoom;
    if (args.designSystemId) nav.designSystemId = args.designSystemId;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.view || args.path}${
      args.designId ? ` (design: ${args.designId})` : ""
    }${editorView ? ` (${editorView} view)` : ""}${
      inspectorTab ? ` (${inspectorTab} inspector)` : ""
    }${
      args.fileId || args.screenId || args.filename || args.screen
        ? ` (screen: ${args.fileId ?? args.screenId ?? args.filename ?? args.screen})`
        : ""
    }${args.designSystemId ? ` (design system: ${args.designSystemId})` : ""}`;
  },
});
