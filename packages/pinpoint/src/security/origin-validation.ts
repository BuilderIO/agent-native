// @agent-native/pinpoint — Origin validation for cross-frame communication
// MIT License

/**
 * Validate that a message origin is allowed.
 * Used for postMessage security when communicating with harnesses.
 */
export function isAllowedOrigin(
  origin: string,
  allowedOrigins?: string[],
): boolean {
  // Always allow same-origin
  if (origin === window.location.origin) return true;

  // Always allow localhost variants
  if (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("https://localhost")
  ) {
    return true;
  }

  // Check explicit allowlist
  if (allowedOrigins && allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin);
  }

  // Default: deny unknown origins
  return false;
}

/**
 * Create a MessageChannel port pair for secure bi-directional communication.
 * Avoids broadcasting via postMessage('*').
 */
export function createSecureChannel(): {
  port: MessagePort;
  remotePort: MessagePort;
} {
  const channel = new MessageChannel();
  return {
    port: channel.port1,
    remotePort: channel.port2,
  };
}
