export const ACTION_CHAT_UI_DATA_TABLE_RENDERER = "core.data-table";
export const ACTION_CHAT_UI_DATA_CHART_RENDERER = "core.data-chart";
export const ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER = "core.data-insights";
export const ACTION_CHAT_UI_DATA_WIDGET_RENDERER = "core.data-widget";
export const ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER = "core.inline-extension";

export interface ActionChatUIConfig {
  /**
   * Exact renderer id to use in Agent-Native chat. This is native first-party
   * React UI, distinct from MCP Apps resources for external hosts.
   */
  renderer: string;
  /** Optional label for catalogs, docs, or custom renderer chrome. */
  title?: string;
  /** Optional developer-facing description for catalogs/docs. */
  description?: string;
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
  };
}
