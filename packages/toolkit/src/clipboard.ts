type ClipboardWriter = {
  writeText?: (text: string) => boolean | Promise<boolean>;
};

type DesktopClipboardApis = {
  electronAPI?: {
    clipboard?: ClipboardWriter;
  };
  agentNativeDesktop?: {
    clipboard?: ClipboardWriter;
  };
};

function getDesktopClipboards(): ClipboardWriter[] {
  const api = globalThis as typeof globalThis & DesktopClipboardApis;
  return [api.electronAPI?.clipboard, api.agentNativeDesktop?.clipboard].filter(
    (clipboard): clipboard is ClipboardWriter => !!clipboard?.writeText,
  );
}

function writeWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
    // coercion-ok: false is the clipboard contract's explicit failure result.
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * Writes text through the strongest clipboard available to the current host.
 * Desktop bridges are preferred, then the browser Clipboard API, with the
 * synchronous DOM path retained for embedded surfaces that deny async writes.
 */
export async function writeClipboardText(
  text: string,
  options?: { html?: string },
): Promise<boolean> {
  for (const desktopClipboard of getDesktopClipboards()) {
    try {
      const result = await desktopClipboard.writeText?.(text);
      if (result !== false) return true;
      // coercion-ok: a rejected host bridge deliberately falls through to browser and DOM fallbacks.
    } catch {}
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    const html = options?.html;
    if (
      html !== undefined &&
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard.write
    ) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
        return true;
        // coercion-ok: a rejected rich write deliberately falls through to the plain-text writer.
      } catch {}
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
      // coercion-ok: a rejected async write deliberately falls through to the synchronous DOM fallback.
    } catch {}
  }

  return writeWithExecCommand(text);
}
