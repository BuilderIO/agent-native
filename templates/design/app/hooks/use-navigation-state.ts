import {
  useAgentRouteState,
  getBrowserTabId,
  setClientAppState,
} from "@agent-native/core/client";
import { useEffect } from "react";
import { useLocation, useParams } from "react-router";

export interface NavigationState {
  view: string;
  designId?: string;
  designSystemId?: string;
  templateId?: string;
  editorView?: "single" | "overview";
  inspectorTab?: "design" | "tweaks" | "extensions";
  inspector?: "design" | "tweaks" | "extensions";
  leftPanel?:
    | "file"
    | "agent"
    | "assets"
    | "tools"
    | "tokens"
    | "import"
    | "code";
  panel?: "file" | "agent" | "assets" | "tools" | "tokens" | "import" | "code";
  fileId?: string;
  screenId?: string;
  filename?: string;
  screen?: string;
  selection?: string;
  zoom?: number;
  tool?: string;
  path?: string;
}

const DESIGN_EDITOR_TOOLS = [
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
] as const;

export interface DesignEditorCommand {
  designId: string;
  editorView?: "single" | "overview";
  viewMode?: "single" | "overview";
  inspectorTab?: "design" | "tweaks" | "extensions";
  inspector?: "design" | "tweaks" | "extensions";
  leftPanel?:
    | "file"
    | "agent"
    | "assets"
    | "tools"
    | "tokens"
    | "import"
    | "code";
  panel?: "file" | "agent" | "assets" | "tools" | "tokens" | "import" | "code";
  fileId?: string;
  screenId?: string;
  filename?: string;
  screen?: string;
  selection?: string;
  zoom?: number;
  tool?: string;
  path?: string;
  issuedAt: number;
}

const FOCUSED_SCREEN_ZOOM = 100;

export function designEditorCommandKey(browserTabId?: string): string {
  return browserTabId
    ? `design-editor-command:${browserTabId}`
    : "design-editor-command";
}

export function designEditorCommandKeysForTab(browserTabId?: string): string[] {
  return [designEditorCommandKey(browserTabId)];
}

export function designSelectionStateKeysForTab(
  browserTabId?: string,
): string[] {
  return browserTabId
    ? [`design-selection:${browserTabId}`, "design-selection"]
    : ["design-selection"];
}

/**
 * Route-level cleanup only owns this tab's scoped selection. The editor's
 * owner-aware unmount cleanup is responsible for the global compatibility
 * mirror; clearing that mirror here would let any tab that leaves /design
 * erase another still-open editor tab's current agent context.
 */
export function designSelectionCleanupKeysForTab(
  browserTabId?: string,
): string[] {
  return [
    browserTabId ? `design-selection:${browserTabId}` : "design-selection",
  ];
}

function normalizeEditorView(
  value: unknown,
): "single" | "overview" | undefined {
  return value === "single" || value === "overview" ? value : undefined;
}

function normalizeInspectorTab(
  value: unknown,
): "design" | "tweaks" | "extensions" | undefined {
  return value === "design" || value === "tweaks" || value === "extensions"
    ? value
    : undefined;
}

function normalizeLeftPanel(
  value: unknown,
):
  | "file"
  | "agent"
  | "assets"
  | "tools"
  | "tokens"
  | "import"
  | "code"
  | undefined {
  if (value === "extensions") return "tools";
  return value === "file" ||
    value === "agent" ||
    value === "assets" ||
    value === "tools" ||
    value === "tokens" ||
    value === "import" ||
    value === "code"
    ? value
    : undefined;
}

function normalizeDesignTool(value: unknown): string | undefined {
  return typeof value === "string" &&
    DESIGN_EDITOR_TOOLS.includes(value as (typeof DESIGN_EDITOR_TOOLS)[number])
    ? value
    : undefined;
}

export function editorPathFromCommand(cmd: NavigationState): string | null {
  if (cmd.path) return cmd.path;
  if (cmd.view !== "editor" || !cmd.designId) return null;

  const params = new URLSearchParams();
  const editorView = normalizeEditorView(cmd.editorView);
  if (editorView) params.set("view", editorView);
  const inspectorTab = normalizeInspectorTab(cmd.inspectorTab ?? cmd.inspector);
  if (inspectorTab) params.set("inspector", inspectorTab);
  const leftPanel = normalizeLeftPanel(cmd.leftPanel ?? cmd.panel);
  if (leftPanel) params.set("panel", leftPanel);
  const screen = cmd.fileId ?? cmd.screenId ?? cmd.filename ?? cmd.screen;
  if (screen) params.set("screen", screen);
  if (cmd.selection) params.set("selection", cmd.selection);
  if (typeof cmd.zoom === "number" && Number.isFinite(cmd.zoom)) {
    params.set("zoom", String(cmd.zoom));
  } else if (editorView === "single") {
    params.set("zoom", String(FOCUSED_SCREEN_ZOOM));
  }
  const tool = normalizeDesignTool(cmd.tool);
  if (tool) params.set("tool", tool);

  const query = params.toString();
  return `/design/${encodeURIComponent(cmd.designId)}${query ? `?${query}` : ""}`;
}

