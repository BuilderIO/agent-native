const EDITOR_ROLES = new Set(["owner", "admin", "editor"]);

/**
 * Public visibility is read-only. Ownership and explicit share grants are
 * resolved separately by the framework, so they can still upgrade the caller
 * to owner/admin/editor without making an anonymous public link writable.
 */
export function publicDesignAccessRole(): "viewer" {
  return "viewer";
}

function removeLocalhostCredentials(
  value: unknown,
  ancestors: WeakSet<object>,
  allowPreviewToken: boolean,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) {
    throw new Error("Design data contains a circular reference");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child) =>
        removeLocalhostCredentials(child, ancestors, allowPreviewToken),
      );
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key]) =>
            key !== "bridgeToken" &&
            (allowPreviewToken || key !== "previewToken"),
        )
        .map(([key, child]) => [
          key,
          removeLocalhostCredentials(child, ancestors, allowPreviewToken),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Filter persisted design data before sending it to a caller.
 *
 * Filesystem bridge tokens unlock privileged loopback endpoints and are never
 * returned through design data, including to owners/editors. The separate
 * read-only preview token is available only to callers with an editor role;
 * anonymous/public viewers fail closed rather than gaining access to a local
 * development server. Invalid persisted JSON also fails closed to null.
 */
export function designDataForAccessRole(data: unknown, role: unknown): unknown {
  const allowPreviewToken = typeof role === "string" && EDITOR_ROLES.has(role);

  try {
    if (typeof data === "string") {
      const parsed = JSON.parse(data) as unknown;
      return JSON.stringify(
        removeLocalhostCredentials(parsed, new WeakSet(), allowPreviewToken),
      );
    }
    return removeLocalhostCredentials(data, new WeakSet(), allowPreviewToken);
  } catch {
    return null;
  }
}
