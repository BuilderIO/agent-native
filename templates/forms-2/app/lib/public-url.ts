import { appBasePath } from "@agent-native/core/client/api-path";
import { publicFormPath } from "@shared/form-contract";

/**
 * Base URL that anything publicly reachable hangs off: the site origin plus
 * this app's mount path. A link built from `window.location.origin` alone
 * drops the mount (`/forms-2` on the shared site) and lands on the site's
 * 404 page.
 */
export function publicBaseUrl(): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${appBasePath()}`;
}

export function publicFormUrl(formId: string): string {
  return `${publicBaseUrl()}${publicFormPath(formId)}`;
}
