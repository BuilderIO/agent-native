/**
 * Opens a preview from a user gesture without losing it to popup blocking.
 * The blank window must be created before assigning the real URL; otherwise
 * browsers can treat the delayed navigation as an unsolicited popup.
 */
export function openPreviewUrl(
  url: string,
  openWindow: (url: string, target: string) => Window | null,
  navigateSameTab: (url: string) => void,
): "popup" | "same-tab" {
  const popup = openWindow("", "_blank");
  if (!popup) {
    navigateSameTab(url);
    return "same-tab";
  }

  try {
    popup.opener = null;
    popup.location.href = url;
    return "popup";
  } catch {
    navigateSameTab(url);
    return "same-tab";
  }
}
