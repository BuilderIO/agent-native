import { parseCssColorExtended } from "@shared/color-utils";

export const BOARD_TEXT_AUTO_COLOR_MARKER = "data-an-auto-text-color";

// Relative luminance threshold mirroring containerBackgroundIsLight in
// editor-chrome.bridge.ts (keep both in sync) — used by the pure decision
// helper below so its threshold can't drift from the in-screen bridge path.
const AUTO_TEXT_COLOR_LIGHT_LUMINANCE_THRESHOLD = 150;

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

// Tolerant "is this the board's auto-applied default white" check, shared
// by shouldAdaptAutoTextColorForCrossScreenMove and
// isStaleAutoTextColorMarker (finding 2) — both need the exact same
// definition of "still the auto-default", just applied to different
// questions (safe to adapt vs. safe to keep trusting the marker).
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

/**
 * Finding 2(a): BOARD_TEXT_AUTO_COLOR_MARKER is stamped once at board-text
 * creation time and never removed by the bridge, so it goes stale the
 * moment a user explicitly recolors previously-auto-white text (e.g. picks
 * a brand color) without the marker being cleared in the same edit. Trusting
 * a stale marker unconditionally (the previous behavior) forced that
 * deliberately-chosen color back to `inherit` on the next reparent/
 * cross-screen move. A marker is only trustworthy evidence of "this color is
 * still auto-applied" when the node's CURRENT inline color is still exactly
 * the auto-default white — any other color means the user (or some other
 * edit) changed it after the marker was stamped, so the marker is stale and
 * must not be honored (callers should also strip it — see
 * stripStaleAutoTextColorMarkerFromHtml below).
 */
export function isStaleAutoTextColorMarker(params: {
  inlineColor: string | null | undefined;
  hasAutoMarker: boolean;
}): boolean {
  return params.hasAutoMarker && !isAutoDefaultWhiteColor(params.inlineColor);
}

/**
 * Pure decision: should a moved text node's auto-applied board color be
 * rewritten to `inherit` once it lands in its cross-screen destination?
 *
 * Mirrors adaptAutoTextColorForNest's decision in editor-chrome.bridge.ts
 * (keep both in sync), adapted to the host's HTML-string world instead of a
 * live DOM re-parent check — the cross-screen drop path
 * (handleCrossScreenElementDrop) always represents an actual re-parent (the
 * node moves from one document's body into another), so there is no
 * same-parent short-circuit to mirror here.
 *
 * - `hasAutoMarker` AND the color is still the auto-default white: always
 *   safe to adapt regardless of the destination background — the color is
 *   definitely still auto-applied, not user-set (finding 2: a marker whose
 *   color has since diverged from white is STALE and must not short-circuit
 *   here — falls through to the same conservative heuristic as no marker).
 * - No marker (pre-marker content, a node the stamp missed, or a stale
 *   marker whose color moved off white): fall back to the conservative
 *   default-white + light-destination heuristic so a deliberately-chosen
 *   color is never touched.
 */
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

/**
 * Pure decision for finding 1: given an ordered chain of background signals
 * read from an element's ancestor chain (innermost first — same walk order
 * `collectDestinationBackgroundSignals` below produces), decide whether the
 * destination background is light.
 *
 * Each entry is either a CSS color string (from an inline `background`/
 * `background-color` declaration, or a live `getComputedStyle().
 * backgroundColor` read when a live document is available — see call site)
 * or a `{ darkClassHint: true }` marker for a cheap utility-class signal
 * (e.g. `bg-black`, `bg-gray-900`, `dark:bg-*`) when no inline/computed
 * color was found on that same element. The first entry that resolves to a
 * non-transparent (alpha >= 0.4) color wins; alpha below that threshold is
 * treated as transparent so the walk keeps climbing instead of trusting a
 * near-invisible tint. A dark-class hint only counts when no color signal
 * was present on that element (a real color always wins over a guessed
 * class). No signal anywhere in the chain conservatively reports "light" so
 * the default-white heuristic can still fire and prevent invisible text.
 */
export function resolveDestinationBackgroundLightness(
  chain: ReadonlyArray<{ color: string | null } | { darkClassHint: boolean }>,
): boolean {
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
  return true;
}

// Cheap, best-effort utility-class signal for "this element's classes look
// like a dark background" — used only when an element carries no inline or
// computed background color at all (a real color signal always wins). Not
// an attempt to parse Tailwind's full config: just the small set of
// class-name shapes generated designs actually use for dark surfaces
// (`bg-black`, `bg-gray-900`, `bg-neutral-950`, `dark:bg-slate-900`, etc.).
const DARK_BACKGROUND_CLASS_RE =
  /(?:^|:)bg-(?:black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:800|900|950))\b/;

