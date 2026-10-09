import { injectDocumentMarkup } from "@agent-native/core/shared";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";

const PRIVATE_SCREENSHOT_ATTRIBUTE =
  "data-agent-native-private-replay-screenshot-index";
const PRIVATE_SCREENSHOT_SRCSET_ATTRIBUTE =
  "data-agent-native-private-replay-screenshot-srcset";
const PRIVATE_SCREENSHOT_PUBLIC_SRCSET_ATTRIBUTE =
  "data-agent-native-private-replay-screenshot-public-srcset";
const PRIVATE_SCREENSHOT_PATH =
  /^\/api\/design-board-replay-screenshots\/(jcs_[A-Za-z0-9_-]+)$/;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CONNECTION_MESSAGE = "design-private-replay-screenshot:connect";
const READY_MESSAGE = "design-private-replay-screenshot:ready";
const REQUEST_MESSAGE = "design-private-replay-screenshot:request";
const RESULT_MESSAGE = "design-private-replay-screenshot:result";
const bridgeCleanupByIframe = new WeakMap<HTMLIFrameElement, () => void>();

export interface PrivateReplayScreenshotPreviewDocument {
  html: string;
  screenshotPaths: string[];
  nonce: string | null;
}

function randomNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

function parseSrcset(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let position = 0;

  while (position < value.length) {
    while (position < value.length && /[\s,]/.test(value[position]!))
      position += 1;
    if (position >= value.length) break;

    const urlStart = position;
    while (position < value.length && !/\s/.test(value[position]!))
      position += 1;
    let url = value.slice(urlStart, position);
    const hasTrailingSeparator = url.endsWith(",");
    while (url.endsWith(",")) url = url.slice(0, -1);

    let descriptor = "";
    if (!hasTrailingSeparator) {
      while (position < value.length && /\s/.test(value[position]!))
        position += 1;
      const descriptorStart = position;
      let parentheses = 0;
      while (position < value.length) {
        const character = value[position]!;
        if (character === "(") parentheses += 1;
        if (character === ")" && parentheses > 0) parentheses -= 1;
        if (character === "," && parentheses === 0) break;
        position += 1;
      }
      descriptor = value.slice(descriptorStart, position).trim();
      if (value[position] === ",") position += 1;
    }

    if (url) candidates.push({ url, descriptor });
  }

  return candidates;
}

function formatSrcsetCandidate(candidate: SrcsetCandidate): string {
  return candidate.descriptor
    ? `${candidate.url} ${candidate.descriptor}`
    : candidate.url;
}

function previewBootstrap(nonce: string, parentOrigin: string): string {
  return `<script data-agent-native-private-replay-screenshot-bridge>
(function() {
  var nonce = ${JSON.stringify(nonce)};
  var parentOrigin = ${JSON.stringify(parentOrigin)};
  var marker = ${JSON.stringify(PRIVATE_SCREENSHOT_ATTRIBUTE)};
  var srcsetMarker = ${JSON.stringify(PRIVATE_SCREENSHOT_SRCSET_ATTRIBUTE)};
  var publicSrcsetMarker = ${JSON.stringify(PRIVATE_SCREENSHOT_PUBLIC_SRCSET_ATTRIBUTE)};
  var port = null;
  var observer = null;
  var objectUrls = [];
  var blobUrlsByIndex = Object.create(null);
  var announceTimer = window.setInterval(function() {
    if (port) return;
    parent.postMessage({ type: ${JSON.stringify(READY_MESSAGE)}, nonce: nonce }, parentOrigin);
  }, 100);
  function requestImage(image) {
    if (!port) return;
    if (image.getAttribute('data-agent-native-private-replay-requested') === 'true') return;
    image.setAttribute('data-agent-native-private-replay-requested', 'true');
    var indices = [];
    var sourceValue = image.getAttribute(marker);
    if (sourceValue !== null && sourceValue !== '') {
      var sourceIndex = Number(sourceValue);
      if (Number.isInteger(sourceIndex) && sourceIndex >= 0) indices.push(sourceIndex);
    }
    var candidates = JSON.parse(image.getAttribute(srcsetMarker) || '[]');
    candidates.forEach(function(candidate) {
      if (Number.isInteger(candidate.index) && candidate.index >= 0 && indices.indexOf(candidate.index) === -1) indices.push(candidate.index);
    });
    indices.forEach(function(index) {
      port.postMessage({ type: ${JSON.stringify(REQUEST_MESSAGE)}, index: index });
    });
  }
  function applyPrivateSrcset(image) {
    var candidates = JSON.parse(image.getAttribute(srcsetMarker) || '[]');
    var privateCandidates = candidates.filter(function(candidate) {
      return typeof blobUrlsByIndex[candidate.index] === 'string';
    }).map(function(candidate) {
      return blobUrlsByIndex[candidate.index] + (candidate.descriptor ? ' ' + candidate.descriptor : '');
    });
    var publicSrcset = image.getAttribute(publicSrcsetMarker) || '';
    var combined = [publicSrcset].concat(privateCandidates).filter(Boolean).join(', ');
    if (combined) image.srcset = combined;
  }
  window.addEventListener('message', function(event) {
    if (event.source !== parent || event.origin !== parentOrigin) return;
    if (event.data && event.data.type === ${JSON.stringify(CONNECTION_MESSAGE)} && event.data.nonce === nonce && event.ports[0]) {
      port = event.ports[0];
      window.clearInterval(announceTimer);
      port.onmessage = function(messageEvent) {
        var data = messageEvent.data;
        if (!data || data.type !== ${JSON.stringify(RESULT_MESSAGE)} || !Number.isInteger(data.index) || !(data.blob instanceof Blob)) return;
        var objectUrl = URL.createObjectURL(data.blob);
        objectUrls.push(objectUrl);
        blobUrlsByIndex[data.index] = objectUrl;
        document.querySelectorAll('img[' + marker + '="' + data.index + '"]').forEach(function(image) {
          image.src = objectUrl;
        });
        document.querySelectorAll('[' + srcsetMarker + ']').forEach(applyPrivateSrcset);
      };
      if (port.start) port.start();
      var images = document.querySelectorAll('img[' + marker + '], img[' + srcsetMarker + ']');
      var sources = document.querySelectorAll('source[' + srcsetMarker + ']');
      sources.forEach(requestImage);
      if (!('IntersectionObserver' in window)) {
        images.forEach(requestImage);
        return;
      }
      observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          requestImage(entry.target);
        });
      }, { rootMargin: '160px' });
      images.forEach(function(image) { observer.observe(image); });
    }
  });
  window.addEventListener('pagehide', function() {
    if (observer) observer.disconnect();
    if (port) {
      port.postMessage({ type: 'design-private-replay-screenshot:dispose' });
      port.close();
    }
    objectUrls.forEach(function(url) { URL.revokeObjectURL(url); });
  }, { once: true });
})();
</script>`;
}

