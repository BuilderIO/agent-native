const GOOGLE_PROFILE_IMAGE_HOST = "googleusercontent.com";
// What Google serves an account that has no photo: a generic silhouette.
const GOOGLE_DEFAULT_AVATAR_PATH = /^\/a\/default-user(?:[=/]|$)/;

function parseGoogleImageUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    // coercion-ok: malformed profile URLs are invalid input, not a successful value
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const isGoogleImageHost =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    (hostname === GOOGLE_PROFILE_IMAGE_HOST ||
      hostname.endsWith(`.${GOOGLE_PROFILE_IMAGE_HOST}`));
  return isGoogleImageHost ? url : null;
}

/** Google's stand-in silhouette for an account with no photo. */
export function isGoogleDefaultAvatarUrl(value: unknown): boolean {
  const url = parseGoogleImageUrl(value);
  return url !== null && GOOGLE_DEFAULT_AVATAR_PATH.test(url.pathname);
}

/** A Google-hosted image that is a person's own photo, not Google's stand-in. */
export function isGoogleProfileImageUrl(value: unknown): value is string {
  const url = parseGoogleImageUrl(value);
  return url !== null && !GOOGLE_DEFAULT_AVATAR_PATH.test(url.pathname);
}
