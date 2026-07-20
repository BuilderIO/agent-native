type FolderPickerWindow = {
  codexWindowType?: unknown;
  electronBridge?: unknown;
};

export function isUnsafeNativeFolderPickerHost(
  hostWindow: FolderPickerWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as unknown as FolderPickerWindow),
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
) {
  if (!hostWindow) return false;
  return (
    hostWindow.codexWindowType === "electron" ||
    Boolean(hostWindow.electronBridge) ||
    /\b(?:Electron|Codex|ChatGPT)\//i.test(userAgent)
  );
}
