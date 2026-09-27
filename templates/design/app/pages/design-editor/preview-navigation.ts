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
