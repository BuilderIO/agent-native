import { injectDocumentMarkup } from "@agent-native/core/shared";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";

const PRIVATE_SCREENSHOT_ATTRIBUTE =
  "data-agent-native-private-replay-screenshot-index";
const PRIVATE_SCREENSHOT_SRC_PLACEHOLDER_ATTRIBUTE =
  "data-agent-native-private-replay-screenshot-src-placeholder";
const PRIVATE_SCREENSHOT_SRCSET_ATTRIBUTE =
  "data-agent-native-private-replay-screenshot-srcset";
const PRIVATE_SCREENSHOT_PUBLIC_SRCSET_ATTRIBUTE =
  "data-agent-native-private-replay-screenshot-public-srcset";
const PRIVATE_SCREENSHOT_PATH =
  /^\/api\/design-board-replay-screenshots\/(jcs_[A-Za-z0-9_-]+)$/;
// Keep native srcset selection local; hydrate its chosen candidate only when visible.
const PRIVATE_SCREENSHOT_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
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

function privateScreenshotPlaceholder(index: number): string {
  return `${PRIVATE_SCREENSHOT_PLACEHOLDER}#agent-native-private-replay-${index}`;
}

export function replacePrivateScreenshotSrcsetPlaceholder(
  srcset: string,
  placeholder: string,
  objectUrl: string,
): string {
  let nextIndex = 0;
  let lastCopiedIndex = 0;
  let result = "";

  while (nextIndex < srcset.length) {
    const candidateStart = srcset.indexOf(placeholder, nextIndex);
    if (candidateStart === -1) break;

    const candidateEnd = candidateStart + placeholder.length;
    const startsAtBoundary =
      candidateStart === 0 || /[\s,]/.test(srcset[candidateStart - 1]!);
    const endsAtBoundary =
      candidateEnd === srcset.length || /[\s,]/.test(srcset[candidateEnd]!);
    if (startsAtBoundary && endsAtBoundary) {
      result += srcset.slice(lastCopiedIndex, candidateStart) + objectUrl;
      lastCopiedIndex = candidateEnd;
      nextIndex = candidateEnd;
    } else {
      nextIndex = candidateStart + 1;
    }
  }

  return lastCopiedIndex === 0
    ? srcset
    : result + srcset.slice(lastCopiedIndex);
}

