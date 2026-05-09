function normalizeOrigin(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

export function getPublicOAuthOrigin(): string {
  for (const raw of [
    process.env.WORKSPACE_OAUTH_ORIGIN,
    process.env.VITE_WORKSPACE_OAUTH_ORIGIN,
    process.env.APP_URL,
    process.env.VITE_APP_URL,
    process.env.BETTER_AUTH_URL,
    process.env.VITE_BETTER_AUTH_URL,
    process.env.WORKSPACE_GATEWAY_URL,
    process.env.VITE_WORKSPACE_GATEWAY_URL,
  ]) {
    const origin = normalizeOrigin(raw);
    if (origin) return origin;
  }
  return "";
}
