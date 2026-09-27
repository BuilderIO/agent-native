export const ACTION_CHAT_UI_DATA_TABLE_RENDERER = "core.data-table";
export const ACTION_CHAT_UI_DATA_CHART_RENDERER = "core.data-chart";
export const ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER = "core.data-insights";
export const ACTION_CHAT_UI_DATA_WIDGET_RENDERER = "core.data-widget";
export const ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER = "core.inline-extension";
export const ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER = "core.workspace-file";

export interface ActionChatUIConfig {
  renderer: string;
  title?: string;
  description?: string;
  /** Show this renderer only for matching successful action calls. */
  when?: (args: Record<string, unknown>, result: unknown) => boolean;
  /** Return the small result needed by the renderer and interrupted-run recovery. */
  projectResult?: (args: Record<string, unknown>, result: unknown) => unknown;
}

export function normalizeActionChatUIConfig(
  value: unknown,
): ActionChatUIConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.renderer !== "string" || !record.renderer.trim()) {
    return undefined;
  }
  return {
    renderer: record.renderer.trim(),
    ...(typeof record.title === "string" && record.title.trim()
      ? { title: record.title }
      : {}),
    ...(typeof record.description === "string" && record.description.trim()
      ? { description: record.description }
      : {}),
    ...(typeof record.when === "function"
      ? { when: record.when as ActionChatUIConfig["when"] }
      : {}),
    ...(typeof record.projectResult === "function"
      ? {
          projectResult:
            record.projectResult as ActionChatUIConfig["projectResult"],
        }
      : {}),
  };
}
