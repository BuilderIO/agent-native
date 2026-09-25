const FALLBACK_BASE_URL = "http://agent-native.invalid";

export const ASSET_PICKER_HANDOFF_PARAM = "__an_asset_picker_handoff";
export const ASSET_PICKER_RETURN_ORIGIN_PARAM =
  "__an_asset_picker_return_origin";

export interface StandaloneAssetPickerOptions {
  handoffId?: string;
  returnOrigin?: string;
}

export function createAssetPickerHandoffId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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
  options: StandaloneAssetPickerOptions = {},
): string {
  try {
    const parsed = new URL(value, baseUrl);
    parsed.searchParams.delete("embedded");
    parsed.searchParams.delete("__an_embed_token");
    parsed.searchParams.set("mediaType", "image");
    let returnOrigin: string | null = null;
    if (options.returnOrigin) {
      try {
        const parsedOrigin = new URL(options.returnOrigin);
        if (
          parsedOrigin.protocol === "http:" ||
          parsedOrigin.protocol === "https:"
        ) {
          returnOrigin = parsedOrigin.origin;
        }
      } catch {
        // Omit an invalid return target rather than emitting an unverified
        // cross-origin callback URL.
      }
    }
    if (options.handoffId && returnOrigin) {
      parsed.searchParams.set(ASSET_PICKER_HANDOFF_PARAM, options.handoffId);
      parsed.searchParams.set(ASSET_PICKER_RETURN_ORIGIN_PARAM, returnOrigin);
    } else {
      parsed.searchParams.delete(ASSET_PICKER_HANDOFF_PARAM);
      parsed.searchParams.delete(ASSET_PICKER_RETURN_ORIGIN_PARAM);
    }
    return parsed.toString();
  } catch {
    return value;
  }
}
