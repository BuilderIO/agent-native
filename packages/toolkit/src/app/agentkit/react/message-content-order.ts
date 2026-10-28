import type {
  AgentEvent,
  AgentMessage,
  AgentMessagePart,
  AgentWidget,
} from "@agent-native/agentkit/protocol";

export type AgentMessageContentItem =
  | { key: string; type: "part"; part: AgentMessagePart }
  | { key: string; type: "widget"; widget: AgentWidget };

export interface AgentMessageContentOrderInput {
  message: AgentMessage;
  parts: AgentMessagePart[];
  widgets: AgentWidget[];
  events: AgentEvent[];
  defaultOrder: AgentMessageContentItem[];
}

export type AgentMessageContentOrderResolver = (
  input: AgentMessageContentOrderInput,
) => AgentMessageContentItem[];

type TextContentOrderItem = Extract<
  AgentMessageContentItem,
  { type: "part" }
> & {
  part: Extract<AgentMessagePart, { type: "text" }>;
};

function isTextContentOrderItem(
  item: AgentMessageContentItem | null | undefined,
): item is TextContentOrderItem {
  return (
    item?.type === "part" &&
    typeof item.key === "string" &&
    item.part?.type === "text" &&
    typeof item.part.text === "string"
  );
}

function resolvedItemsPreserveContent(
  defaultOrder: AgentMessageContentItem[],
  resolvedOrder: AgentMessageContentItem[],
): AgentMessageContentItem[] | undefined {
  if (!Array.isArray(resolvedOrder)) return undefined;

  const defaultText = defaultOrder
    .filter(isTextContentOrderItem)
    .map((item) => item.part.text)
    .join("");
  const resolvedText = resolvedOrder
    .filter(isTextContentOrderItem)
    .map((item) => item.part.text)
    .join("");
  if (defaultText !== resolvedText) return undefined;

  const expectedItems = new Map<string, AgentMessageContentItem[]>();
  for (const item of defaultOrder) {
    if (item.type === "part" && item.part.type === "text") continue;
    const identity = `${item.type}:${item.key}`;
    const matchingItems = expectedItems.get(identity) ?? [];
    matchingItems.push(item);
    expectedItems.set(identity, matchingItems);
  }

  const preservedItems: AgentMessageContentItem[] = [];
  for (const item of resolvedOrder) {
    if (!item || typeof item !== "object") return undefined;
    if (item.type === "part" && item.part?.type === "text") {
      if (typeof item.key !== "string" || typeof item.part.text !== "string") {
        return undefined;
      }
      preservedItems.push(item);
      continue;
    }

    if (
      (item.type !== "part" && item.type !== "widget") ||
      typeof item.key !== "string"
    ) {
      return undefined;
    }

    const identity = `${item.type}:${item.key}`;
    const matchingItems = expectedItems.get(identity);
    const original = matchingItems?.shift();
    if (!original) return undefined;
    preservedItems.push(original);
  }

  if (
    [...expectedItems.values()].some((matchingItems) => matchingItems.length)
  ) {
    return undefined;
  }
  return preservedItems;
}