export function editorCommandFromNavigate(
  cmd: NavigationState,
  path: string,
): DesignEditorCommand | null {
  if (cmd.view !== "editor" || !cmd.designId) return null;
  const editorView = normalizeEditorView(cmd.editorView);
  const inspectorTab = normalizeInspectorTab(cmd.inspectorTab ?? cmd.inspector);
  const leftPanel =
    normalizeLeftPanel(cmd.leftPanel ?? cmd.panel) ??
    normalizeLeftPanel(cmd.inspectorTab ?? cmd.inspector);
  const command: DesignEditorCommand = {
    designId: cmd.designId,
    issuedAt: Date.now(),
    path,
  };
  if (editorView) command.editorView = editorView;
  if (inspectorTab) command.inspectorTab = inspectorTab;
  if (leftPanel) command.leftPanel = leftPanel;
  if (cmd.fileId) command.fileId = cmd.fileId;
  if (cmd.screenId) command.screenId = cmd.screenId;
  if (cmd.filename) command.filename = cmd.filename;
  if (cmd.screen) command.screen = cmd.screen;
  if (cmd.selection) command.selection = cmd.selection;
  if (typeof cmd.zoom === "number" && Number.isFinite(cmd.zoom)) {
    command.zoom = cmd.zoom;
  } else if (editorView === "single") {
    command.zoom = FOCUSED_SCREEN_ZOOM;
  }
  const tool = normalizeDesignTool(cmd.tool);
  if (tool) command.tool = tool;
  return command;
}

export function useNavigationState(enabled = true) {
  const params = useParams();
  const location = useLocation();
  const browserTabId = getBrowserTabId();

  useEffect(() => {
    if (!enabled) return;
    if (location.pathname.startsWith("/design/")) return;
    for (const key of designSelectionCleanupKeysForTab(browserTabId)) {
      setClientAppState(key, null).catch(() => {});
    }
  }, [browserTabId, enabled, location.pathname]);

  useAgentRouteState<NavigationState>({
    browserTabId,
    getNavigationState: ({ pathname, search }) => {
      const state: NavigationState = { view: "list" };
      const searchParams = new URLSearchParams(search);

      if (pathname.startsWith("/design/")) {
        state.view = "editor";
        state.designId = params.id;
        const editorView = normalizeEditorView(searchParams.get("view"));
        if (editorView) state.editorView = editorView;
        const inspectorTab = normalizeInspectorTab(
          searchParams.get("inspector"),
        );
        if (inspectorTab) state.inspectorTab = inspectorTab;
        const leftPanel = normalizeLeftPanel(searchParams.get("panel"));
        if (leftPanel) state.leftPanel = leftPanel;
        const screen = searchParams.get("screen");
        if (screen) state.screen = screen;
        const fileId = searchParams.get("fileId");
        if (fileId) state.fileId = fileId;
        const filename = searchParams.get("filename");
        if (filename) state.filename = filename;
        const selection = searchParams.get("selection");
        if (selection) state.selection = selection;
        const rawZoom = searchParams.get("zoom");
        if (rawZoom !== null) {
          const zoom = Number(rawZoom);
          if (Number.isFinite(zoom)) state.zoom = zoom;
        }
        const tool = normalizeDesignTool(searchParams.get("tool"));
        if (tool) state.tool = tool;
      } else if (pathname.startsWith("/design-systems")) {
        state.view = "design-systems";
        const designSystemId = searchParams.get("designSystemId");
        if (designSystemId) state.designSystemId = designSystemId;
      } else if (pathname.startsWith("/templates")) {
        state.view = "templates";
        const templateId = searchParams.get("templateId");
        if (templateId) state.templateId = templateId;
      } else if (pathname.startsWith("/present/")) {
        state.view = "present";
        state.designId = params.id;
      } else if (pathname.startsWith("/settings")) {
        state.view = "settings";
      }

      return state;
    },
    getCommandPath: (cmd) => {
      const editorPath = editorPathFromCommand(cmd);
      if (editorPath) return editorPath;
      if (cmd.view === "design-systems") {
        return cmd.designSystemId
          ? `/design-systems?designSystemId=${encodeURIComponent(cmd.designSystemId)}`
          : "/design-systems";
      }
      if (cmd.view === "templates") {
        return cmd.templateId
          ? `/templates?templateId=${encodeURIComponent(cmd.templateId)}`
          : "/templates";
      }
      if (cmd.view === "present" && cmd.designId)
        return `/present/${cmd.designId}`;
      if (cmd.view === "settings") return "/settings";
      return "/";
    },
    onNavigate: (cmd, path) => {
      const command = editorCommandFromNavigate(cmd, path);
      if (!command) return;
      const keys = designEditorCommandKeysForTab(browserTabId);
      for (const key of keys) {
        setClientAppState(key, command).catch(() => {});
      }
    },
    enabled,
  });
}
