export interface DraftOutlines {
  /**
   * Drafts an element that just streamed in: its frame and its descendants'
   * frames trace in parent first, then its content fades in under them.
   */
  track: (element: Element) => void;
  dispose: () => void;
}

/** Set on the outline container while drafting replaces the plain fade-in. */
export const DRAFTING_ATTRIBUTE = "data-agent-native-drafting";

/**
 * Drafts streamed-in content the way a designer would block it out: every
 * new element's frame is stroked in, containers first, then each child in
 * document order a beat after its parent and after its earlier siblings, so
 * a grid fills card by card. Each element stays hidden until its own frame
 * has drawn, then fades in beneath it while the frames fade away. `container` must be
 * positioned; the frames live in a layer appended to it, outside whatever
 * subtree the stream patches.
 *
 * This function is serialized into sandboxed preview frames with
 * `Function.prototype.toString`, so it must not reference anything outside
 * its own body.
 */
export function createDraftOutlines(
  container: HTMLElement,
  accent: string,
): DraftOutlines {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const MAX_LIVE = 160;
  /** Delay between a frame and its first child's. */
  const LEVEL_MS = 110;
  /** Delay between one sibling's frame and the next. */
  const SIBLING_MS = 55;
  /** Long lists compress so the last sibling still starts promptly. */
  const MAX_SIBLING_SPREAD_MS = 1100;
  /** No element in one arrival starts later than this after it. */
  const MAX_SEQUENCE_MS = 3200;
  const DRAW_MS = 260;
  /** How long a drawn frame holds before it fades, once its box is still. */
  const HOLD_MS = 520;
  const SETTLE_MS = 240;
  /** A frame fades by then even if its box never holds still (a CSS animation). */
  const MAX_FRAME_MS = 2400;
  const FADE_MS = 300;
  const REVEAL_MS = 260;
  const GIVE_UP_MS = 2500;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SKIPPED =
    /^(A|ABBR|B|BR|CODE|EM|I|S|SMALL|STRONG|SUB|SUP|U|WBR|SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT|PATH|G|CIRCLE|LINE|POLYLINE|POLYGON|RECT|ELLIPSE|DEFS|USE|STOP)$/i;
  const noop: DraftOutlines = { track: () => {}, dispose: () => {} };
  if (!view) return noop;
  if (view.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return noop;
  }

  const layer = doc.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483647;";
  container.appendChild(layer);
  container.setAttribute("data-agent-native-drafting", "");

  interface Entry {
    startAt: number;
    box: HTMLDivElement | null;
    shownAt: number;
    width: number;
    height: number;
    stableSince: number;
    leaving: boolean;
  }
  const live = new Map<Element, Entry>();
  let frame = 0;

  const drop = (element: Element, entry: Entry) => {
    entry.box?.remove();
    live.delete(element);
  };

  const show = (entry: Entry, radius: string, now: number) => {
    const box = doc.createElement("div");
    box.style.cssText = `position:absolute;box-sizing:border-box;border-radius:${radius};`;
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cssText = "position:absolute;inset:0;overflow:visible;";
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "0.5");
    rect.setAttribute("y", "0.5");
    rect.setAttribute(
      "style",
      "width:calc(100% - 1px);height:calc(100% - 1px);",
    );
    rect.setAttribute("rx", String(Number.parseFloat(radius) || 0));
    rect.setAttribute("pathLength", "1");
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", accent);
    rect.setAttribute("stroke-opacity", "0.75");
    rect.setAttribute("stroke-width", "1");
    rect.setAttribute("vector-effect", "non-scaling-stroke");
    rect.setAttribute("stroke-dasharray", "1");
    rect.setAttribute("stroke-dashoffset", "1");
    svg.appendChild(rect);
    box.appendChild(svg);
    layer.appendChild(box);
    rect.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: DRAW_MS,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards",
    });
    entry.box = box;
    entry.shownAt = now;
  };

  const tick = (now: number) => {
    frame = 0;
    const origin = container.getBoundingClientRect();
    const scaleX =
      container.offsetWidth && origin.width
        ? origin.width / container.offsetWidth
        : 1;
    const scaleY =
      container.offsetHeight && origin.height
        ? origin.height / container.offsetHeight
        : scaleX;
    // The root element's rect already moves with the page scroll.
    const isRoot = container === doc.documentElement;
    const scrollX = isRoot ? 0 : container.scrollLeft;
    const scrollY = isRoot ? 0 : container.scrollTop;
    // Every layout read comes before any write; interleaving them would force
    // a synchronous layout per frame drawn.
    const measured: {
      element: Element;
      entry: Entry;
      rect: DOMRect | null;
      radius: string | null;
    }[] = [];
    live.forEach((entry, element) => {
      if (entry.leaving || now < entry.startAt) return;
      if (!element.isConnected) {
        measured.push({ element, entry, rect: null, radius: null });
        return;
      }
      const rect = element.getBoundingClientRect();
      let radius: string | null = null;
      if (!entry.box && rect.width / scaleX >= 6 && rect.height / scaleY >= 6) {
        const style = view.getComputedStyle(element);
        radius =
          style.display === "inline" || style.visibility === "hidden"
            ? null
            : style.borderRadius || "0px";
        if (radius === null) {
          measured.push({ element, entry, rect: null, radius: null });
          return;
        }
      }
      measured.push({ element, entry, rect, radius });
    });
    measured.forEach(({ element, entry, rect, radius }) => {
      if (!rect) {
        drop(element, entry);
        return;
      }
      const width = rect.width / scaleX;
      const height = rect.height / scaleY;
      if (!entry.box) {
        if (radius === null) {
          if (now - entry.startAt > GIVE_UP_MS) drop(element, entry);
          return;
        }
        show(entry, radius, now);
      }
      const box = entry.box;
      if (!box) return;
      box.style.left = `${(rect.left - origin.left) / scaleX + scrollX}px`;
      box.style.top = `${(rect.top - origin.top) / scaleY + scrollY}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      const expired = now - entry.shownAt > MAX_FRAME_MS;
      if (
        !expired &&
        (Math.abs(width - entry.width) > 0.5 ||
          Math.abs(height - entry.height) > 0.5)
      ) {
        entry.width = width;
        entry.height = height;
        entry.stableSince = now;
        return;
      }
      if (
        expired ||
        (now - entry.stableSince > SETTLE_MS &&
          now - entry.shownAt > DRAW_MS + HOLD_MS)
      ) {
        entry.leaving = true;
        const fade = box.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: FADE_MS,
          fill: "forwards",
        });
        fade.onfinish = () => drop(element, entry);
      }
    });
    if (live.size > 0) frame = view.requestAnimationFrame(tick);
  };

  const watch = (element: Element, startAt: number) => {
    if (live.size >= MAX_LIVE || live.has(element)) return;
    if (SKIPPED.test(element.tagName)) return;
    live.set(element, {
      startAt,
      box: null,
      shownAt: 0,
      width: -1,
      height: -1,
      stableSince: startAt,
      leaving: false,
    });
  };

  const reveal = (element: Element, startAt: number, now: number) => {
    // A script animation leaves the style attribute alone, so later patches
    // can't unhide the element before its frame is drawn.
    element.animate([{ opacity: 0 }, { opacity: 1 }], {
      delay: Math.max(0, startAt - now) + DRAW_MS * 0.8,
      duration: REVEAL_MS,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
      fill: "backwards",
    });
  };

  /** When the next element arriving in the same burst may start. */
  let cursor = 0;

  const schedule = (
    element: Element,
    startAt: number,
    origin: number,
    now: number,
  ) => {
    if (SKIPPED.test(element.tagName)) return;
    // Past the cap an element and its subtree get no frame and no animation
    // of their own; they fade in with the nearest ancestor that was drafted.
    if (live.size >= MAX_LIVE) return;
    const at = Math.min(startAt, origin + MAX_SEQUENCE_MS);
    watch(element, at);
    reveal(element, at, now);
    const children = Array.from(element.children).filter(
      (child) => !SKIPPED.test(child.tagName),
    );
    const step =
      children.length > 1
        ? Math.min(SIBLING_MS, MAX_SIBLING_SPREAD_MS / (children.length - 1))
        : 0;
    children.forEach((child, index) => {
      schedule(child, at + LEVEL_MS + index * step, origin, now);
    });
  };

  return {
    track: (element) => {
      const now = view.performance.now();
      // Elements arriving together (a streamed chunk, a runtime rendering a
      // list) queue up in document order instead of firing at once, but no
      // element starts later than MAX_SEQUENCE_MS after it arrived.
      const startAt = Math.min(Math.max(now, cursor), now + MAX_SEQUENCE_MS);
      cursor = startAt + SIBLING_MS;
      schedule(element, startAt, now, now);
      if (!frame && live.size > 0) frame = view.requestAnimationFrame(tick);
    },
    dispose: () => {
      if (frame) view.cancelAnimationFrame(frame);
      frame = 0;
      live.clear();
      layer.remove();
      container.removeAttribute("data-agent-native-drafting");
    },
  };
}
