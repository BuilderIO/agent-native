import {
  INTERACTIVE_HTML_LIBRARY_ORIGIN,
  type InteractiveHtmlDisplaySources,
} from "@shared/interactive-html";

export const SEALED_FRAME_SANDBOX = "allow-scripts allow-forms";

export const SEALED_FRAME_ALLOW = "fullscreen *";

export const SEALED_FRAME_MIN_HEIGHT = 96;
export const SEALED_FRAME_MAX_HEIGHT = 1000;

const HEIGHT_MESSAGE = "content-interactive-html-height";
const ESCAPE_MESSAGE = "content-interactive-html-escape";
const FOCUS_MESSAGE = "content-interactive-html-focus";

export function sealedFrameCsp({
  imageSources,
  mediaSources,
}: InteractiveHtmlDisplaySources): string {
  const display = (sources: readonly string[]) =>
    [
      ...new Set([
        "data:",
        "blob:",
        ...sources.filter((source) => !source.startsWith("'")),
      ]),
    ].join(" ");
  return [
    "default-src 'none'",
    `script-src ${INTERACTIVE_HTML_LIBRARY_ORIGIN} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${INTERACTIVE_HTML_LIBRARY_ORIGIN} 'unsafe-inline'`,
    `font-src ${INTERACTIVE_HTML_LIBRARY_ORIGIN} data:`,
    `img-src ${display(imageSources)}`,
    `media-src ${display(mediaSources)}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const BLOCK_SCRIPT = `(() => {
  const host = window.parent;
  const post = (message) => host.postMessage(message, "*");

  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
    Reflect.defineProperty(window, name, { value: undefined });
  }
  const NESTED = "iframe,frame,object,embed,fencedframe";
  const watch = (root) =>
    new MutationObserver(() => {
      for (const element of root.querySelectorAll(NESTED)) element.remove();
    }).observe(root, { childList: true, subtree: true });
  watch(document);
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    const root = attachShadow.call(this, options);
    watch(root);
    return root;
  };

  addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    post({ type: "${ESCAPE_MESSAGE}" });
  });

  addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const link = event
      .composedPath()
      .find((node) => node instanceof Element && node.matches("a[href],area[href]"));
    if (!link) return;
    const href = link.getAttribute("href").trim();
    if (/^javascript:/i.test(href)) return;
    event.preventDefault();
    if (href.startsWith("#")) location.hash = href;
  });

  let sent = 0;
  let seen = 0;
  let overflow = 0;
  let view = 0;
  let width = 0;
  let shrunkFrom = 0;
  let tooShort = 0;
  const contentBottom = () => {
    const body = document.body;
    const bottoms = [
      body.getBoundingClientRect().bottom +
        (parseFloat(getComputedStyle(body).marginBottom) || 0),
    ];
    for (const element of [...body.getElementsByTagName("*")].slice(0, 2000)) {
      bottoms.push(element.getBoundingClientRect().bottom);
    }
    return Math.ceil(Math.max(...bottoms) + window.scrollY);
  };
  const measure = () => {
    const page = document.documentElement;
    if (!document.body || !page.clientWidth) return;
    const resized = view !== window.innerHeight;
    if (width !== window.innerWidth) tooShort = 0;
    view = window.innerHeight;
    width = window.innerWidth;
    const over = Math.ceil(page.scrollHeight - view);
    let height;
    if (over > 0) {
      if (over === overflow && view === sent) return;
      overflow = over;
      height = view + over;
      if (resized && shrunkFrom && height >= shrunkFrom) tooShort = sent;
      shrunkFrom = 0;
    } else {
      height = contentBottom();
      if (height >= view || height === tooShort) return;
      overflow = 0;
      shrunkFrom = view;
    }
    if (height === sent && view === seen) return;
    sent = height;
    seen = view;
    post({ type: "${HEIGHT_MESSAGE}", height });
  };
  let timer;
  const queue = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      measure();
    }, 60);
  };
  addEventListener("load", queue);
  addEventListener("resize", queue);
  document.addEventListener("DOMContentLoaded", () => {
    const sizes = new ResizeObserver(queue);
    sizes.observe(document.documentElement);
    if (document.body) sizes.observe(document.body);
    new MutationObserver(queue).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    queue();
  });
})()`;

const RELAY_SCRIPT = `(() => {
  const frame = document.querySelector("iframe");
  addEventListener("message", (event) => {
    const { type, height } = Object(event.data);
    if (event.source === parent && type === "${FOCUS_MESSAGE}") {
      frame.focus();
      frame.contentWindow.focus();
    }
    if (event.source !== frame.contentWindow) return;
    if (type === "${ESCAPE_MESSAGE}") parent.postMessage({ type }, "*");
    if (type === "${HEIGHT_MESSAGE}" && typeof height === "number")
      parent.postMessage({ type, height }, "*");
  });
  addEventListener("keydown", ({ key }) => {
    if (key === "Escape") parent.postMessage({ type: "${ESCAPE_MESSAGE}" }, "*");
  });
})()`;

const FRAME_STYLE =
  "html{color-scheme:light dark}html,body,iframe{display:block;width:100%;height:100%;margin:0;border:0;overflow:hidden;background:transparent}";

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function sealedFrameDocument(
  source: string,
  sources: InteractiveHtmlDisplaySources,
): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(sealedFrameCsp(sources))}"><meta http-equiv="x-dns-prefetch-control" content="off"><meta name="referrer" content="no-referrer">`;
  const block = `<!doctype html>${policy}<script>${BLOCK_SCRIPT}</script>${source.replace(/^\s*<!doctype[^>]*>/i, "")}`;
  return `<!doctype html><html><head>${policy}<style>${FRAME_STYLE}</style></head><body><iframe sandbox="${SEALED_FRAME_SANDBOX}" allow="${SEALED_FRAME_ALLOW}" allowfullscreen srcdoc="${escapeAttribute(block)}"></iframe><script>${RELAY_SCRIPT}</script></body></html>`;
}

export function focusSealedFrame(frame: HTMLIFrameElement): void {
  frame.focus();
  frame.contentWindow?.postMessage({ type: FOCUS_MESSAGE }, "*");
}

export type SealedFrameMessage =
  | { type: "height"; height: number }
  | { type: "escape" };

export function readSealedFrameMessage(
  data: unknown,
): SealedFrameMessage | null {
  if (typeof data !== "object" || data === null || !("type" in data)) {
    return null;
  }
  if (data.type === ESCAPE_MESSAGE) return { type: "escape" };
  if (
    data.type !== HEIGHT_MESSAGE ||
    !("height" in data) ||
    typeof data.height !== "number" ||
    !Number.isFinite(data.height)
  ) {
    return null;
  }
  return {
    type: "height",
    height: Math.min(
      SEALED_FRAME_MAX_HEIGHT,
      Math.max(SEALED_FRAME_MIN_HEIGHT, Math.ceil(data.height)),
    ),
  };
}
