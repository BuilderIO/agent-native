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

export function parseAgentEndpointUrl(value: string): URL {
  const error = agentEndpointUrlError(value);
  if (error) throw new Error(error);
  return new URL(value.trim());
}
