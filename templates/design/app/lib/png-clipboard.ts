export type PngClipboardErrorCode = "unsupported" | "blocked" | "write-failed";

export class PngClipboardError extends Error {
  readonly code: PngClipboardErrorCode;

  constructor(code: PngClipboardErrorCode, cause?: unknown) {
    super(`PNG clipboard ${code}`);
    this.name = "PngClipboardError";
    this.code = code;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: cause,
      });
    }
  }
}

type ClipboardWriter = Pick<Clipboard, "write">;

type ClipboardItemConstructor = {
  new (items: Record<string, Blob | Promise<Blob>>): ClipboardItem;
  supports?: (type: string) => boolean;
};

export interface PngClipboardEnvironment {
  clipboard?: ClipboardWriter | null;
  ClipboardItem?: ClipboardItemConstructor | null;
}

function defaultPngClipboardEnvironment(): PngClipboardEnvironment {
  return {
    clipboard:
      typeof navigator === "undefined" ? null : (navigator.clipboard ?? null),
    ClipboardItem:
      typeof globalThis.ClipboardItem === "undefined"
        ? null
        : globalThis.ClipboardItem,
  };
}

export function canCopyPngToClipboard(
  environment: PngClipboardEnvironment = defaultPngClipboardEnvironment(),
): boolean {
  const ClipboardItemCtor = environment.ClipboardItem;
  if (!environment.clipboard?.write || !ClipboardItemCtor) return false;
  try {
    return (
      typeof ClipboardItemCtor.supports !== "function" ||
      ClipboardItemCtor.supports("image/png")
    );
  } catch {
    return false;
  }
}

function classifyClipboardWriteError(error: unknown): PngClipboardErrorCode {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "blocked";
  }
  if (name === "NotSupportedError" || error instanceof TypeError) {
    return "unsupported";
  }
  return "write-failed";
}

export async function copyPngPromiseToClipboard(
  pngBlob: Promise<Blob>,
  environment: PngClipboardEnvironment = defaultPngClipboardEnvironment(),
): Promise<void> {
  const ClipboardItemCtor = environment.ClipboardItem;
  const clipboard = environment.clipboard;
  if (!canCopyPngToClipboard(environment) || !ClipboardItemCtor || !clipboard) {
    throw new PngClipboardError("unsupported");
  }

  let renderError: unknown;
  const trackedPngBlob = pngBlob.catch((error: unknown) => {
    renderError = error;
    throw error;
  });
  void trackedPngBlob.catch(() => undefined);

  let item: ClipboardItem;
  try {
    item = new ClipboardItemCtor({ "image/png": trackedPngBlob });
  } catch (error) {
    throw new PngClipboardError("unsupported", error);
  }

  try {
    await clipboard.write([item]);
  } catch (error) {
    if (renderError !== undefined) throw renderError;
    throw new PngClipboardError(classifyClipboardWriteError(error), error);
  }
}
