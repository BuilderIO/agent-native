function isTruthy(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const chromeExtensionUrl =
  import.meta.env.VITE_CLIPS_CHROME_EXTENSION_URL?.trim() ??
  "https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn";

export const clipsChromeExtensionEnabled = isTruthy(
  import.meta.env.VITE_CLIPS_CHROME_EXTENSION_ENABLED,
);

export const clipsChromeExtensionUrl = chromeExtensionUrl || null;
