import { stripInlineBytes } from "@agent-native/core/shared";
import {
  registerAgentSelectable,
  useAgentSelectableSource,
  type AgentSelectable,
} from "@agent-native/toolkit/composer";
import { useEffect } from "react";

import { nodeRepromptSubtreeExcerpt } from "@/lib/node-reprompt";

const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const LAYER_NAME_ATTRIBUTE = "data-agent-native-layer-name";
const TITLE_LIMIT = 28;
const TEXT_LIMIT = 200;

export interface DesignSelectScreen {
  id: string;
  filename: string;
}

function escapeAttribute(value: string): string {
  return CSS.escape(value);
}

function excerpt(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 3)}...`
    : collapsed;
}

function screenTitle(filename: string): string {
  return filename.replace(/\.[^./]+$/, "") || filename;
}

/** The screen's frame on the canvas, or its preview iframe in single view. */
export function designScreenElement(screenId: string): Element | null {
  const id = escapeAttribute(screenId);
  return (
    document.querySelector(`[data-frame-id="${id}"]`) ??
    document.querySelector(`[data-screen-iframe-id="${id}"]`)
  );
}

export function designScreenSelectable(
  designId: string,
  designTitle: string,
  screen: DesignSelectScreen,
): AgentSelectable {
  return {
    kind: "screen",
    id: screen.id,
    title: screenTitle(screen.filename),
    getContext: () =>
      [
        `Selected screen in design "${designTitle}".`,
        `designId: ${designId}`,
        `fileId: ${screen.id}`,
        `Screen: ${screen.filename}`,
      ].join("\n"),
    getElement: () => designScreenElement(screen.id),
  };
}

/**
 * The layer a pointer target inside a screen's iframe belongs to, as a
 * selectable, or null outside a screen document or a layer.
 */
export function designElementSelectable(
  designId: string,
  designTitle: string,
  screens: readonly DesignSelectScreen[],
  target: Element,
): AgentSelectable | null {
  const frame = target.ownerDocument.defaultView?.frameElement;
  if (!frame || frame.ownerDocument === target.ownerDocument) return null;
  const screenId =
    frame.closest("[data-frame-id]")?.getAttribute("data-frame-id") ??
    frame.getAttribute("data-screen-iframe-id");
  const screen = screens.find((candidate) => candidate.id === screenId);
  const element = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
  if (!screen || !element) return null;
  const nodeId = element.getAttribute(NODE_ID_ATTRIBUTE)?.trim();
  if (!nodeId) return null;
  const layerName = element.getAttribute(LAYER_NAME_ATTRIBUTE)?.trim();
  const tag = element.tagName.toLowerCase();
  const text = excerpt(element.textContent ?? "", TEXT_LIMIT);
  const label = excerpt(text || layerName || tag, TITLE_LIMIT);
  return {
    kind: "element",
    id: `${screen.id}/${nodeId}`,
    title: label,
    getContext: () => {
      const outerHtmlExcerpt = stripInlineBytes(
        nodeRepromptSubtreeExcerpt(element.outerHTML),
        "placeholder",
      );
      return [
        `Selected design element in design "${designTitle}".`,
        `designId: ${designId}`,
        `fileId: ${screen.id}`,
        `Active screen: ${screen.filename}`,
        `target: ${nodeId}`,
        `targetNodeId: ${nodeId}`,
        `Element: <${tag}> ${label}`,
        layerName ? `Layer: ${layerName}` : "",
        text ? `Text: ${text}` : "",
        outerHtmlExcerpt
          ? `--- selected element (outerHTML excerpt, truncated) ---\n${outerHtmlExcerpt}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
    getElement: () => (element.isConnected ? element : null),
  };
}

/** Offer the design's screens and their layers to the composer's Select mode. */
export function useDesignAgentSelect(
  designId: string | undefined,
  designTitle: string | undefined,
  screens: readonly DesignSelectScreen[],
): void {
  const title = designTitle?.trim() || designId || "";
  const screenKey = screens
    .map((screen) => `${screen.id}\u0000${screen.filename}`)
    .join("\n");

  useEffect(() => {
    if (!designId || !screenKey) return;
    const unregister = screenKey.split("\n").map((entry) => {
      const [id, filename] = entry.split("\u0000");
      return registerAgentSelectable(
        designScreenSelectable(designId, title, { id, filename }),
      );
    });
    return () => unregister.forEach((release) => release());
  }, [designId, screenKey, title]);

  useAgentSelectableSource(
    designId && screens.length > 0
      ? (target) => designElementSelectable(designId, title, screens, target)
      : null,
  );
}