/** Uses the stream timeline only when it reconstructs the saved text exactly. */
export function orderMessageContent(
  message: AgentMessage,
  visibleParts: AgentMessagePart[],
  attachedWidgets: AgentWidget[],
  events: AgentEvent[],
  resolveOrder?: AgentMessageContentOrderResolver,
): AgentMessageContentItem[] {
  // The leading text keeps the key the interleaved path gives it, so a widget
  // arriving mid-stream splits the reply without remounting its first segment.
  const fallback = [
    ...visibleParts.map((part, index) => ({
      key:
        index === 0 && part.type === "text"
          ? `${message.id}-text-0`
          : `${message.id}-${index}`,
      type: "part" as const,
      part,
    })),
    ...attachedWidgets.map((widget) => ({
      key: widget.id,
      type: "widget" as const,
      widget,
    })),
  ];
  const resolve = (defaultOrder: AgentMessageContentItem[]) => {
    const resolvedOrder = resolveOrder?.({
      message,
      parts: visibleParts,
      widgets: attachedWidgets,
      events,
      defaultOrder,
    });
    if (resolvedOrder == null) return defaultOrder;
    return (
      resolvedItemsPreserveContent(defaultOrder, resolvedOrder) ?? defaultOrder
    );
  };

  if (
    attachedWidgets.length === 0 ||
    message.parts.length !== 1 ||
    message.parts[0]?.type !== "text" ||
    visibleParts.length !== 1 ||
    visibleParts[0]?.type !== "text" ||
    visibleParts[0].text !== message.parts[0].text
  ) {
    return resolve(fallback);
  }

  const widgetIds = new Set(attachedWidgets.map((widget) => widget.id));
  const widgetOffsets = new Map<string, number>();
  const widgetEventOrder = new Map<string, number>();
  let reconstructedText = "";
  let textOffset = 0;

  for (const [eventIndex, event] of events.entries()) {
    if (event.type === "message.created" && event.message.id === message.id) {
      const createdParts = event.message.parts;
      if (
        createdParts.length > 1 ||
        createdParts.some((part) => part.type !== "text")
      ) {
        return resolve(fallback);
      }
      reconstructedText =
        createdParts[0]?.type === "text" ? createdParts[0].text : "";
      textOffset = reconstructedText.length;
      continue;
    }

    if (event.type === "message.delta" && event.messageId === message.id) {
      reconstructedText += event.text;
      textOffset += event.text.length;
      continue;
    }

    if (
      (event.type === "widget.created" || event.type === "widget.updated") &&
      event.messageId === message.id &&
      widgetIds.has(event.widget.id) &&
      !widgetOffsets.has(event.widget.id)
    ) {
      widgetOffsets.set(event.widget.id, textOffset);
      widgetEventOrder.set(event.widget.id, eventIndex);
    }
  }

  const fullText = message.parts[0].text;
  if (
    reconstructedText !== fullText ||
    widgetOffsets.size !== attachedWidgets.length ||
    [...widgetOffsets.values()].some((offset) => {
      if (offset === 0 || offset === fullText.length) return false;
      const preceding = fullText.charCodeAt(offset - 1);
      const following = fullText.charCodeAt(offset);
      return (
        preceding >= 0xd800 &&
        preceding <= 0xdbff &&
        following >= 0xdc00 &&
        following <= 0xdfff
      );
    })
  ) {
    return resolve(fallback);
  }

  const widgetsAtOffset = new Map<number, AgentWidget[]>();
  for (const widget of attachedWidgets) {
    const offset = widgetOffsets.get(widget.id)!;
    const widgets = widgetsAtOffset.get(offset) ?? [];
    widgets.push(widget);
    widgetsAtOffset.set(offset, widgets);
  }
  for (const widgets of widgetsAtOffset.values()) {
    widgets.sort(
      (first, second) =>
        widgetEventOrder.get(first.id)! - widgetEventOrder.get(second.id)!,
    );
  }

  const insertions = [...widgetsAtOffset.entries()].sort(
    ([first], [second]) => first - second,
  );
  const part = visibleParts[0];
  if (part.type !== "text") return resolve(fallback);

  const ordered: AgentMessageContentItem[] = [];
  let cursor = 0;
  for (const [offset, widgets] of insertions) {
    if (offset > cursor) {
      ordered.push({
        key: `${message.id}-text-${cursor}`,
        type: "part",
        part: { ...part, text: part.text.slice(cursor, offset) },
      });
    }
    for (const widget of widgets) {
      ordered.push({ key: widget.id, type: "widget", widget });
    }
    cursor = offset;
  }
  if (cursor < part.text.length) {
    ordered.push({
      key: `${message.id}-text-${cursor}`,
      type: "part",
      part: { ...part, text: part.text.slice(cursor) },
    });
  }

  return resolve(ordered);
}
