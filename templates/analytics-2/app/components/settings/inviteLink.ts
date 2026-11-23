import { appBasePath } from "@agent-native/core/client/api-path";

export function inviteLinkFor(
  invitationId: string,
  origin?: string,
  basePath?: string,
) {
  const base =
    origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  // The join route lives under the app, not the host: a host that serves this
  // app at a path answers the bare /join/<id> with 404 (labs), which is exactly
  // the link an admin would paste into a chat.
  const mount = (
    basePath ?? (typeof window === "undefined" ? "" : appBasePath())
  ).replace(/\/+$/, "");
  return `${base.replace(/\/$/, "")}${mount}/join/${encodeURIComponent(invitationId)}`;
}
