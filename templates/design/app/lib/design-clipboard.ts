import {
  type DesignClipboardPayload,
  parseDesignClipboardMarker,
} from "./design-import";
import { extractSvgMarkup } from "./svg-paste";

interface ClipboardItemLike {
  types: readonly string[];
  getType(type: string): Promise<Blob>;
}

interface ClipboardLike {
  read?: () => Promise<ClipboardItemLike[]>;
  readText?: () => Promise<string>;
  write?: (items: ClipboardItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

interface ClipboardItemConstructor {
  new (items: Record<string, Blob>): ClipboardItem;
  supports?: (type: string) => boolean;
}

export interface DesignClipboardEnvironment {
  clipboard?: ClipboardLike | null;
  ClipboardItem?: ClipboardItemConstructor | null;
  legacyCopy?: (representations: DesignClipboardRepresentations) => boolean;
  preferLegacyCopy?: boolean;
  trustToken?: string | null;
}

export interface DesignClipboardRepresentations {
  plainText: string;
  html: string;
}

export interface ReadDesignClipboardPayload {
  payload: DesignClipboardPayload;
  markerText: string;
  plainText: string;
}

export type ReadDesignClipboardPayloadFromSystemResult =
  | { status: "found"; value: ReadDesignClipboardPayload }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "unreadable"; errors: unknown[] };

function browserClipboardEnvironment(): DesignClipboardEnvironment {
  return {
    clipboard:
      typeof navigator === "undefined" ? null : (navigator.clipboard ?? null),
    ClipboardItem:
      typeof globalThis.ClipboardItem === "undefined"
        ? null
        : globalThis.ClipboardItem,
    legacyCopy:
      typeof document === "undefined" ||
      typeof document.execCommand !== "function"
        ? undefined
        : (representations) => {
            let wroteRepresentations = false;
            const handleCopy = (event: ClipboardEvent) => {
              if (!event.clipboardData) return;
              event.clipboardData.setData(
                "text/plain",
                representations.plainText,
              );
              event.clipboardData.setData("text/html", representations.html);
              event.preventDefault();
              wroteRepresentations = true;
            };
            document.addEventListener("copy", handleCopy, {
              capture: true,
              once: true,
            });
            try {
              return document.execCommand("copy") && wroteRepresentations;
            } finally {
              document.removeEventListener("copy", handleCopy, true);
            }
          },
    preferLegacyCopy: true,
    trustToken: getDesignClipboardTrustToken(),
  };
}

const DESIGN_CLIPBOARD_TRUST_TOKEN_KEY =
  "agent-native.design.clipboard-trust-token.v1";

export function getDesignClipboardTrustToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(
      DESIGN_CLIPBOARD_TRUST_TOKEN_KEY,
    );
    if (existing) return existing;
    const token = globalThis.crypto.randomUUID();
    window.localStorage.setItem(DESIGN_CLIPBOARD_TRUST_TOKEN_KEY, token);
    return token;
  } catch {
    // coercion-ok: storage denial disables the trust token, so external marker parsing fails closed.
    return null;
  }
}

function supportsClipboardType(
  ClipboardItemCtor: ClipboardItemConstructor,
  type: string,
): boolean {
  return (
    typeof ClipboardItemCtor.supports !== "function" ||
    ClipboardItemCtor.supports(type)
  );
}

export async function writeDesignClipboard(
  representations: DesignClipboardRepresentations,
  environment: DesignClipboardEnvironment = browserClipboardEnvironment(),
): Promise<void> {
  const clipboard = environment.clipboard;
  const ClipboardItemCtor = environment.ClipboardItem;
  let richWriteError: unknown;

  if (
    environment.preferLegacyCopy &&
    environment.legacyCopy?.(representations)
  ) {
    return;
  }

  if (
    clipboard?.write &&
    ClipboardItemCtor &&
    supportsClipboardType(ClipboardItemCtor, "text/plain") &&
    supportsClipboardType(ClipboardItemCtor, "text/html")
  ) {
    try {
      await clipboard.write([
        new ClipboardItemCtor({
          "text/plain": new Blob([representations.plainText], {
            type: "text/plain",
          }),
          "text/html": new Blob([representations.html], {
            type: "text/html",
          }),
        }),
      ]);
      return;
    } catch (error) {
      richWriteError = error;
    }
  }

  if (environment.legacyCopy?.(representations)) return;

  if (!clipboard?.writeText) {
    if (richWriteError) throw richWriteError;
    throw new Error("Clipboard writing is not supported");
  }
  await clipboard.writeText(representations.plainText);
}

