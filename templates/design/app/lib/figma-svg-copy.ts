import { callAction } from "@agent-native/core/client/hooks";

import {
  buildFigmaSvgDocument,
  collectRawFigmaSvgScene,
  hydrateRawFigmaSvgNode,
  safeFigmaSvgFilename,
} from "../../shared/figma-svg-scene.js";

export type FigmaSvgCopyErrorCode =
  | "unsupported"
  | "blocked"
  | "write-failed"
  | "render-failed";

export class FigmaSvgCopyError extends Error {
  readonly code: FigmaSvgCopyErrorCode;

  constructor(code: FigmaSvgCopyErrorCode, cause?: unknown) {
    super(`Figma SVG copy ${code}`);
    this.name = "FigmaSvgCopyError";
    this.code = code;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: cause,
      });
    }
  }
}

type ClipboardWriter = Pick<Clipboard, "write"> & {
  writeText?: Clipboard["writeText"];
};

type ClipboardItemConstructor = {
  new (items: Record<string, Blob | Promise<Blob>>): ClipboardItem;
  supports?: (type: string) => boolean;
};

export interface FigmaSvgExportActionResult {
  ok: boolean;
  reason?: string;
  svg?: string;
  filename?: string;
  report?: unknown;
}

export interface FigmaSvgExportParams {
  designId?: string;
  fileId?: string;
  filename?: string;
  nodeId?: string;
  embedImages?: boolean;
  width?: number;
  height?: number;
}

export interface LiveFigmaSvgSource {
  /** The already-rendered preview document. Geometry comes from this live DOM. */
  document: Document;
  /** Optional explicit root. Defaults to nodeId, then document.body. */
  root?: Element | null;
  /** Stored screen geometry wins over a transient iframe viewport when supplied. */
  width?: number | null;
  height?: number | null;
  title?: string | null;
}

export interface LiveFigmaSvgSnapshot {
  /** Script-free runtime snapshot supplied by the localhost editor bridge. */
  html: string;
  width?: number | null;
  height?: number | null;
  title?: string | null;
}

export interface FigmaSvgCopyEnvironment {
  clipboard?: ClipboardWriter | null;
  ClipboardItem?: ClipboardItemConstructor | null;
  /** Injectable override for tests — defaults to the real `callAction`. */
  callExportAction?: (
    params: FigmaSvgExportParams,
  ) => Promise<FigmaSvgExportActionResult>;
  /**
   * Prefer the browser's already-rendered iframe DOM. This works in hosted and
   * serverless deployments without shipping Chromium and preserves live Alpine
   * state, loaded fonts, responsive layout, and unsaved visual-edit previews.
   */
  liveSource?: LiveFigmaSvgSource | null;
  /** Cross-origin localhost fallback captured by the trusted editor bridge. */
  liveSnapshot?: LiveFigmaSvgSnapshot | null;
}

const MAX_CLIENT_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
const CLIENT_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function queryNodeById(doc: Document, nodeId: string): Element | null {
  for (const element of Array.from(
    doc.querySelectorAll("[data-agent-native-node-id]"),
  )) {
    if (element.getAttribute("data-agent-native-node-id") === nodeId) {
      return element;
    }
  }
  return null;
}

function liveSvgRoot(source: LiveFigmaSvgSource, nodeId?: string): Element {
  if (nodeId) {
    const selected = queryNodeById(source.document, nodeId);
    if (!selected) {
      throw new Error(`The selected live layer "${nodeId}" no longer exists`);
    }
    return selected;
  }
  const root = source.root ?? source.document.body;
  if (!root)
    throw new Error("The live preview has no renderable document body");
  return root;
}

