import type { ZodType } from "zod";

import {
  peerLinkOrigins,
  requestPeerApp,
  resolvePeerAppUrl,
  type PeerAppResult,
} from "./app-peer.js";

export function resolveDesignAppUrl(): string | null {
  return resolvePeerAppUrl("design");
}

export function designLinkOrigins(): string[] {
  return peerLinkOrigins("design");
}

export type DesignPeerResult<T> = PeerAppResult<T, "design">;

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
