// @agent-native/pinpoint — Origin validation for cross-frame communication
// MIT License

/**
 * Validate that a message origin is allowed.
 * Used for postMessage security when communicating with frames.
 */
export function isAllowedOrigin(
  origin: string,
  allowedOrigins?: string[],
): boolean {
  if (origin === window.location.origin) return true;

  if (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("https://localhost")
  ) {
    return true;
  }

  if (allowedOrigins && allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin);
  }

  return false;
}

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
