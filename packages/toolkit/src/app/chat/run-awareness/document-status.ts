import type { TabRunStatus } from "./tab-run-status.js";

export type ActiveTabRunStatus = Exclude<TabRunStatus, "idle">;

export interface DocumentStatusLabels {
  running: (title: string) => string;
  replyReady: (title: string) => string;
}

/**
 * Draws the app's icon with a status dot. Resolves `null` when the icon could
 * not be drawn, and the page keeps its own favicon.
 */
export type StatusFaviconRenderer = (
  sourceHref: string,
  status: ActiveTabRunStatus,
) => Promise<string | null>;

export interface DocumentStatusController {
  setStatus: (status: TabRunStatus) => void;
  /** Re-renders the decorated title, e.g. after the locale changes. */
  refresh: () => void;
  dispose: () => void;
}

interface SavedIcon {
  link: HTMLLinkElement;
  created: boolean;
  attributes: Record<"href" | "type" | "sizes", string | null>;
}

const ICON_ATTRIBUTES = ["href", "type", "sizes"] as const;

/** lib.dom types `head` as always present; a document with no head element has none. */
function documentHead(doc: Document): HTMLHeadElement | null {
  return doc.head;
}

/**
 * Decorates `document.title` and the favicon with the tab's agent run status.
 * The app keeps owning its title: a title the app sets while decorated
 * becomes the new base, and clearing restores whatever the app set last.
 */
export function createDocumentStatusController({
  document: doc = document,
  labels,
  renderFavicon,
}: {
  document?: Document;
  labels: DocumentStatusLabels;
  renderFavicon?: StatusFaviconRenderer | null;
}): DocumentStatusController {
  let status: TabRunStatus = "idle";
  let baseTitle = "";
  let written: string | null = null;
  // DocumentTitleGuard remembers the last readable title, which can be one we
  // wrote, and may put it back after our status changed.
  const composedBases = new Map<string, string>();
  let observer: MutationObserver | null = null;
  let savedIcons: SavedIcon[] | null = null;
  let faviconToken = 0;
  let disposed = false;

  const compose = (next: ActiveTabRunStatus, title: string) =>
    next === "running" ? labels.running(title) : labels.replyReady(title);

  const writeTitle = () => {
    if (status === "idle") return;
    const next = compose(status, baseTitle);
    composedBases.set(next, baseTitle);
    if (composedBases.size > 20) {
      composedBases.delete(composedBases.keys().next().value as string);
    }
    written = next;
    if (doc.title !== next) doc.title = next;
  };

  const onTitleMutation = () => {
    const current = doc.title;
    if (status === "idle" || current === written) return;
    baseTitle = composedBases.get(current) ?? current;
    writeTitle();
  };

  const observeTitle = () => {
    const head = documentHead(doc);
    if (observer || typeof MutationObserver === "undefined" || !head) {
      return;
    }
    observer = new MutationObserver(onTitleMutation);
    observer.observe(head, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  };

  const restoreTitle = () => {
    observer?.disconnect();
    observer = null;
    if (written !== null && doc.title === written) doc.title = baseTitle;
    written = null;
  };

  const restoreFavicon = () => {
    faviconToken += 1;
    if (!savedIcons) return;
    for (const saved of savedIcons) {
      if (saved.created) {
        saved.link.remove();
        continue;
      }
      for (const name of ICON_ATTRIBUTES) {
        const value = saved.attributes[name];
        if (value === null) saved.link.removeAttribute(name);
        else saved.link.setAttribute(name, value);
      }
    }
    savedIcons = null;
  };

  const decorateFavicon = (next: ActiveTabRunStatus) => {
    const head = documentHead(doc);
    if (!renderFavicon || !head) return;
    if (!savedIcons) {
      const links = Array.from(
        head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
      );
      savedIcons = links.length
        ? links.map((link) => ({
            link,
            created: false,
            attributes: {
              href: link.getAttribute("href"),
              type: link.getAttribute("type"),
              sizes: link.getAttribute("sizes"),
            },
          }))
        : [];
    }
    const source =
      savedIcons.find((saved) => saved.attributes.href)?.link.href ??
      new URL("/favicon.ico", doc.baseURI).href;
    const token = ++faviconToken;
    void renderFavicon(source, next).then(
      (dataUrl) => {
        if (disposed || token !== faviconToken || !dataUrl || !savedIcons) {
          return;
        }
        if (savedIcons.length === 0) {
          const link = doc.createElement("link");
          link.rel = "icon";
          doc.head.appendChild(link);
          savedIcons.push({
            link,
            created: true,
            attributes: { href: null, type: null, sizes: null },
          });
        }
        for (const saved of savedIcons) {
          saved.link.setAttribute("href", dataUrl);
          saved.link.setAttribute("type", "image/png");
          saved.link.removeAttribute("sizes");
        }
      },
      (error: unknown) => {
        console.error(
          "[agent-native] Could not draw the status favicon",
          error,
        );
      },
    );
  };

  return {
    setStatus(next) {
      if (disposed || next === status) return;
      const previous = status;
      status = next;
      if (next === "idle") {
        restoreTitle();
        restoreFavicon();
        return;
      }
      if (previous === "idle") {
        baseTitle = doc.title;
        observeTitle();
      }
      writeTitle();
      decorateFavicon(next);
    },
    refresh() {
      if (!disposed) writeTitle();
    },
    dispose() {
      if (disposed) return;
      status = "idle";
      restoreTitle();
      restoreFavicon();
      disposed = true;
    },
  };
}

function loadImage(doc: Document, src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const view = doc.defaultView;
    if (!view) {
      reject(new Error("The document has no window to load the favicon."));
      return;
    }
    const image = new view.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load favicon ${src}`));
    image.src = src;
  });
}

function resolveTokenColor(doc: Document, token: string): string {
  const probe = doc.createElement("span");
  probe.style.display = "none";
  probe.style.color = `hsl(var(${token}))`;
  doc.body.appendChild(probe);
  const color = doc.defaultView?.getComputedStyle(probe).color ?? "";
  probe.remove();
  return color;
}

const FAVICON_SIZE = 64;
const DOT_RADIUS = 12;
const DOT_RING = 4;

/**
 * Draws the source icon with a dot in its bottom-right corner, in the theme's
 * neutral tones: muted while working, full strength when a reply is ready.
 */
export function createStatusFaviconRenderer(
  doc: Document = document,
): StatusFaviconRenderer {
  return async (sourceHref, status) => {
    let image: HTMLImageElement;
    try {
      image = await loadImage(doc, sourceHref);
    } catch {
      // coercion-ok: null means "keep the tab's own icon"; a bare dot would erase the app's icon.
      return null;
    }
    const canvas = doc.createElement("canvas");
    canvas.width = FAVICON_SIZE;
    canvas.height = FAVICON_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, FAVICON_SIZE, FAVICON_SIZE);
    const center = FAVICON_SIZE - DOT_RADIUS - DOT_RING / 2;
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.arc(center, center, DOT_RADIUS + DOT_RING, 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = resolveTokenColor(
      doc,
      status === "running" ? "--muted-foreground" : "--foreground",
    );
    context.beginPath();
    context.arc(center, center, DOT_RADIUS, 0, Math.PI * 2);
    context.fill();
    try {
      return canvas.toDataURL("image/png");
    } catch {
      // coercion-ok: a cross-origin icon taints the canvas; null keeps the tab's own icon.
      return null;
    }
  };
}
