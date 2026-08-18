import { SHELL_CANVAS_PATH } from "@shared/shell-screens";

/**
 * The parent origin the Builder handshake arrived from, recorded once a
 * `design:init` message passes the host check.
 *
 * Origin sniffing cannot confirm a Builder running on localhost — every local
 * dev session — so the handshake is the only signal that works in both.
 */
let verifiedBuilderHostOrigin: string | null = null;

export function rememberBuilderHostOrigin(origin: string): void {
  if (origin) verifiedBuilderHostOrigin = origin;
}

export function getVerifiedBuilderHostOrigin(): string | null {
  return verifiedBuilderHostOrigin;
}

/**
 * True on the host-driven canvas. The route is the whole signal now: there is no
 * token to inspect, and this picks chrome, never access.
 */
export function isBuilderHostEmbed(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname === SHELL_CANVAS_PATH;
}

export function _resetBuilderHostEmbedForTests(): void {
  verifiedBuilderHostOrigin = null;
}