function visitElements(
  node: DefaultTreeAdapterMap["node"],
  visit: (element: DefaultTreeAdapterMap["element"]) => void,
): void {
  if ("tagName" in node && "attrs" in node) visit(node);
  if ("childNodes" in node) {
    for (const child of node.childNodes) visitElements(child, visit);
  }
}

export function preparePrivateReplayScreenshotPreviewDocument(
  html: string,
  options: { designId?: string | null; parentOrigin?: string } = {},
): PrivateReplayScreenshotPreviewDocument {
  if (!html.includes("/api/design-board-replay-screenshots/")) {
    return { html, screenshotPaths: [], nonce: null };
  }

  const parentOrigin =
    options.parentOrigin ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const designId = options.designId?.trim();
  const document = parse(html);
  const screenshotPaths: string[] = [];
  const indices = new Map<string, number>();
  visitElements(document, (element) => {
    element.attrs = element.attrs.filter(
      (attribute) =>
        attribute.name !== PRIVATE_SCREENSHOT_ATTRIBUTE &&
        attribute.name !== PRIVATE_SCREENSHOT_SRCSET_ATTRIBUTE &&
        attribute.name !== PRIVATE_SCREENSHOT_PUBLIC_SRCSET_ATTRIBUTE &&
        attribute.name !== "data-agent-native-private-replay-requested",
    );
    if (element.tagName !== "img" && element.tagName !== "source") return;
    const source =
      element.tagName === "img"
        ? element.attrs.find((attribute) => attribute.name === "src")
        : undefined;
    const srcset = element.attrs.find(
      (attribute) => attribute.name === "srcset",
    );
    const getIndex = (path: string) => {
      if (!PRIVATE_SCREENSHOT_PATH.test(path)) return undefined;
      let index = indices.get(path);
      if (index === undefined) {
        index = screenshotPaths.length;
        indices.set(path, index);
        screenshotPaths.push(path);
      }
      return index;
    };

    const sourceIndex = source ? getIndex(source.value) : undefined;
    const publicCandidates: SrcsetCandidate[] = [];
    const privateCandidates: Array<SrcsetCandidate & { index: number }> = [];
    if (srcset) {
      for (const candidate of parseSrcset(srcset.value)) {
        const index = getIndex(candidate.url);
        if (index === undefined) publicCandidates.push(candidate);
        else privateCandidates.push({ ...candidate, index });
      }
    }

    if (sourceIndex !== undefined) {
      element.attrs = element.attrs.filter(
        (attribute) => attribute.name !== "src",
      );
      element.attrs.push({
        name: PRIVATE_SCREENSHOT_ATTRIBUTE,
        value: String(sourceIndex),
      });
    }
    if (privateCandidates.length > 0) {
      const publicSrcset = publicCandidates
        .map(formatSrcsetCandidate)
        .join(", ");
      const existingSrcset = element.attrs.findIndex(
        (attribute) => attribute.name === "srcset",
      );
      if (existingSrcset >= 0) {
        element.attrs.splice(existingSrcset, 1);
        if (publicSrcset)
          element.attrs.push({ name: "srcset", value: publicSrcset });
      }
      element.attrs.push({
        name: PRIVATE_SCREENSHOT_SRCSET_ATTRIBUTE,
        value: JSON.stringify(
          privateCandidates.map(({ index, descriptor }) => ({
            index,
            descriptor,
          })),
        ),
      });
      element.attrs.push({
        name: PRIVATE_SCREENSHOT_PUBLIC_SRCSET_ATTRIBUTE,
        value: publicSrcset,
      });
    }
  });

  if (screenshotPaths.length === 0) {
    return { html, screenshotPaths, nonce: null };
  }
  if (!parentOrigin || !designId) {
    visitElements(document, (element) => {
      element.attrs = element.attrs.filter(
        (attribute) =>
          attribute.name !== PRIVATE_SCREENSHOT_ATTRIBUTE &&
          attribute.name !== PRIVATE_SCREENSHOT_SRCSET_ATTRIBUTE &&
          attribute.name !== PRIVATE_SCREENSHOT_PUBLIC_SRCSET_ATTRIBUTE,
      );
    });
    return { html: serialize(document), screenshotPaths: [], nonce: null };
  }

  const nonce = randomNonce();
  return {
    html: injectDocumentMarkup(
      serialize(document),
      previewBootstrap(nonce, parentOrigin),
    ),
    screenshotPaths,
    nonce,
  };
}

