import type { GrantedAppActionResult } from "./mcp-gateway.js";

export function appActionResultText(result: GrantedAppActionResult): string {
  return result.content
    .map((part) =>
      part !== null &&
      typeof part === "object" &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : "",
    )
    .join(" ")
    .trim();
}

export function appActionErrorCode(text: string): string | undefined {
  return /errorCode: ([a-z0-9_]+)/i.exec(text)?.[1];
}

/**
 * The app turned the call away at its input check, before any handler ran, so
 * nothing was written and the same turn can still use its other actions.
 */
export function appActionRefusedBeforeRun(text: string): boolean {
  return /^(?:Error:\s*)?Invalid action parameters\b/i.test(text);
}
