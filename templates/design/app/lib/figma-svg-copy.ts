import { callAction } from "@agent-native/core/client";

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
}

export interface FigmaSvgCopyEnvironment {
  clipboard?: ClipboardWriter | null;
  ClipboardItem?: ClipboardItemConstructor | null;
  /** Injectable override for tests — defaults to the real `callAction`. */
  callExportAction?: (
    params: FigmaSvgExportParams,
  ) => Promise<FigmaSvgExportActionResult>;
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
  if (!canCopyFigmaSvgToClipboard(environment)) {
    throw new FigmaSvgCopyError("unsupported");
  }

  const callExportAction =
    environment.callExportAction ?? defaultCallExportAction;
  const clipboard = environment.clipboard;
  const ClipboardItemCtor = environment.ClipboardItem;

  let renderError: unknown;
  const exportPromise = callExportAction(params)
    .then((result) => {
      if (!result.ok || !result.svg) {
        throw new FigmaSvgCopyError(
          "render-failed",
          new Error(result.reason ?? "Figma SVG export failed"),
        );
      }
      return result as FigmaSvgExportActionResult & { svg: string };
    })
    .catch((error: unknown) => {
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
