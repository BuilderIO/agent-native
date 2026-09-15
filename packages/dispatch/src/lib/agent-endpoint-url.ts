/**
 * Shared validation for the "Connect endpoint" agent import tab. `new
 * URL(...)` throws a bare, unlabeled error on malformed input; left
 * unvalidated in the client and uncaught in connect-external-agent, that
 * reached the user as a raw "Internal server error" toast instead of a field
 * error. This is the one place both the form and the action check the value,
 * so they can never disagree about what counts as a usable endpoint URL.
 */

/** Reason `value` cannot be used as an agent endpoint URL, or null when it can. */
export function agentEndpointUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter an endpoint URL.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a valid URL, such as https://agent.example.com.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Use an http:// or https:// endpoint URL.";
  }
  if (parsed.username || parsed.password) {
    return "Do not include credentials in the endpoint URL.";
  }
  return null;
}

/** Parse a validated agent endpoint URL, or throw the same message `agentEndpointUrlError` would return. */
export function parseAgentEndpointUrl(value: string): URL {
  const error = agentEndpointUrlError(value);
  if (error) throw new Error(error);
  return new URL(value.trim());
}
