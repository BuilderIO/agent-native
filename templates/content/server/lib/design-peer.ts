/**
 * Content's side of a Design screen pinned in a page: where Design is, and
 * the one call that asks it, as the signed-in person, for a screen's picture
 * or a design's sharing. Design checks that person's access to the design.
 */
import type { ZodType } from "zod";

import {
  peerLinkOrigins,
  requestPeerApp,
  resolvePeerAppUrl,
  type PeerAppResult,
} from "./app-peer.js";

/** The deployment's built-in Design, on Content's own lane. */
export function resolveDesignAppUrl(): string | null {
  return resolvePeerAppUrl("design");
}

/**
 * The Design app URLs a pasted screen link may name. Beta and production
 * Design share one database, so a link from either names the same screen.
 */
export function designLinkOrigins(): string[] {
  return peerLinkOrigins("design");
}

export type DesignPeerResult<T> = PeerAppResult<T, "design">;

/**
 * Calls one of Design's read-only actions as the signed-in person and
 * checks the answer against `schema`. Never throws for Design's failures.
 * `orgId` is the organization that let them open the page.
 */
export async function requestDesign<T>(
  action: "capture-design-screen" | "get-design-screen-status",
  input: Record<string, unknown>,
  schema: ZodType<T>,
  requestTimeoutMs: number,
  orgId: string | null,
): Promise<DesignPeerResult<T>> {
  return requestPeerApp({
    target: "design",
    action,
    input,
    schema,
    requestTimeoutMs,
    orgId,
    messages: {
      appName: "Design",
      signedOut: "Sign in to pin Design screens.",
      unreachable: "Design didn't answer. Try again in a minute.",
      refused:
        "Design couldn't show this screen. Check that you can open the design.",
      invalidResponse:
        "Design sent back something Content can't read. Try again.",
    },
  });
}
