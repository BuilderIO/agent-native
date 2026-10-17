import { SHELL_CANVAS_PATH } from "@shared/shell-screens";

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
