import {
  type DesignClipboardPayload,
  parseDesignClipboardMarker,
} from "./design-import";

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
  /** Per-installation secret used to reject marker-shaped HTML authored by
   * arbitrary external clipboard sources. `null` fails closed. */
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
              // The synchronous copy-event path remains available in browsers
              // that deny the async Clipboard API. It preserves Design's rich
              // marker across files/tabs without leaking that marker into the
              // human-readable text/plain representation.
              return document.execCommand("copy") && wroteRepresentations;
            } finally {
              document.removeEventListener("copy", handleCopy, true);
            }
          },
    // A navigation immediately after Cmd+C can cancel Chromium's pending
    // async clipboard.write promise. The copy-event path completes before the
    // key handler returns, matching Figma's durable copy-before-leave behavior.
    preferLegacyCopy: true,
    trustToken: getDesignClipboardTrustToken(),
  };
}

const DESIGN_CLIPBOARD_TRUST_TOKEN_KEY =
  "agent-native.design.clipboard-trust-token.v1";

/**
 * A stable, origin-local capability for rich Design clipboard markers. Plain
 * HTML copied from another page can imitate our public marker syntax; without
 * this capability it could smuggle script/event-handler markup into a srcdoc
 * preview that intentionally supports executable Alpine designs. localStorage
 * makes the token available to independent Design files and browser tabs while
 * keeping ordinary clipboard contents from forging it.
 */
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
    // If durable origin storage is unavailable, rich external marker parsing
    // is disabled. Same-editor copy/paste still works through in-memory refs.
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

/**
 * Writes the user-facing text as text/plain and keeps Design's lossless layer
 * payload in text/html. Apps that only want text therefore receive readable
 * content, while another Design tab can still reconstruct the copied layers.
 */
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
): Promise<ReadDesignClipboardPayload | null> {
  const clipboard = environment.clipboard;
  if (!clipboard) return null;

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
          if (payload) return { payload, markerText, plainText };
        }
      }
    } catch {
      // Fall back to readText below. It also understands clipboards written by
      // older Design versions that stored the marker in text/plain.
    }
  }

  if (!clipboard.readText) return null;
  try {
    const markerText = await clipboard.readText();
    const payload = parseDesignClipboardMarker(
      markerText,
      environment.trustToken,
    );
    return payload ? { payload, markerText, plainText: markerText } : null;
  } catch {
    return null;
  }
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
