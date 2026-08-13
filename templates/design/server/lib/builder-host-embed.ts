/**
 * Deliberately NOT a `capability:` scope — those are non-identity and reach only
 * `requiresAuth: false` actions, which would leave the canvas read-only.
 * Containment comes from the principal instead: derived per (org, project,
 * branch), owning exactly that branch's design.
 */

import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
} from "@agent-native/core/shared";

/** Informational; anything not prefixed `capability:` resolves as an identity. */
export const BUILDER_HOST_EMBED_SCOPE_PREFIX = "builder-host:design:";

/**
 * Long enough to survive a working session. The embed URL is an iframe `src`,
 * which the browser re-requests on every reload and remount, so the credential
 * in it has to be replayable — a single-use ticket 401s on the second load and
 * drops the user on the sign-in page.
 */
export const BUILDER_HOST_EMBED_TTL_SECONDS = 60 * 60;

export function builderHostEmbedScope(designId: string): string {
  return `${BUILDER_HOST_EMBED_SCOPE_PREFIX}${encodeURIComponent(designId)}`;
}

/**
 * `/visual-edit/:id` rather than `/design/:id` so the embed token's target
 * binding cannot widen ordinary public design links.
 */
export function builderHostDesignPath(designId: string): string {
  return `/visual-edit/${encodeURIComponent(designId)}?view=overview&embedChrome=1`;
}

/**
 * The iframe URL: the design path plus the embed credential. Takes the path the
 * token was signed against rather than rebuilding it, which is how the two
 * drifted into a URL the token did not authorize.
 */
export function builderHostEmbedUrl(urlPath: string, token: string): string {
  const url = new URL(urlPath, "http://placeholder.invalid");
  url.searchParams.set(EMBED_MODE_QUERY_PARAM, "1");
  url.searchParams.set(EMBED_TOKEN_QUERY_PARAM, token);
  return `${url.pathname}${url.search}`;
}
