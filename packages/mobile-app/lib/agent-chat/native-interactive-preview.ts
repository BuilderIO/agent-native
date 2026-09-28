import {
  ACTION_CHAT_UI_DATA_CHART_RENDERER,
  ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
} from "@agent-native/core/action-ui";
import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  normalizeDataWidgetResult,
  type DataWidgetResult,
} from "@agent-native/core/data-widgets";

type RecordValue = Record<string, unknown>;

export type NativeInteractivePreview =
  | { kind: "data"; title?: string; result: DataWidgetResult }
  | { kind: "text"; title?: string; description?: string; text: string[] }
  | { kind: "fallback"; title?: string };

function recordValue(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseResult(part: { resultText?: string }): unknown {
  if (!part.resultText) return undefined;
  try {
    return JSON.parse(part.resultText) as unknown;
  } catch {
    return part.resultText.trim().startsWith("<") ? undefined : part.resultText;
  }
}

function dataWidgetResult(
  renderer: unknown,
  value: unknown,
): DataWidgetResult | null {
  const result = recordValue(value);
  if (!result) return null;

  if (renderer === ACTION_CHAT_UI_DATA_TABLE_RENDERER) {
    return normalizeDataWidgetResult({
      ...result,
      widget: DATA_TABLE_WIDGET,
      table: recordValue(result.table) ?? result,
    });
  }
  if (renderer === ACTION_CHAT_UI_DATA_CHART_RENDERER) {
    return normalizeDataWidgetResult({
      ...result,
      widget: DATA_CHART_WIDGET,
      chartSeries: recordValue(result.chartSeries) ?? result,
    });
  }
  if (renderer === ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER) {
    return normalizeDataWidgetResult({
      ...result,
      widget: DATA_INSIGHTS_WIDGET,
    });
  }
  if (renderer === ACTION_CHAT_UI_DATA_WIDGET_RENDERER) {
    return normalizeDataWidgetResult(result);
  }
  return null;
}

function safeText(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text || /^\s*(?:<!doctype\b|<[a-z][^>]*>)/i.test(text)) {
    return undefined;
  }
  return text.slice(0, 2400);
}

function scalarSummary(value: unknown): string[] {
  const record = recordValue(value);
  if (!record) {
    const text = safeText(value);
    return text ? [text] : [];
  }

  const preferred = ["summary", "message", "description", "text"];
  const values = preferred
    .map((key) => safeText(record[key]))
    .filter((item): item is string => Boolean(item));
  if (values.length) return [...new Set(values)].slice(0, 6);

  const nestedDetails = [record.inlineExtension, record.extension]
    .map((nested) => {
      const nestedRecord = recordValue(nested);
      if (!nestedRecord) return [];
      return [
        safeText(nestedRecord.name),
        safeText(nestedRecord.description),
      ].filter((item): item is string => Boolean(item));
    })
    .flat();
  if (nestedDetails.length) return [...new Set(nestedDetails)].slice(0, 6);

  return Object.entries(record)
    .filter(
      ([key, item]) =>
        !/(?:html|blob|url|uri|content|resource|data|input|schema)/i.test(
          key,
        ) &&
        (typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"),
    )
    .map(([key, item]) => `${key}: ${String(item)}`.slice(0, 2400))
    .slice(0, 6);
}

function mcpResultText(value: unknown): string[] {
  const result = recordValue(value);
  if (!result) return scalarSummary(value);

  const content = Array.isArray(result.content) ? result.content : [];
  const contentText = content
    .map((part) => {
      const item = recordValue(part);
      return item?.type === "text" ? safeText(item.text) : undefined;
    })
    .filter((item): item is string => Boolean(item));
  if (contentText.length) return contentText.slice(0, 6);

  return scalarSummary(result.structuredContent ?? result);
}

/** Builds a native-safe preview from structured output; never interprets app HTML. */
export function getNativeInteractivePreview(part: {
  resultText?: string;
  mcpApp?: unknown;
  chatUI?: unknown;
}): NativeInteractivePreview {
  const chatUI = recordValue(part.chatUI);
  const app = recordValue(part.mcpApp);
  const appTool = recordValue(app?.tool);
  const resource = recordValue(app?.resource);
  const resourceMeta = recordValue(resource?._meta);
  const resourceUi = recordValue(resourceMeta?.ui);
  const result = parseResult(part);
  const title =
    stringValue(chatUI?.title) ??
    stringValue(appTool?.title) ??
    stringValue(resource?.title) ??
    stringValue(resourceUi?.title);

  if (chatUI?.renderer) {
    const widget = dataWidgetResult(chatUI.renderer, result);
    if (widget) {
      return {
        kind: "data",
        title:
          stringValue(widget.display?.title) ??
          stringValue(widget.title) ??
          stringValue(widget.table?.title) ??
          stringValue(widget.chartSeries?.title) ??
          title,
        result: widget,
      };
    }
  }

  if (app) {
    const text = mcpResultText(app.toolResult);
    return text.length
      ? { kind: "text", title, text }
      : { kind: "fallback", title };
  }

  const text = scalarSummary(result);
  const description = stringValue(chatUI?.description);
  return text.length
    ? { kind: "text", title, description, text }
    : { kind: "fallback", title };
}
