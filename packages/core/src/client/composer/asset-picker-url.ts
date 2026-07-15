const FALLBACK_BASE_URL = "http://agent-native.invalid";

/**
 * Cross-origin Assets pages cannot inherit the host app's authenticated
 * session inside an iframe. Treat those URLs as link-out targets so provider
 * sign-in runs in a normal top-level browser context.
 */
export function isExternalAssetPickerUrl(
  value: string,
  currentOrigin: string,
): boolean {
  try {
    return new URL(value, currentOrigin).origin !== currentOrigin;
  } catch {
    // A malformed configured URL should fail closed instead of being loaded in
    // an iframe with an unknown auth boundary.
    return true;
  }
}

/** Build a top-level picker URL without iframe-only auth flags. */
export function standaloneAssetPickerUrl(
  value: string,
  baseUrl = FALLBACK_BASE_URL,
): string {
  try {
    const parsed = new URL(value, baseUrl);
    parsed.searchParams.delete("embedded");
    parsed.searchParams.delete("__an_embed_token");
    parsed.searchParams.set("mediaType", "image");
    return parsed.toString();
  } catch {
    return value;
  }
}
