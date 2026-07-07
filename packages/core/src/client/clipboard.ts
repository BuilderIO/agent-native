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
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  for (const desktopClipboard of getDesktopClipboards()) {
    try {
      const result = await desktopClipboard.writeText?.(text);
      if (result !== false) return true;
    } catch {
      // Fall through to browser clipboard options.
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Embedded surfaces can deny async clipboard even with clipboard-write.
    }
  }

  return writeWithExecCommand(text);
}
