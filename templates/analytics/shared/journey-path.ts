// Numeric, long hex/uuid, and long mixed alphanumeric segments are record ids;
// left raw they give every session its own branch.
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8,}(?:-[0-9a-f]{4,})*|(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,})$/i;
// A path such as /invite/alice@example.com names a person; it must not become
// a tree key, a label, or a line in a shared capture manifest.
const EMAIL_SEGMENT = /@|%40/i;
const RESOURCE_ROUTES = new Set([
  "r",
  "deck",
  "design",
  "recording",
  "share",
  "visual-edit",
]);

/** A page path with its query and hash dropped and dynamic segments named, not copied. */
export function normalizeJourneyPath(path: string | null): string | null {
  const pathname = path?.split(/[?#]/)[0]?.trim();
  if (!pathname) return null;
  const parts = pathname.split("/").filter(Boolean);
  const resourceRouteIdIndex =
    parts[0] === "share" && parts[1] === "meeting"
      ? 2
      : parts[0] === "visual-edit" && parts[1] === "shell"
        ? -1
        : RESOURCE_ROUTES.has(parts[0]!)
          ? 1
          : -1;
  const segments = parts.map((segment, index) => {
    if (EMAIL_SEGMENT.test(segment)) return ":email";
    return index === resourceRouteIdIndex || ID_SEGMENT.test(segment)
      ? ":id"
      : segment;
  });
  return `/${segments.join("/")}`;
}