function previewBootstrap(nonce: string, parentOrigin: string): string {
  return `<script data-agent-native-private-replay-screenshot-bridge>
(function() {
  var replacePrivateScreenshotSrcsetPlaceholder = ${replacePrivateScreenshotSrcsetPlaceholder.toString()};
  var nonce = ${JSON.stringify(nonce)};
  var parentOrigin = ${JSON.stringify(parentOrigin)};
  var marker = ${JSON.stringify(PRIVATE_SCREENSHOT_ATTRIBUTE)};
  var srcPlaceholderMarker = ${JSON.stringify(PRIVATE_SCREENSHOT_SRC_PLACEHOLDER_ATTRIBUTE)};
  var srcsetMarker = ${JSON.stringify(PRIVATE_SCREENSHOT_SRCSET_ATTRIBUTE)};
  var requestedIndices = Object.create(null);
  var visibleImages = new Set();
  var port = null;
  var observer = null;
  var objectUrls = [];
  var announceTimer = window.setInterval(function() {
    if (port) return;
    parent.postMessage({ type: ${JSON.stringify(READY_MESSAGE)}, nonce: nonce }, parentOrigin);
  }, 100);
  function imagePrivateCandidates(element) {
    var candidates = [];
    var sourceValue = element.getAttribute(marker);
    var sourcePlaceholder = element.getAttribute(srcPlaceholderMarker);
    if (sourceValue !== null && sourcePlaceholder) {
      var sourceIndex = Number(sourceValue);
      if (Number.isInteger(sourceIndex) && sourceIndex >= 0) {
        candidates.push({ index: sourceIndex, placeholder: sourcePlaceholder });
      }
    }
    candidates = candidates.concat(JSON.parse(element.getAttribute(srcsetMarker) || '[]'));
    return candidates;
  }
  function privateCandidatesForImage(image) {
    var candidates = imagePrivateCandidates(image);
    var picture = image.closest('picture');
    if (picture) {
      picture.querySelectorAll('source[' + srcsetMarker + ']').forEach(function(source) {
        candidates = candidates.concat(imagePrivateCandidates(source));
      });
    }
    return candidates;
  }
  function requestImage(image) {
    if (!port || !visibleImages.has(image)) return;
    var selectedUrl = image.currentSrc;
    if (!selectedUrl) return;
    var selected = privateCandidatesForImage(image).find(function(candidate) {
      return candidate.placeholder === selectedUrl;
    });
    if (!selected || requestedIndices[selected.index]) return;
    requestedIndices[selected.index] = true;
    port.postMessage({ type: ${JSON.stringify(REQUEST_MESSAGE)}, index: selected.index });
  }
  function isInViewport(image) {
    var bounds = image.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
  }
  function trackVisibleImages(images) {
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            visibleImages.add(entry.target);
            requestImage(entry.target);
          } else {
            visibleImages.delete(entry.target);
          }
        });
      }, { rootMargin: '0px' });
      images.forEach(function(image) {
        image.addEventListener('load', function() { requestImage(image); });
        observer.observe(image);
      });
      return;
    }
    function updateVisibleImages() {
      images.forEach(function(image) {
        if (isInViewport(image)) {
          visibleImages.add(image);
          requestImage(image);
        } else {
          visibleImages.delete(image);
        }
      });
    }
    images.forEach(function(image) {
      image.addEventListener('load', function() { requestImage(image); });
    });
    window.addEventListener('scroll', updateVisibleImages, { passive: true });
    window.addEventListener('resize', updateVisibleImages);
    updateVisibleImages();
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
        document.querySelectorAll('img[' + marker + ']').forEach(function(image) {
          if (Number(image.getAttribute(marker)) === data.index) image.src = objectUrl;
        });
        document.querySelectorAll('[' + srcsetMarker + ']').forEach(function(element) {
          var candidates = JSON.parse(element.getAttribute(srcsetMarker) || '[]');
          var srcset = element.getAttribute('srcset') || '';
          candidates.forEach(function(candidate) {
            if (candidate.index === data.index) srcset = replacePrivateScreenshotSrcsetPlaceholder(srcset, candidate.placeholder, objectUrl);
          });
          element.setAttribute('srcset', srcset);
        });
      };
      if (port.start) port.start();
      var images = Array.prototype.filter.call(document.querySelectorAll('img'), function(image) {
        return privateCandidatesForImage(image).length > 0;
      });
      trackVisibleImages(images);
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
        attribute.name !== PRIVATE_SCREENSHOT_SRC_PLACEHOLDER_ATTRIBUTE &&
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
    const safeCandidates: SrcsetCandidate[] = [];
    const privateCandidates: Array<{ index: number; placeholder: string }> = [];
    if (srcset) {
      for (const candidate of parseSrcset(srcset.value)) {
        const index = getIndex(candidate.url);
        if (index === undefined) {
          publicCandidates.push(candidate);
          safeCandidates.push(candidate);
        } else {
          const placeholder = privateScreenshotPlaceholder(index);
          privateCandidates.push({ index, placeholder });
          safeCandidates.push({ ...candidate, url: placeholder });
        }
      }
    }

    if (sourceIndex !== undefined) {
      element.attrs = element.attrs.filter(
        (attribute) => attribute.name !== "src",
      );
      const placeholder = privateScreenshotPlaceholder(sourceIndex);
      element.attrs.push({ name: "src", value: placeholder });
      element.attrs.push({
        name: PRIVATE_SCREENSHOT_ATTRIBUTE,
        value: String(sourceIndex),
      });
      element.attrs.push({
        name: PRIVATE_SCREENSHOT_SRC_PLACEHOLDER_ATTRIBUTE,
        value: placeholder,
      });
    }
    if (privateCandidates.length > 0) {
      const publicSrcset = publicCandidates
        .map(formatSrcsetCandidate)
        .join(", ");
      const safeSrcset = safeCandidates.map(formatSrcsetCandidate).join(", ");
      const existingSrcset = element.attrs.findIndex(
        (attribute) => attribute.name === "srcset",
      );
      if (existingSrcset >= 0) {
        element.attrs.splice(existingSrcset, 1);
        if (safeSrcset)
          element.attrs.push({ name: "srcset", value: safeSrcset });
      }
      element.attrs.push({
        name: PRIVATE_SCREENSHOT_SRCSET_ATTRIBUTE,
        value: JSON.stringify(privateCandidates),
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
      const sourceIndex = element.attrs.findIndex(
        (attribute) => attribute.name === PRIVATE_SCREENSHOT_ATTRIBUTE,
      );
      if (sourceIndex >= 0) {
        element.attrs = element.attrs.filter(
          (attribute) => attribute.name !== "src",
        );
      }
      const publicSrcset = element.attrs.find(
        (attribute) =>
          attribute.name === PRIVATE_SCREENSHOT_PUBLIC_SRCSET_ATTRIBUTE,
      );
      if (publicSrcset) {
        element.attrs = element.attrs.filter(
          (attribute) => attribute.name !== "srcset",
        );
        if (publicSrcset.value)
          element.attrs.push({ name: "srcset", value: publicSrcset.value });
      }
      element.attrs = element.attrs.filter(
        (attribute) =>
          attribute.name !== PRIVATE_SCREENSHOT_ATTRIBUTE &&
          attribute.name !== PRIVATE_SCREENSHOT_SRC_PLACEHOLDER_ATTRIBUTE &&
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