/**
 * Serialize the already-laid-out iframe DOM to genuine SVG primitives through
 * the SAME pipeline the server's Playwright exporter runs
 * (`shared/figma-svg-scene.ts`): walk the live DOM into a raw scene, hydrate
 * it, serialize it. This used to be an independent DOM walker and serializer,
 * and it drifted — every fidelity fix (text-transform, gradient stop
 * premultiplication, userSpaceOnUse gradients, per-side borders, rotation
 * matrices, overflow clipping, untransformed box sizes) landed on the server
 * path while this one, the path the editor's "Copy as SVG" actually uses,
 * kept its first-draft approximations. There is one implementation now.
 *
 * Still deliberately emits no foreignObject: Figma imports the result as
 * editable rectangles, text, images, and native SVG paths, not one opaque blob.
 */
export function buildFigmaSvgFromLiveDocument(
  source: LiveFigmaSvgSource,
  nodeId?: string,
): FigmaSvgExportActionResult & { svg: string } {
  const doc = source.document;
  if (!doc.defaultView)
    throw new Error("The live preview is not attached to a window");
  const root = liveSvgRoot(source, nodeId);
  const scene = collectRawFigmaSvgScene(null, root);
  if (!scene)
    throw new Error("The live preview has no visible exportable layers");
  const node = hydrateRawFigmaSvgNode(scene.root);

  // The scene root's own rect is the honest exported bounds (x=0/y=0 by
  // construction), but a stored screen size wins when the caller supplies one:
  // the live preview iframe may be showing a transient viewport.
  const isDocumentRoot = root === doc.body || root === doc.documentElement;
  const width = positive(source.width)
    ? source.width
    : Math.max(
        1,
        node.rect.width,
        isDocumentRoot ? doc.documentElement.scrollWidth : 0,
        isDocumentRoot ? (doc.body?.scrollWidth ?? 0) : 0,
      );
  const height = positive(source.height)
    ? source.height
    : Math.max(
        1,
        node.rect.height,
        isDocumentRoot ? doc.documentElement.scrollHeight : 0,
        isDocumentRoot ? (doc.body?.scrollHeight ?? 0) : 0,
      );

  const { svg, report } = buildFigmaSvgDocument({
    width,
    height,
    title: source.title,
    root: node,
  });
  return {
    ok: true,
    svg,
    filename: safeFigmaSvgFilename(source.title),
    report: {
      source: "live-dom",
      ...report,
      // The server path screenshots what it cannot vectorize; a browser tab
      // cannot, so say so instead of shipping an <image> with an empty href.
      warnings: report.rasterized.length
        ? [
            ...report.warnings,
            "Some elements (video, canvas, iframe, or backdrop-filter) have no SVG equivalent and could not be rasterized from the live preview.",
          ]
        : report.warnings,
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function embedLiveSvgImages(
  result: FigmaSvgExportActionResult & { svg: string },
): Promise<FigmaSvgExportActionResult & { svg: string }> {
  const parsed = new DOMParser().parseFromString(result.svg, "image/svg+xml");
  if (parsed.querySelector("parsererror")) return result;
  const omitted: Array<{ node: string; reason: string }> = [];
  await Promise.all(
    Array.from(parsed.querySelectorAll("image")).map(async (image) => {
      const href =
        image.getAttribute("href") || image.getAttribute("xlink:href");
      if (!href || !/^https?:\/\//i.test(href)) return;
      try {
        const response = await fetch(href, {
          credentials: "omit",
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
        });
        const mimeType = (response.headers.get("content-type") || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        const contentLength = Number(
          response.headers.get("content-length") || 0,
        );
        if (
          !response.ok ||
          !CLIENT_IMAGE_MIME_TYPES.has(mimeType) ||
          (Number.isFinite(contentLength) &&
            contentLength > MAX_CLIENT_EMBEDDED_IMAGE_BYTES)
        ) {
          throw new Error("image response was not safe to embed");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_CLIENT_EMBEDDED_IMAGE_BYTES) {
          throw new Error("image exceeded the embed size limit");
        }
        image.setAttribute(
          "href",
          `data:${mimeType};base64,${bytesToBase64(bytes)}`,
        );
        image.removeAttribute("xlink:href");
      } catch {
        // Do not persist an expiring Figma CDN URL in a supposedly self-
        // contained artifact. A missing image is explicit in the report and
        // safer than an export that silently breaks hours later.
        omitted.push({
          node: image.getAttribute("id") || "image",
          reason: "Remote image could not be safely embedded",
        });
        image.remove();
      }
    }),
  );
  const report =
    result.report && typeof result.report === "object"
      ? (result.report as Record<string, unknown>)
      : {};
  const previousOmitted = Array.isArray(report.omitted) ? report.omitted : [];
  const previousWarnings = Array.isArray(report.warnings)
    ? report.warnings
    : [];
  return {
    ...result,
    svg: new XMLSerializer().serializeToString(parsed.documentElement),
    report: {
      ...report,
      omitted: [...previousOmitted, ...omitted],
      warnings:
        omitted.length > 0
          ? [
              ...previousWarnings,
              "One or more remote images were omitted because they could not be safely embedded.",
            ]
          : previousWarnings,
    },
  };
}

/**
 * Defense-in-depth sanitizer for cross-origin runtime snapshots. The bridge
 * already strips active content before posting; this receiver repeats the
 * policy before assigning srcdoc so a forged/stale message is still inert.
 */
export function sanitizeLiveFigmaSvgSnapshotHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed
    .querySelectorAll(
      "script,iframe,object,embed,base,link,meta,template,noscript,foreignObject,video,audio,source,track,animate,set",
    )
    .forEach((node) => node.remove());
  for (const node of [
    parsed.documentElement,
    ...Array.from(parsed.querySelectorAll("*")),
  ]) {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        name === "autofocus" ||
        name === "action" ||
        name === "formaction" ||
        /javascript\s*:/i.test(attribute.value)
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  }
  let head = parsed.head;
  if (!head) {
    head = parsed.createElement("head");
    parsed.documentElement.prepend(head);
  }
  const csp = parsed.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute(
    "content",
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
  head.prepend(csp);
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

export function prepareLiveFigmaSvgSnapshotFrame(
  iframe: HTMLIFrameElement,
  snapshot: LiveFigmaSvgSnapshot,
): void {
  iframe.setAttribute("aria-hidden", "true");
  // allow-same-origin keeps contentDocument readable; deliberately omit
  // allow-scripts, allow-forms, allow-popups, and allow-top-navigation.
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.tabIndex = -1;
  iframe.style.cssText =
    "position:fixed;inset:auto auto -100000px -100000px;visibility:hidden;pointer-events:none;border:0";
  iframe.style.width = `${positive(snapshot.width) ? snapshot.width : 1440}px`;
  iframe.style.height = `${positive(snapshot.height) ? snapshot.height : 1200}px`;
  iframe.srcdoc = sanitizeLiveFigmaSvgSnapshotHtml(snapshot.html);
}

async function buildFigmaSvgFromLiveSnapshot(
  snapshot: LiveFigmaSvgSnapshot,
  nodeId?: string,
): Promise<FigmaSvgExportActionResult & { svg: string }> {
  if (typeof document === "undefined") {
    throw new Error("Live snapshot rendering requires a browser document");
  }
  const iframe = document.createElement("iframe");
  prepareLiveFigmaSvgSnapshotFrame(iframe, snapshot);
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Live export snapshot timed out")),
        3_000,
      );
      iframe.addEventListener(
        "load",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    const doc = iframe.contentDocument;
    if (!doc?.documentElement) throw new Error("Live snapshot did not render");
    return buildFigmaSvgFromLiveDocument(
      {
        document: doc,
        width: snapshot.width,
        height: snapshot.height,
        title: snapshot.title,
      },
      nodeId,
    );
  } finally {
    iframe.remove();
  }
}

function defaultFigmaSvgCopyEnvironment(): FigmaSvgCopyEnvironment {
  return {
    clipboard:
      typeof navigator === "undefined" ? null : (navigator.clipboard ?? null),
    ClipboardItem:
      typeof globalThis.ClipboardItem === "undefined"
        ? null
        : globalThis.ClipboardItem,
  };
}

function defaultCallExportAction(
  params: FigmaSvgExportParams,
): Promise<FigmaSvgExportActionResult> {
  // Same cast-to-loose-signature pattern as design-save-outbox.ts's
  // `invokeAction` default: the action registry's generated `ActionName`
  // union doesn't need to be threaded through this small client module.
  return (
    callAction as (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<FigmaSvgExportActionResult>
  )("export-design-as-figma-svg", params as unknown as Record<string, unknown>);
}

export function canCopyFigmaSvgToClipboard(
  environment: FigmaSvgCopyEnvironment = defaultFigmaSvgCopyEnvironment(),
): boolean {
  // `text/plain` (the proven Figma-paste MIME — see the export-handoff skill's
  // "Export to Figma (SVG)" section) only needs a plain `clipboard.write` or
  // `writeText`; ClipboardItem is optional (only gates the extra
  // `image/svg+xml` representation).
  return Boolean(
    (environment.clipboard?.write && environment.ClipboardItem) ||
    environment.clipboard?.writeText,
  );
}

function supportsClipboardType(
  ClipboardItemCtor: ClipboardItemConstructor,
  type: string,
): boolean {
  try {
    return (
      typeof ClipboardItemCtor.supports !== "function" ||
      ClipboardItemCtor.supports(type)
    );
  } catch {
    return false;
  }
}

function classifyClipboardWriteError(error: unknown): FigmaSvgCopyErrorCode {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "NotSupportedError" || error instanceof TypeError)
    return "unsupported";
  return "write-failed";
}

export interface FigmaSvgCopyResult {
  filename: string;
  report: unknown;
}

function actionParams(params: FigmaSvgExportParams): FigmaSvgExportParams {
  return {
    ...(params.designId ? { designId: params.designId } : {}),
    ...(params.fileId ? { fileId: params.fileId } : {}),
    ...(params.filename ? { filename: params.filename } : {}),
    ...(params.nodeId ? { nodeId: params.nodeId } : {}),
    ...(params.embedImages !== undefined
      ? { embedImages: params.embedImages }
      : {}),
    ...(positive(params.width) ? { width: params.width } : {}),
    ...(positive(params.height) ? { height: params.height } : {}),
  };
}

/**
 * Prefer a synchronous live-DOM conversion and retain the action as a fallback
 * for agent calls, non-rendered screens, and browsers that cannot expose the
 * preview document. The live path is what makes exports hosted/serverless-safe.
 */
export async function exportDesignAsFigmaSvg(
  params: FigmaSvgExportParams,
  environment: FigmaSvgCopyEnvironment = defaultFigmaSvgCopyEnvironment(),
): Promise<FigmaSvgExportActionResult & { svg: string }> {
  if (environment.liveSource) {
    try {
      const result = buildFigmaSvgFromLiveDocument(
        environment.liveSource,
        params.nodeId,
      );
      return params.embedImages === false
        ? result
        : await embedLiveSvgImages(result);
    } catch {
      // A detached/cross-origin preview may become unreadable between the menu
      // opening and activation. The authenticated action remains the fallback.
    }
  }
  if (environment.liveSnapshot) {
    try {
      const result = await buildFigmaSvgFromLiveSnapshot(
        environment.liveSnapshot,
        params.nodeId,
      );
      return params.embedImages === false
        ? result
        : await embedLiveSvgImages(result);
    } catch {
      // Snapshot may have expired during a dev-server HMR replacement.
    }
  }
  const callExportAction =
    environment.callExportAction ?? defaultCallExportAction;
  const result = await callExportAction(actionParams(params));
  if (!result.ok || !result.svg) {
    throw new FigmaSvgCopyError(
      "render-failed",
      new Error(result.reason ?? "Figma SVG export failed"),
    );
  }
  return result as FigmaSvgExportActionResult & { svg: string };
}

/**
 * Exports a design screen (or a selected element's subtree via `nodeId`) as
 * a genuinely vector SVG through the `export-design-as-figma-svg` action,
 * then writes it to the system clipboard as BOTH:
 *
 *   - `text/plain` — the raw SVG markup. This is the MIME Figma's own paste
 *     handler reads for "paste as vector shapes"; a `image/svg+xml`-only
 *     clipboard write is NOT enough on its own for a reliable Figma paste.
 *   - `image/svg+xml` — the same markup as a typed image representation,
 *     for any other paste target that specifically requests SVG images.
 *
 * Call this from a user-gesture handler (e.g. a context-menu "Copy as SVG"
 * item) — `clipboard.write` requires transient activation in most browsers,
 * the same reason `copyPngPromiseToClipboard` in `png-clipboard.ts` is
 * gesture-scoped.
 */
export async function copyDesignAsFigmaSvg(
  params: FigmaSvgExportParams,
  environment: FigmaSvgCopyEnvironment = defaultFigmaSvgCopyEnvironment(),
): Promise<FigmaSvgCopyResult> {
  // Callers normally provide only a liveSource/liveSnapshot. Preserve the real
  // browser clipboard defaults instead of treating that partial override as a
  // complete environment (which made the hosted live-DOM path always report
  // "unsupported" despite navigator.clipboard being available).
  const resolvedEnvironment = {
    ...defaultFigmaSvgCopyEnvironment(),
    ...environment,
  };
  if (!canCopyFigmaSvgToClipboard(resolvedEnvironment)) {
    throw new FigmaSvgCopyError("unsupported");
  }

  const clipboard = resolvedEnvironment.clipboard;
  const ClipboardItemCtor = resolvedEnvironment.ClipboardItem;

  let renderError: unknown;
  const exportPromise = exportDesignAsFigmaSvg(
    params,
    resolvedEnvironment,
  ).catch((error: unknown) => {
    renderError =
      error instanceof FigmaSvgCopyError
        ? error
        : new FigmaSvgCopyError("render-failed", error);
    throw renderError;
  });
  // ClipboardItem owns the promises below in real browsers. Keep a separate
  // observer so test doubles or an early clipboard rejection cannot surface an
  // unhandled action/render rejection.
  void exportPromise.catch(() => undefined);

  try {
    if (clipboard?.write && ClipboardItemCtor) {
      // Call clipboard.write while the initiating click/key event still owns
      // transient activation. ClipboardItem deliberately receives pending
      // Blob promises, matching the proven PNG clipboard path; awaiting the
      // server render first makes slow exports fail in Safari and hardened
      // Chromium even though the user invoked the command correctly.
      const textBlobPromise = exportPromise.then(
        (result) => new Blob([result.svg], { type: "text/plain" }),
      );
      void textBlobPromise.catch(() => undefined);
      const items: Record<string, Blob | Promise<Blob>> = {
        "text/plain": textBlobPromise,
      };
      if (supportsClipboardType(ClipboardItemCtor, "image/svg+xml")) {
        const svgBlobPromise = exportPromise.then(
          (result) => new Blob([result.svg], { type: "image/svg+xml" }),
        );
        void svgBlobPromise.catch(() => undefined);
        items["image/svg+xml"] = svgBlobPromise;
      }
      await clipboard.write([new ClipboardItemCtor(items)]);
    } else if (clipboard?.writeText) {
      // No ClipboardItem constructor available — still deliver the SVG
      // markup as text/plain, which is the proven Figma-paste path anyway.
      const result = await exportPromise;
      await clipboard.writeText(result.svg);
    } else {
      throw new FigmaSvgCopyError("unsupported");
    }
  } catch (error) {
    if (error instanceof FigmaSvgCopyError) throw error;
    if (renderError !== undefined) throw renderError;
    throw new FigmaSvgCopyError(classifyClipboardWriteError(error), error);
  }

  const result = await exportPromise;

  return {
    filename: result.filename ?? "design-figma.svg",
    report: result.report,
  };
}
