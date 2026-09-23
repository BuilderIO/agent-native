import { getRequestIP } from "h3";
import type { H3Event } from "h3";

/** True when an address belongs to the local machine. */
export function isLoopbackAddress(ip: string | undefined): boolean {
  const normalised = (ip ?? "").split("%")[0];
  return (
    normalised === "127.0.0.1" ||
    normalised === "::1" ||
    normalised === "::ffff:127.0.0.1" ||
    normalised.startsWith("127.")
  );
}

/** Read only the raw socket peer so forwarded headers cannot spoof locality. */
export function isLoopbackRequest(event: H3Event): boolean {
  let ip: string | undefined;
  try {
    ip = getRequestIP(event) ?? undefined;
  } catch {
    ip = undefined;
  }
  return isLoopbackAddress(ip);
}
