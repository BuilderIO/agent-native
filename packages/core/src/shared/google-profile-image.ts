const GOOGLE_PROFILE_IMAGE_HOST = "googleusercontent.com";

/** Accept only HTTPS images served from Google's profile-image CDN. */
export function isGoogleProfileImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (!candidate) return false;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    // coercion-ok: malformed profile URLs are invalid input, not a successful value
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    (hostname === GOOGLE_PROFILE_IMAGE_HOST ||
      hostname.endsWith(`.${GOOGLE_PROFILE_IMAGE_HOST}`))
  );
}
