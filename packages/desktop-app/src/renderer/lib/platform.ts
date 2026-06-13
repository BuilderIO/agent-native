export function shouldReserveMacOSWindowControlsSpace(): boolean {
  const platform = window.electronAPI?.platform;
  if (platform === "darwin") return true;
  if (platform === "win32" || platform === "linux") return false;

  return (
    /\bMac OS X\b/i.test(navigator.userAgent) ||
    /\bMac\b/i.test(navigator.platform)
  );
}
