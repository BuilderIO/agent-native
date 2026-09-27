export const ACTION_CHAT_UI_DATA_TABLE_RENDERER = "core.data-table";
export const ACTION_CHAT_UI_DATA_CHART_RENDERER = "core.data-chart";
export const ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER = "core.data-insights";
export const ACTION_CHAT_UI_DATA_WIDGET_RENDERER = "core.data-widget";
export const ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER = "core.inline-extension";
export const ACTION_CHAT_UI_RECORD_CHANGE_RENDERER = "core.record-change";
export const ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER = "core.workspace-file";

export const ACTION_CHANGE_VERBS = [
  "created",
  "updated",
  "deleted",
  "sent",
  "scheduled",
  "enabled",
  "disabled",
] as const;

export type ActionChangeVerb = (typeof ACTION_CHANGE_VERBS)[number];

export interface ActionChangeUndo {
  action: string;
  args: Record<string, unknown>;
}

export interface ActionChange {
  verb: ActionChangeVerb;
  kind: string;
  title: string;
  titleIsFallback?: boolean;
  detail?: string;
  url?: string;
  undo?: ActionChangeUndo;
}

export interface ActionChangeResult {
  change: ActionChange;
}

export interface ActionChatUIConfig {
  renderer: string;
  title?: string;
  description?: string;
  /** Show this renderer only for matching successful action calls. */
  when?: (args: Record<string, unknown>, result: unknown) => boolean;
  /** Return the small result needed by the renderer and interrupted-run recovery. */
  projectResult?: (args: Record<string, unknown>, result: unknown) => unknown;
}

export function normalizeActionChangeResult(
  value: unknown,
): ActionChangeResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const change = (value as Record<string, unknown>).change;
  if (!change || typeof change !== "object" || Array.isArray(change)) {
    return null;
  }

  const record = change as Record<string, unknown>;
  if (
    typeof record.verb !== "string" ||
    !ACTION_CHANGE_VERBS.includes(record.verb as ActionChangeVerb) ||
    typeof record.kind !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(record.kind) ||
    typeof record.title !== "string" ||
    !record.title.trim() ||
    record.title.length > 180 ||
    (record.titleIsFallback !== undefined &&
      typeof record.titleIsFallback !== "boolean")
  ) {
    return null;
  }

  if (
    (record.detail !== undefined && typeof record.detail !== "string") ||
    (typeof record.detail === "string" && record.detail.length > 500) ||
    (record.url !== undefined && typeof record.url !== "string")
  ) {
    return null;
  }

  let undo: ActionChangeUndo | undefined;
  if (record.undo !== undefined) {
    if (
      !record.undo ||
      typeof record.undo !== "object" ||
      Array.isArray(record.undo)
    ) {
      return null;
    }
    const candidate = record.undo as Record<string, unknown>;
    if (
      typeof candidate.action !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(candidate.action) ||
      !candidate.args ||
      typeof candidate.args !== "object" ||
      Array.isArray(candidate.args)
    ) {
      return null;
    }
    undo = {
      action: candidate.action,
      args: candidate.args as Record<string, unknown>,
    };
  }

  return {
    change: {
      verb: record.verb as ActionChangeVerb,
      kind: record.kind.trim(),
      title: record.title.trim(),
      ...(record.titleIsFallback === true ? { titleIsFallback: true } : {}),
      ...(typeof record.detail === "string" && record.detail.trim()
        ? { detail: record.detail.trim() }
        : {}),
      ...(typeof record.url === "string" && record.url.trim()
        ? { url: record.url.trim() }
        : {}),
      ...(undo ? { undo } : {}),
    },
  };
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