export function connectPrivateReplayScreenshotPreview(
  iframe: HTMLIFrameElement,
  screenshotPaths: readonly string[],
  nonce: string | null,
  designId: string,
): () => void {
  bridgeCleanupByIframe.get(iframe)?.();
  bridgeCleanupByIframe.delete(iframe);
  if (!designId.trim() || !nonce || screenshotPaths.length === 0)
    return () => undefined;
  const sandbox = new Set(
    (iframe.getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean),
  );
  if (!sandbox.has("allow-scripts") || sandbox.has("allow-same-origin")) {
    return () => undefined;
  }

  let port: MessagePort | null = null;
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("message", receiveReady);
    window.clearTimeout(timeout);
    port?.close();
    port = null;
    bridgeCleanupByIframe.delete(iframe);
  };
  const timeout = window.setTimeout(cleanup, 5_000);
  const requests = new Set<number>();
  const parentOrigin = window.location.origin;
  const receiveReady = (event: MessageEvent) => {
    if (
      disposed ||
      event.source !== iframe.contentWindow ||
      event.origin !== "null" ||
      event.data?.type !== READY_MESSAGE ||
      event.data.nonce !== nonce
    ) {
      return;
    }
    window.removeEventListener("message", receiveReady);
    window.clearTimeout(timeout);
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = (messageEvent) => {
      const data = messageEvent.data;
      if (data?.type === "design-private-replay-screenshot:dispose") {
        cleanup();
        return;
      }
      if (
        data?.type !== REQUEST_MESSAGE ||
        !Number.isInteger(data.index) ||
        data.index < 0 ||
        data.index >= screenshotPaths.length ||
        requests.has(data.index)
      ) {
        return;
      }
      requests.add(data.index);
      void loadScreenshot(data.index, screenshotPaths[data.index]!);
    };
    port.start();
    iframe.contentWindow?.postMessage(
      { type: CONNECTION_MESSAGE, nonce },
      "*",
      [channel.port2],
    );
  };
  const loadScreenshot = async (index: number, path: string) => {
    try {
      const url = new URL(path, window.location.href);
      if (
        url.origin !== parentOrigin ||
        !PRIVATE_SCREENSHOT_PATH.test(url.pathname) ||
        url.search ||
        url.hash
      ) {
        throw new Error("Invalid private screenshot route");
      }
      url.searchParams.set("designId", designId);
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        mode: "same-origin",
        referrerPolicy: "no-referrer",
      });
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        !response.ok ||
        !contentType ||
        !ALLOWED_IMAGE_TYPES.has(contentType)
      ) {
        throw new Error("Private screenshot request was denied");
      }
      const blob = new Blob([await response.arrayBuffer()], {
        type: contentType,
      });
      if (!blob.size) throw new Error("Private screenshot was empty");
      if (!disposed) port?.postMessage({ type: RESULT_MESSAGE, index, blob });
    } catch {
      if (!disposed)
        port?.postMessage({ type: RESULT_MESSAGE, index, denied: true });
    }
  };

  window.addEventListener("message", receiveReady);
  bridgeCleanupByIframe.set(iframe, cleanup);
  return cleanup;
}
