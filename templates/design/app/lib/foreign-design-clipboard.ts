import * as cssTree from "css-tree";
import createDOMPurify from "dompurify";

import { parseRuntimeSnapshotHtml } from "@/components/design/design-canvas/element-payload";

import { editorChromeBridgeScript } from "../../.generated/bridge/editor-chrome.generated";
import type { DesignClipboardPayload } from "./design-import";

export class ForeignDesignClipboardError extends Error {
  constructor(
    readonly code:
      | "timeout"
      | "snapshot-unavailable"
      | "snapshot-too-large"
      | "resources-unavailable"
      | "unsafe-content",
  ) {
    super(`Clipboard import failed: ${code}`);
    this.name = "ForeignDesignClipboardError";
  }
}

function safeUrl(value: string): boolean {
  const compact = value.replace(/[\u0000-\u0020\u007f]+/g, "");
  return (
    !compact ||
    compact.startsWith("#") ||
    /^(?:https?:|mailto:|tel:)/i.test(compact)
  );
}

function validateForeignCss(
  css: string,
  context: "stylesheet" | "declarationList",
): void {
  try {
    const ast = cssTree.parse(css, { context, parseCustomProperty: true });
    cssTree.walk(ast, (node) => {
      if (
        (node.type === "Url" && !safeUrl(node.value)) ||
        (node.type === "Declaration" &&
          /^(?:behavior|-moz-binding)$/i.test(node.property)) ||
        (node.type === "Function" && /^expression$/i.test(node.name))
      )
        throw new ForeignDesignClipboardError("unsafe-content");
      if (
        node.type === "Atrule" &&
        node.name.toLowerCase() === "import" &&
        node.prelude
      )
        cssTree.walk(node.prelude, (part) => {
          if (part.type === "String" && !safeUrl(part.value))
            throw new ForeignDesignClipboardError("unsafe-content");
        });
    });
  } catch (error) {
    if (error instanceof ForeignDesignClipboardError) throw error;
    throw new ForeignDesignClipboardError("unsafe-content");
  }
}

/** The rendered result crosses back into an editable, same-origin document. */
export function sanitizeForeignDesignHtml(html: string): string {
  const purifier = createDOMPurify(window);
  purifier.addHook("uponSanitizeAttribute", (_node, attribute) => {
    const name = attribute.attrName.toLowerCase();
    if (
      /^(?:x-|data-x-|@|:|v-|ng-|hx-|data-hx-|data-source-|data-agent-native-runtime-|data-an-runtime-)/.test(
        name,
      ) ||
      [
        "autofocus",
        "action",
        "formaction",
        "data-loc",
        "data-builder-id",
      ].includes(name)
    )
      attribute.keepAttr = false;
  });
  const cleaned = purifier.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style", "link"],
    FORBID_TAGS: [
      "template",
      "iframe",
      "object",
      "embed",
      "base",
      "meta",
      "foreignObject",
      "animate",
      "set",
    ],
    FORBID_ATTR: ["srcdoc"],
  });
  const parsed = new DOMParser().parseFromString(cleaned, "text/html");
  if (
    parsed.documentElement.hasAttribute(
      "data-agent-native-export-resource-failures",
    )
  )
    throw new ForeignDesignClipboardError("resources-unavailable");
  for (const node of [
    parsed.documentElement,
    ...Array.from(parsed.querySelectorAll("*")),
  ]) {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        ["src", "href", "xlink:href", "poster", "background"].includes(name) &&
        !safeUrl(attribute.value)
      ) {
        throw new ForeignDesignClipboardError("unsafe-content");
      } else if (name === "srcset") {
        if (
          !attribute.value
            .split(",")
            .every((candidate) =>
              safeUrl(candidate.trim().split(/\s+/)[0] ?? ""),
            )
        )
          throw new ForeignDesignClipboardError("unsafe-content");
      }
    }
    const style = node.getAttribute("style");
    if (style !== null) validateForeignCss(style, "declarationList");
  }
  for (const style of Array.from(parsed.querySelectorAll("style")))
    validateForeignCss(style.textContent, "stylesheet");
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

function snapshotBridge(): string {
  let bridge = editorChromeBridgeScript;
  for (const [token, value] of Object.entries({
    __READ_ONLY__: "true",
    __TEXT_EDITING_ENABLED__: "false",
    __EDITOR_CHROME_SCALE_X__: "1",
    __EDITOR_CHROME_SCALE_Y__: "1",
    __DESIGN_CANVAS_SCREEN_ID__: JSON.stringify("clipboard-import"),
    __DESIGN_CANVAS_BOARD_SURFACE__: "false",
    __DESIGN_CANVAS_CONTENT_OFFSET_X__: "0",
    __DESIGN_CANVAS_CONTENT_OFFSET_Y__: "0",
    __RUNTIME_LAYER_SNAPSHOT_ENABLED__: "false",
    __LIVE_REFLOW_ENABLED__: "false",
    __SELECTED_LAYER_DRAG_PRIORITY__: "false",
    __INITIAL_SOURCE_HEAD__: '""',
    __INITIAL_SOURCE_OWNERSHIP__: '""',
  }))
    bridge = bridge.split(token).join(value);
  return bridge;
}

