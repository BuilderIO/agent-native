import { parseCssColorExtended } from "@shared/color-utils";

export const BOARD_TEXT_AUTO_COLOR_MARKER = "data-an-auto-text-color";

const AUTO_TEXT_COLOR_LIGHT_LUMINANCE_THRESHOLD = 150;

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

export function isStaleAutoTextColorMarker(params: {
  inlineColor: string | null | undefined;
  hasAutoMarker: boolean;
}): boolean {
  return params.hasAutoMarker && !isAutoDefaultWhiteColor(params.inlineColor);
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
  if (hasAutoMarker && isDefaultWhite) return true;
  if (!isDefaultWhite) return false;
  return destinationBackgroundIsLight;
}

export function resolveDestinationBackgroundLightnessOrNull(
  chain: ReadonlyArray<{ color: string | null } | { darkClassHint: boolean }>,
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
  }
  return null;
}

export function resolveDestinationBackgroundLightness(
  chain: ReadonlyArray<{ color: string | null } | { darkClassHint: boolean }>,
): boolean {
  return resolveDestinationBackgroundLightnessOrNull(chain) ?? true;
}

const DARK_BACKGROUND_CLASS_RE =
  /(?:^|:)bg-(?:black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:800|900|950))\b/;

function elementHasDarkBackgroundClassHint(element: Element): boolean {
  const className =
    typeof element.className === "string"
      ? element.className
      : (element.getAttribute("class") ?? "");
  return DARK_BACKGROUND_CLASS_RE.test(className);
}

function collectDestinationBackgroundSignals(
  element: Element,
  liveElement: Element | null,
): Array<{ color: string | null } | { darkClassHint: boolean }> {
  const chain: Array<{ color: string | null } | { darkClassHint: boolean }> =
    [];
  if (liveElement) {
    const liveView = liveElement.ownerDocument?.defaultView;
    let cursor: Element | null = liveElement;
    while (
      liveView &&
      cursor &&
      cursor !== liveElement.ownerDocument.documentElement
    ) {
      chain.push({ color: liveView.getComputedStyle(cursor).backgroundColor });
      cursor = cursor.parentElement;
    }
    return chain;
  }
  let cursor: Element | null = element;
  while (cursor && cursor !== element.ownerDocument.documentElement) {
    const inline = (cursor as HTMLElement).style;
    const inlineColor = inline?.backgroundColor || inline?.background || null;
    if (inlineColor) {
      chain.push({ color: inlineColor });
    } else {
      chain.push({ darkClassHint: elementHasDarkBackgroundClassHint(cursor) });
    }
    cursor = cursor.parentElement;
  }
  return chain;
}

export function destinationBackgroundLightness(
  element: Element,
  liveDoc?: Document | null,
): boolean | null {
  try {
    const liveElement =
      liveDoc && element.hasAttribute("data-agent-native-node-id")
        ? liveDoc.querySelector(
            `[data-agent-native-node-id="${CSS.escape(
              element.getAttribute("data-agent-native-node-id") ?? "",
            )}"]`,
          )
        : null;
    const chain = collectDestinationBackgroundSignals(element, liveElement);
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
    if (kind !== "text") return content;
    const el = moved as HTMLElement;
    const hasAutoMarker = moved.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER);
    let markerStripped = false;
    if (
      isStaleAutoTextColorMarker({
        inlineColor: el.style.color,
        hasAutoMarker,
      })
    ) {
      moved.removeAttribute(BOARD_TEXT_AUTO_COLOR_MARKER);
      markerStripped = true;
    }
    const shouldAdapt = shouldAdaptAutoTextColorForCrossScreenMove({
      inlineColor: el.style.color,
      hasAutoMarker: hasAutoMarker && !markerStripped,
      destinationBackgroundIsLight: destinationBackgroundIsLightForNode(
        moved,
        liveDestDoc,
      ),
    });
    if (!shouldAdapt && !markerStripped) return content;
    if (shouldAdapt) el.style.color = "inherit";
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
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
