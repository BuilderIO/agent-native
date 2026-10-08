// Numeric, long hex/uuid, and long mixed alphanumeric segments are record ids;
// left raw they give every session its own branch.
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8,}(?:-[0-9a-f]{4,})*|(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,})$/i;
// A path such as /invite/alice@example.com names a person; it must not become
// a tree key, a label, or a line in a shared capture manifest.
const EMAIL_SEGMENT = /@|%40/i;

/** A page path with its query and hash dropped and dynamic segments named, not copied. */
export function normalizeJourneyPath(path: string | null): string | null {
  const pathname = path?.split(/[?#]/)[0]?.trim();
  if (!pathname) return null;
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      EMAIL_SEGMENT.test(segment)
        ? ":email"
        : ID_SEGMENT.test(segment)
          ? ":id"
          : segment,
    );
  return `/${segments.join("/")}`;
}
