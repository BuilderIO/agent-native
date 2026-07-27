type ElectronClipboardApi = {
  clipboard?: {
    writeText?: (text: string) => boolean | Promise<boolean>;
  };
};

function getElectronClipboard(): ElectronClipboardApi["clipboard"] | null {
  const api = (
    globalThis as typeof globalThis & {
      electronAPI?: ElectronClipboardApi;
    }
  ).electronAPI;
  return api?.clipboard ?? null;
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
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

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const electronClipboard = getElectronClipboard();
  if (electronClipboard?.writeText) {
    try {
      const copied = await electronClipboard.writeText(text);
      if (copied !== false) return true;
    } catch {
      // Fall through to browser clipboard options.
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Electron/web embeds can deny clipboard-write even after a click.
    }
  }

  return copyWithExecCommand(text);
}
