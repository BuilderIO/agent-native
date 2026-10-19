import { parseCssColorExtended } from "@shared/color-utils";

export const BOARD_TEXT_AUTO_COLOR_MARKER = "data-an-auto-text-color";

const AUTO_TEXT_COLOR_LIGHT_LUMINANCE_THRESHOLD = 150;
const MIN_OPACITY_FOR_BACKGROUND_CLASS_HINT = 0.8;

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

function isAutoDefaultWhiteColor(
  inlineColor: string | null | undefined,
): boolean {
  const normalized = (inlineColor || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return (
    normalized === "#ffffff" ||
    normalized === "#fff" ||
    normalized === "rgb(255,255,255)" ||
    normalized === "rgb(255, 255, 255)" ||
    normalized === "white"
  );
}

function isAutoDefaultBlackColor(
  inlineColor: string | null | undefined,
): boolean {
  const rgba = parseCssColorExtended((inlineColor || "").trim());
  return (
    rgba !== null &&
    rgba.a === 1 &&
    rgba.r === 0 &&
    rgba.g === 0 &&
    rgba.b === 0
  );
}

function isAutoDefaultTextColor(
  inlineColor: string | null | undefined,
): boolean {
  return (
    isAutoDefaultWhiteColor(inlineColor) || isAutoDefaultBlackColor(inlineColor)
  );
}

export function isStaleAutoTextColorMarker(params: {
  inlineColor: string | null | undefined;
  hasAutoMarker: boolean;
}): boolean {
  return params.hasAutoMarker && !isAutoDefaultTextColor(params.inlineColor);
}

export function shouldAdaptAutoTextColorForCrossScreenMove(params: {
  inlineColor: string | null | undefined;
  hasAutoMarker: boolean;
  destinationBackgroundIsLight: boolean;
}): boolean {
  const { inlineColor, hasAutoMarker, destinationBackgroundIsLight } = params;
  const normalized = (inlineColor || "").trim().toLowerCase();
  if (
    !normalized ||
    normalized === "inherit" ||
    normalized === "currentcolor"
  ) {
    return false;
  }
  const isDefaultWhite = isAutoDefaultWhiteColor(inlineColor);
  if (hasAutoMarker && isAutoDefaultTextColor(inlineColor)) return true;
  if (!isDefaultWhite) return false;
  return destinationBackgroundIsLight;
}

export function resolveDestinationBackgroundLightnessOrNull(
  chain: ReadonlyArray<
    | { color: string | null }
    | { darkClassHint: boolean }
    | { lightClassHint: boolean }
  >,
): boolean | null {
  for (const entry of chain) {
    if ("color" in entry && entry.color) {
      const rgba = parseCssColorExtended(entry.color);
      if (rgba && rgba.a >= 0.4) {
        return (
          relativeLuminance(rgba) > AUTO_TEXT_COLOR_LIGHT_LUMINANCE_THRESHOLD
        );
      }
      continue;
    }
    if ("darkClassHint" in entry && entry.darkClassHint) {
      return false;
    }
    if ("lightClassHint" in entry && entry.lightClassHint) {
      return true;
    }
  }
  return null;
}

export function resolveDestinationBackgroundLightness(
  chain: ReadonlyArray<
    | { color: string | null }
    | { darkClassHint: boolean }
    | { lightClassHint: boolean }
  >,
): boolean {
  return resolveDestinationBackgroundLightnessOrNull(chain) ?? true;
}

const DARK_BACKGROUND_CLASS_RE =
  /(?:^|[\s:])!?bg-(?:black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:800|900|950))(?:\/(?:\[([0-9]*\.?[0-9]+%?)\]|(\d{1,3})%?))?!?(?=$|[\s:])/g;
const LIGHT_BACKGROUND_CLASS_RE =
  /(?:^|[\s:])!?bg-(?:white|(?:slate|gray|zinc|neutral|stone)-(?:50|100|200|300|400))(?:\/(?:\[([0-9]*\.?[0-9]+%?)\]|(\d{1,3})%?))?!?(?=$|[\s:])/g;

function hasSufficientlyOpaqueBackgroundClassHint(
  className: string,
  pattern: RegExp,
): boolean {
  for (const match of className.matchAll(pattern)) {
    const arbitraryOpacity = match[1];
    const numericOpacity = match[2];
    const opacity =
      arbitraryOpacity === undefined
        ? numericOpacity === undefined
          ? 1
          : Number(numericOpacity) / 100
        : arbitraryOpacity.endsWith("%")
          ? Number(arbitraryOpacity.slice(0, -1)) / 100
          : Number(arbitraryOpacity);
    if (opacity >= MIN_OPACITY_FOR_BACKGROUND_CLASS_HINT && opacity <= 1) {
      return true;
    }
  }
  return false;
}

function elementBackgroundClassHint(element: Element): "dark" | "light" | null {
  const className =
    typeof element.className === "string"
      ? element.className
      : (element.getAttribute("class") ?? "");
  const dark = hasSufficientlyOpaqueBackgroundClassHint(
    className,
    DARK_BACKGROUND_CLASS_RE,
  );
  const light = hasSufficientlyOpaqueBackgroundClassHint(
    className,
    LIGHT_BACKGROUND_CLASS_RE,
  );
  if (dark === light) return null;
  return dark ? "dark" : "light";
}

function collectDestinationBackgroundSignals(
  element: Element,
  liveElement: Element | null,
  liveConstructedElement: Element | null,
): Array<
  | { color: string | null }
  | { darkClassHint: boolean }
  | { lightClassHint: boolean }