function elementHasDarkBackgroundClassHint(element: Element): boolean {
  const className =
    typeof element.className === "string"
      ? element.className
      : (element.getAttribute("class") ?? "");
  return DARK_BACKGROUND_CLASS_RE.test(className);
}

/**
 * Builds the ancestor background-signal chain `resolveDestinationBackgroundLightness`
 * consumes, walking up from `element`. Prefers a LIVE document's computed
 * style (real cascade, resolves stylesheet/utility classes correctly —
 * mirrors the bridge's `containerBackgroundIsLight`) when `liveElement` is
 * supplied (see `destinationBackgroundIsLightForNode`'s doc for how the
 * live node is resolved); otherwise falls back to reading INLINE
 * `background`/`background-color` declarations plus the dark-class-name
 * heuristic on the detached parsed-doc element, since a DOMParser document
 * has no `defaultView` in real browsers and can't run `getComputedStyle`.
 */
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

/**
 * Resolves whether the destination background around `element` (a node in a
 * DOMParser-parsed detached document) is light. Prefers reading the LIVE
 * destination screen iframe's computed style for the corresponding node
 * when `liveDoc` is supplied — MultiScreenCanvas mounts every visible
 * screen as a same-origin iframe reachable via
 * `[data-screen-iframe-id="<screenId>"]` (see `getPrimaryIframeId` in
 * MultiScreenCanvas.tsx), so the real cascade (including Tailwind utility
 * classes, `<style>` rules, `dark:` variants, etc.) is available exactly
 * like the in-iframe bridge's `containerBackgroundIsLight` — that live path
 * is what makes class-based dark destinations (not just inline-styled ones)
 * resolve correctly. Falls back to the detached doc's inline-style +
 * dark-class-hint chain when no live document is available (e.g. the
 * destination screen isn't currently mounted).
 */
function destinationBackgroundIsLightForNode(
  element: Element,
  liveDoc?: Document | null,
): boolean {
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
    return resolveDestinationBackgroundLightness(chain);
  } catch {
    return true;
  }
}

/**
 * Cross-screen counterpart to adaptAutoTextColorForNest — runs HOST-SIDE
 * after moveNodeBetweenDocuments has already re-parented the text node into
 * `destContent`'s DOM (identified by `destNodeAttrId`). Board-drawn text
 * carries an explicit inline `color:#ffffff` default (see
 * defaultCanvasTextColor / appendCanvasPrimitiveToHtml) because
 * `currentColor` would inherit black on the always-dark board; dropped into
 * a light destination screen/container, that stale inline white is
 * invisible white-on-white. The in-screen drag path already handles this
 * via the bridge's adaptAutoTextColorForNest; this is the missing
 * cross-screen mirror (finding 8).
 *
 * No-op (returns `content` unchanged) when the moved node isn't a text
 * primitive, carries no color needing adaptation, or the DOM can't be
 * parsed — always best-effort, never a hard requirement for the move to
 * succeed.
 *
 * `liveDestDoc` (optional) is the destination screen's LIVE iframe document
 * when it's currently mounted — see `destinationBackgroundIsLightForNode`'s
 * doc comment for why callers should prefer passing it when available
 * (correct resolution for class-based/cascaded dark backgrounds, not just
 * inline-styled ones).
 */
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
    // Finding 2(a): a marker whose color has since diverged from the
    // auto-default white is stale — strip it here (in addition to falling
    // through to the conservative heuristic below) so it can't mislead a
    // LATER move/commit into re-honoring it once the color happens to be
    // reset back to white for unrelated reasons.
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

/**
 * Finding 2(b): the other half of the stale-marker fix. Stripping only
 * happens lazily (finding 2(a), inside adaptAutoTextColorForCrossScreenNode)
 * when a move/adapt pass actually re-reads the node — a user who sets an
 * explicit color and never triggers another move/reparent would otherwise
 * keep carrying a now-stale marker indefinitely. Called from
 * commitVisualStyles whenever a "color" property is part of the committed
 * style patch, so the marker is cleared at the moment the user's explicit
 * choice is actually persisted, not just the next time something happens to
 * re-check it. No-op (returns `content` unchanged) when the node has no
 * marker, isn't found, or the DOM can't be parsed.
 */
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
