export const ORGANIZATION_LOGO_REFERENCE_PREFIX = "clips-org-logo:v1:";
export const ORGANIZATION_LOGO_PURPOSE = "organization-brand-logo";

export function isOrganizationLogoReference(value: string): boolean {
  return value.startsWith(ORGANIZATION_LOGO_REFERENCE_PREFIX);
}

export function legacyOrganizationLogoObjectKey(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // coercion-ok: malformed legacy logo URLs are unsupported references.
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const segments: string[] = [];
  for (const segment of url.pathname.split("/").filter(Boolean)) {
    try {
      const decoded = decodeURIComponent(segment);
      if (decoded.includes("/") || decoded === "." || decoded === "..") {
        return null;
      }
      segments.push(decoded);
    } catch {
      // coercion-ok: invalid URL escapes make the legacy reference unsupported.
      return null;
    }
  }

  const clipsIndex = segments.indexOf("clips");
  if (clipsIndex < 0) return null;
  const key = segments.slice(clipsIndex).join("/");
  return /^clips\/logo-[A-Za-z0-9_-]{1,120}\/\d{13}-[a-z0-9]{1,16}\.(?:png|jpe?g|gif|webp)$/i.test(
    key,
  )
    ? key
    : null;
}

export function usesOrganizationLogoRoute(value: string): boolean {
  return (
    isOrganizationLogoReference(value) ||
    Boolean(legacyOrganizationLogoObjectKey(value))
  );
}

export function organizationLogoRoutePath(organizationId: string): string {
  return `/api/media/organization-logo/${encodeURIComponent(organizationId)}`;
}