> {
  const chain: Array<
    | { color: string | null }
    | { darkClassHint: boolean }
    | { lightClassHint: boolean }
  > = [];
  let cursor: Element | null = element;
  while (
    cursor &&
    cursor !== element.ownerDocument.documentElement &&
    cursor !== liveConstructedElement
  ) {
    const inline = (cursor as HTMLElement).style;
    const inlineColor = inline?.backgroundColor || inline?.background || null;
    if (inlineColor) chain.push({ color: inlineColor });
    else {
      const classHint = elementBackgroundClassHint(cursor);
      if (classHint === "dark") chain.push({ darkClassHint: true });
      if (classHint === "light") chain.push({ lightClassHint: true });
    }
    cursor = cursor.parentElement;
  }
  if (liveElement) {
    const liveView = liveElement.ownerDocument?.defaultView;
    cursor = liveElement;
    while (cursor && cursor !== liveElement.ownerDocument.documentElement) {
      const inline = (cursor as HTMLElement).style;
      const inlineColor = inline?.backgroundColor || inline?.background || null;
      const computedColor = liveView
        ? liveView.getComputedStyle(cursor).backgroundColor
        : null;
      const observedColor = computedColor || inlineColor;
      if (observedColor) chain.push({ color: observedColor });
      else {
        const classHint = elementBackgroundClassHint(cursor);
        if (classHint === "dark") chain.push({ darkClassHint: true });
        if (classHint === "light") chain.push({ lightClassHint: true });
      }
      cursor = cursor.parentElement;
    }
    return chain;
  }
  return chain;
}

export function destinationBackgroundLightness(
  element: Element,
  liveDoc?: Document | null,
): boolean | null {
  try {
    let constructedMatch: Element | null = null;
    let liveElement: Element | null = null;
    let cursor: Element | null = element;
    while (
      liveDoc &&
      cursor &&
      cursor !== element.ownerDocument.documentElement
    ) {
      const nodeId = cursor.getAttribute("data-agent-native-node-id");
      if (nodeId) {
        const candidate = liveDoc.querySelector(
          `[data-agent-native-node-id="${CSS.escape(nodeId)}"]`,
        );
        if (candidate) {
          constructedMatch = cursor;
          liveElement = candidate;
          break;
        }
      }
      cursor = cursor.parentElement;
    }
    const chain = collectDestinationBackgroundSignals(
      element,
      liveElement ?? liveDoc?.body ?? null,
      constructedMatch,
    );
    return resolveDestinationBackgroundLightnessOrNull(chain);
  } catch {
    // coercion-ok: null is the typed "unreadable" value callers branch on
    return null;
  }
}

export function destinationBackgroundIsLightForNode(
  element: Element,
  liveDoc?: Document | null,
): boolean {
  return destinationBackgroundLightness(element, liveDoc) ?? true;
}

export function adaptAutoTextColorForCrossScreenNode(
  content: string,
  destNodeAttrId: string,
  liveDestDoc?: Document | null,
): string {
  if (typeof window === "undefined" || !destNodeAttrId) return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const moved = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(destNodeAttrId)}"]`,
    );
    if (!moved) return content;
    const kind = (
      moved.getAttribute("data-an-primitive") ||
      moved.getAttribute("data-agent-native-primitive") ||
      ""
    ).toLowerCase();
    const textNodes = new Set<Element>();
    if (kind === "text") textNodes.add(moved);
    for (const descendant of Array.from(moved.querySelectorAll("*"))) {
      const descendantKind = (
        descendant.getAttribute("data-an-primitive") ||
        descendant.getAttribute("data-agent-native-primitive") ||
        ""
      ).toLowerCase();
      if (
        descendantKind === "text" &&
        descendant.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER)
      ) {
        textNodes.add(descendant);
      }
    }
    if (textNodes.size === 0) return content;

    let changed = false;
    for (const textNode of textNodes) {
      const el = textNode as HTMLElement;
      const hasAutoMarker = textNode.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER);
      const markerStripped = isStaleAutoTextColorMarker({
        inlineColor: el.style.color,
        hasAutoMarker,
      });
      if (markerStripped) {
        textNode.removeAttribute(BOARD_TEXT_AUTO_COLOR_MARKER);
        changed = true;
      }
      const destinationIsLight = destinationBackgroundIsLightForNode(
        textNode,
        liveDestDoc,
      );
      const shouldAdapt = shouldAdaptAutoTextColorForCrossScreenMove({
        inlineColor: el.style.color,
        hasAutoMarker: hasAutoMarker && !markerStripped,
        destinationBackgroundIsLight: destinationIsLight,
      });
      if (!shouldAdapt) continue;
      // guard:allow-raw-color — This is authored document text, not editor chrome.
      el.style.color = destinationIsLight ? "#000000" : "#ffffff";
      changed = true;
    }
    if (!changed) return content;
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

export function adaptAutoTextColorsForCrossScreenNodes(
  content: string,
  destNodeAttrIds: readonly string[],
  liveDestDoc?: Document | null,
): string {
  return destNodeAttrIds.reduce(
    (adapted, nodeId) =>
      adaptAutoTextColorForCrossScreenNode(adapted, nodeId, liveDestDoc),
    content,
  );
}

export function clearAutoTextColorMarkerOnExplicitColorCommit(
  content: string,
  nodeId: string | null | undefined,
): string {
  if (typeof window === "undefined" || !nodeId) return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const node = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeId)}"]`,
    );
    if (!node || !node.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER)) {
      return content;
    }
    node.removeAttribute(BOARD_TEXT_AUTO_COLOR_MARKER);
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}
