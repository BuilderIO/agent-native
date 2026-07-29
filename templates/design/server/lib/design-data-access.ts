import { getRequestIsLoopback } from "@agent-native/core/server/request-context";

import { designSourceTypeFromData } from "../../shared/source-mode";

const EDITOR_ROLES = new Set(["owner", "admin", "editor"]);

/**
 * Public visibility is read-only, with one exception: `/visual-edit`.
 *
 * A localhost-backed design is a view of a dev server running on the caller's
 * own machine, so requiring a login to edit it protects nothing the caller
 * doesn't already own outright — they can edit those files directly. Gating it
 * only broke the tool. A loopback caller therefore gets `editor` on a
 * localhost-source design, which is what releases `previewToken` and lets the
 * live-edit bridge register.
 *
 * BOTH halves of the gate matter. Loopback alone is not enough: a tunnel or
 * reverse proxy that reaches the dev server over localhost also presents as
 * loopback, so the design must additionally be localhost-source — a resource
 * that is worthless to anyone who cannot reach 127.0.0.1 anyway. Localhost-
 * source alone is not enough either: `previewToken` unlocks the loopback
 * bridge, and handing it to a remote viewer of a *shared* design would let an
 * attacker-controlled page drive the victim's local bridge from their browser.
 *
 * Ownership and explicit share grants are resolved separately by the
 * framework and can still upgrade the caller independently of this.
 */
export function publicDesignAccessRole(
  resource?: { data?: unknown } | null,
): "viewer" | "editor" {
  if (!getRequestIsLoopback()) return "viewer";
  return designSourceTypeFromData(resource?.data) === "localhost"
    ? "editor"
    : "viewer";
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