export function readDesignClipboardPayloadFromDataTransfer(
  clipboardData: Pick<DataTransfer, "getData"> | null | undefined,
  environment: Pick<
    DesignClipboardEnvironment,
    "trustToken"
  > = browserClipboardEnvironment(),
): ReadDesignClipboardPayload | null {
  if (!clipboardData) return null;
  const plainText = clipboardData.getData("text/plain") ?? "";
  for (const markerText of [
    clipboardData.getData("text/html") ?? "",
    plainText,
  ]) {
    const payload = parseDesignClipboardMarker(
      markerText,
      environment.trustToken,
    );
    if (payload) return { payload, markerText, plainText };
  }
  return null;
}

export async function readDesignClipboardPayloadFromSystem(
  environment: DesignClipboardEnvironment = browserClipboardEnvironment(),
): Promise<ReadDesignClipboardPayloadFromSystemResult> {
  const clipboard = environment.clipboard;
  if (!clipboard) return { status: "unavailable" };

  const errors: unknown[] = [];

  if (clipboard.read) {
    try {
      const items = await clipboard.read();
      for (const item of items) {
        const plainText = item.types.includes("text/plain")
          ? await (await item.getType("text/plain")).text()
          : "";
        for (const type of ["text/html", "text/plain"]) {
          if (!item.types.includes(type)) continue;
          const markerText = await (await item.getType(type)).text();
          const payload = parseDesignClipboardMarker(
            markerText,
            environment.trustToken,
          );
          if (payload) {
            return {
              status: "found",
              value: { payload, markerText, plainText },
            };
          }
        }
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (!clipboard.readText) {
    return errors.length > 0
      ? { status: "unreadable", errors }
      : { status: "empty" };
  }
  try {
    const markerText = await clipboard.readText();
    const payload = parseDesignClipboardMarker(
      markerText,
      environment.trustToken,
    );
    return payload
      ? {
          status: "found",
          value: { payload, markerText, plainText: markerText },
        }
      : { status: "empty" };
  } catch (error) {
    errors.push(error);
    return { status: "unreadable", errors };
  }
}

export interface SystemClipboardContents {
  design: ReadDesignClipboardPayload | null;
  files: File[];
  readErrors?: unknown[];
}

export async function readSystemClipboard(
  environment: DesignClipboardEnvironment = browserClipboardEnvironment(),
): Promise<SystemClipboardContents | null> {
  const clipboard = environment.clipboard;
  if (!clipboard?.read) {
    const result = await readDesignClipboardPayloadFromSystem(environment);
    if (result.status === "found") {
      return { design: result.value, files: [] };
    }
    return result.status === "empty" ? { design: null, files: [] } : null;
  }
  let items: ClipboardItemLike[];
  try {
    items = await clipboard.read();
    // coercion-ok: null is "unreadable" (denied), distinct from an empty clipboard
  } catch {
    return null;
  }
  let design: ReadDesignClipboardPayload | null = null;
  const files: File[] = [];
  const readErrors: unknown[] = [];
  for (const item of items) {
    try {
      const text = async (type: string) => {
        if (!item.types.includes(type)) return "";
        try {
          return await (await item.getType(type)).text();
        } catch (error) {
          readErrors.push(error);
          return "";
        }
      };
      const plainText = await text("text/plain");
      for (const markerText of [await text("text/html"), plainText]) {
        const payload = parseDesignClipboardMarker(
          markerText,
          environment.trustToken,
        );
        if (payload && !design) design = { payload, markerText, plainText };
      }
      const svg = design ? null : extractSvgMarkup(plainText);
      if (svg) {
        files.push(new File([svg], "", { type: "image/svg+xml" }));
        continue;
      }
      const imageType =
        item.types.find((type) => type === "image/svg+xml") ??
        item.types.find((type) => type.startsWith("image/"));
      if (imageType) {
        try {
          files.push(
            new File([await item.getType(imageType)], "", { type: imageType }),
          );
        } catch (error) {
          readErrors.push(error);
          // Try the next clipboard item when this representation is denied.
        }
      }
    } catch (error) {
      readErrors.push(error);
      // A denied representation must not discard clipboard items that follow it.
    }
  }
  if (readErrors.length > 0 && !design && files.length === 0) return null;
  return {
    design,
    files,
    ...(readErrors.length > 0 ? { readErrors } : {}),
  };
}

export function plainTextFromDesignHtml(htmlFragments: string[]): string {
  return htmlFragments
    .map((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc
        .querySelectorAll("script, style, template, noscript")
        .forEach((node) => node.remove());
      return (doc.body.innerText || doc.body.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    })
    .filter(Boolean)
    .join("\n");
}