type ClipboardImageUpload = (file: File) => Promise<string>;

async function persistSnapshotResources(
  html: string,
  resources: unknown,
  uploadImage?: ClipboardImageUpload,
): Promise<string> {
  if (resources === undefined) return html;
  if (!Array.isArray(resources) || resources.length > 32)
    throw new ForeignDesignClipboardError("resources-unavailable");
  const doc = new DOMParser().parseFromString(html, "text/html");
  let bytes = 0;
  for (const raw of resources) {
    if (!raw || typeof raw !== "object")
      throw new ForeignDesignClipboardError("resources-unavailable");
    const resource = raw as { id?: unknown; blob?: unknown };
    if (
      typeof resource.id !== "string" ||
      !/^canvas-\d+$/.test(resource.id) ||
      !(resource.blob instanceof Blob) ||
      resource.blob.type !== "image/png" ||
      resource.blob.size > 2_000_000
    )
      throw new ForeignDesignClipboardError("resources-unavailable");
    bytes += resource.blob.size;
    if (bytes > 8_000_000)
      throw new ForeignDesignClipboardError("snapshot-too-large");
    const images = Array.from(doc.querySelectorAll("img")).filter(
      (image) =>
        image.getAttribute("src") ===
        `agent-native-clipboard-resource:${resource.id}`,
    );
    if (images.length !== 1 || !uploadImage)
      throw new ForeignDesignClipboardError("resources-unavailable");
    const signature = new Uint8Array(
      await resource.blob.slice(0, 8).arrayBuffer(),
    );
    if (signature.join(",") !== "137,80,78,71,13,10,26,10")
      throw new ForeignDesignClipboardError("unsafe-content");
    const url = await uploadImage(
      new File([resource.blob], `${resource.id}.png`, { type: "image/png" }),
    );
    if (!url) throw new ForeignDesignClipboardError("resources-unavailable");
    let durableUrl: URL;
    try {
      durableUrl = new URL(url, window.location.origin);
    } catch {
      throw new ForeignDesignClipboardError("resources-unavailable");
    }
    if (!/^https?:$/.test(durableUrl.protocol))
      throw new ForeignDesignClipboardError("resources-unavailable");
    for (const image of images) image.setAttribute("src", durableUrl.href);
  }
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export async function renderForeignDesignScreen(
  html: string,
  width = 1440,
  height = 1024,
  uploadImage?: ClipboardImageUpload,
): Promise<string> {
  const source = new DOMParser().parseFromString(html, "text/html");
  source
    .querySelectorAll("base,meta[http-equiv]")
    .forEach((node) => node.remove());
  const policy = source.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  source.head.prepend(policy);
  const script = source.createElement("script");
  script.textContent = (
    snapshotBridge() +
    `
window.addEventListener("load", async function () {
  try {
    var nextFrame = function () { return new Promise(function (resolve) { requestAnimationFrame(resolve); }); };
    await nextFrame(); await nextFrame();
    if (document.fonts) await document.fonts.ready;
    var settledImages = new Set();
    while (true) {
      var images = Array.from(document.images).filter(function (image) { return !settledImages.has(image); });
      if (!images.length) break;
      images.forEach(function (image) { image.loading = "eager"; });
      await Promise.all(images.map(async function (image) {
        if (!image.currentSrc && !image.getAttribute("src") && !image.getAttribute("srcset")) { settledImages.add(image); return; }
        if (!image.complete) await new Promise(function (resolve, reject) {
          var loaded = function () { image.removeEventListener("error", failed); resolve(); };
          var failed = function () { image.removeEventListener("load", loaded); reject(new Error("Image unavailable")); };
          image.addEventListener("load", loaded, { once: true });
          image.addEventListener("error", failed, { once: true });
        });
        if (!image.naturalWidth) throw new Error("Image unavailable");
        if (image.decode) await image.decode();
        settledImages.add(image);
      }));
      await nextFrame(); await nextFrame();
    }
    var opacityAnimations = function () { return document.getAnimations().filter(function (animation) {
      var effect = animation.effect;
      return effect && effect.getKeyframes && Number.isFinite(effect.getComputedTiming().endTime) && animation.playState !== "finished" && animation.playState !== "idle" && effect.getKeyframes().some(function (frame) { return frame.opacity !== undefined; });
    }); };
    while (opacityAnimations().length) {
      await Promise.all(opacityAnimations().map(function (animation) { return animation.finished.catch(function (error) { if (error.name !== "AbortError") throw error; }); }));
      await nextFrame();
    }
    window.parent.postMessage({ type: "agent-native:clipboard-render-ready" }, "*");
  } catch (error) {
    window.parent.postMessage({ type: "agent-native:clipboard-render-error" }, "*");
  }
}, { once: true });`
  ).replace(/<\/script/gi, "<\\/script");
  source.body.append(script);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("aria-hidden", "true");
  // Off-viewport opaque frames suspend animation frames needed to finish rendering.
  iframe.style.cssText = `position:fixed;left:0;top:0;opacity:0;z-index:-2147483648;border:0;pointer-events:none;width:${Math.min(10000, Math.max(1, width))}px;height:${Math.min(10000, Math.max(1, height))}px`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listener: ((event: MessageEvent) => void) | undefined;
  let snapshotReceived = false;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new ForeignDesignClipboardError("timeout")),
        30000,
      );
      listener = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.origin !== "null")
          return;
        const rawData: unknown = event.data;
        if (!rawData || typeof rawData !== "object" || Array.isArray(rawData))
          return;
        const data = rawData as {
          type?: string;
          requestId?: number;
          documentId?: string;
          payload?: { html?: unknown; reason?: string; resources?: unknown };
        };
        if (data.type === "agent-native:clipboard-render-error") {
          reject(new ForeignDesignClipboardError("resources-unavailable"));
        } else if (data.type === "agent-native:clipboard-render-ready") {
          iframe.contentWindow?.postMessage(
            {
              type: "request-runtime-layer-snapshot",
              resourceMode: "references",
            },
            "*",
          );
        } else if (
          data.type ===
          "agent-native:runtime-layer-snapshot-reservation-request"
        ) {
          iframe.contentWindow?.postMessage(
            {
              type: "grant-runtime-layer-snapshot-reservation",
              requestId: data.requestId,
              documentId: data.documentId,
            },
            "*",
          );
        } else if (data.type === "agent-native:runtime-layer-snapshot-error") {
          reject(
            new ForeignDesignClipboardError(
              data.payload?.reason === "snapshot-too-large"
                ? "snapshot-too-large"
                : "snapshot-unavailable",
            ),
          );
        } else if (data.type === "agent-native:runtime-layer-snapshot") {
          const snapshot = parseRuntimeSnapshotHtml(data.payload?.html);
          if (!snapshot.ok) {
            reject(new ForeignDesignClipboardError(snapshot.reason));
            return;
          }
          if (snapshotReceived) return;
          snapshotReceived = true;
          void persistSnapshotResources(
            snapshot.html,
            data.payload?.resources,
            uploadImage,
          )
            .then((html) => resolve(sanitizeForeignDesignHtml(html)))
            .catch(reject);
        }
      };
      window.addEventListener("message", listener);
      iframe.srcdoc = `<!doctype html>\n${source.documentElement.outerHTML}`;
      document.body.append(iframe);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener) window.removeEventListener("message", listener);
    iframe.remove();
  }
}

export async function prepareForeignDesignClipboard(
  payload: DesignClipboardPayload,
  uploadImage?: ClipboardImageUpload,
): Promise<DesignClipboardPayload> {
  const namespace = `clipboard-${crypto.randomUUID()}`;
  const sourceFiles = new Map<string, string>();
  const entries = payload.entries.map((entry) => {
    let sourceFileId = sourceFiles.get(entry.sourceFileId);
    if (!sourceFileId) {
      sourceFileId = `${namespace}-${sourceFiles.size}`;
      sourceFiles.set(entry.sourceFileId, sourceFileId);
    }
    for (const declaration of [
      ...(entry.managedStyleSnapshot?.breakpoints ?? []),
      ...(entry.managedStyleSnapshot?.interactionStates ?? []),
    ])
      validateForeignCss(
        `${declaration.property}:${declaration.value}`,
        "declarationList",
      );
    const documentHtml = sanitizeForeignDesignHtml(entry.html);
    const doc = new DOMParser().parseFromString(documentHtml, "text/html");
    const portableStyleSnapshot = entry.portableStyleSnapshot
      ? {
          ...entry.portableStyleSnapshot,
          nodes: entry.portableStyleSnapshot.nodes.map((node) => {
            for (const [property, value] of Object.entries(node.styles))
              validateForeignCss(`${property}:${value}`, "declarationList");
            return node;
          }),
        }
      : undefined;
    const detachedEntry = { ...entry };
    delete detachedEntry.sourceParentNodeId;
    return {
      ...detachedEntry,
      html: doc.body.innerHTML,
      sourceFileId,
      ...(portableStyleSnapshot ? { portableStyleSnapshot } : {}),
    };
  });
  const screens = [];
  for (const screen of payload.screens ?? []) {
    const detachedScreen = { ...screen };
    delete detachedScreen.sourceScreenId;
    screens.push({
      ...detachedScreen,
      content: await renderForeignDesignScreen(
        screen.content,
        screen.canvasFrame?.width,
        screen.canvasFrame?.height,
        uploadImage,
      ),
    });
  }
  return { version: 1, entries, ...(payload.screens ? { screens } : {}) };
}
