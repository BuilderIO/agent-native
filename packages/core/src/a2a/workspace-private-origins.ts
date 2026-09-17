import { getAppConfig } from "../app-config/index.js";

/**
 * A workspace serves every app from one gateway on loopback, so sibling A2A
 * targets are private addresses by construction and the SSRF guard cannot tell
 * them apart from an attack. Trust only origins this deployment configured for
 * itself — never a value that arrived on a request.
 */
export function workspacePrivateOrigins(): string[] {
  const config = getAppConfig();
  // No trimming or blank-dropping here: the config layer trims string values
  // and `a2a.allowedOrigins` rejects empty entries, so the only thing left to
  // drop is an unset optional.
  const origins = [
    config.workspace.gatewayUrl,
    config.app.url,
    ...config.a2a.allowedOrigins,
  ].filter((value): value is string => value !== undefined);

  // The gateway also hands each child the sibling manifest, and siblings are
  // reached on their own loopback ports rather than through the gateway.
  const raw = config.workspace.appsJson;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const apps = Array.isArray(parsed?.apps)
        ? parsed.apps
        : Array.isArray(parsed)
          ? parsed
          : [];
      for (const app of apps) {
        const url = app?.url ?? app?.origin ?? app?.baseUrl;
        if (typeof url === "string" && url) origins.push(url);
        const port = app?.port;
        if (typeof port === "number" && Number.isFinite(port)) {
          origins.push(`http://127.0.0.1:${port}`);
        }
      }
    } catch (cause) {
      throw new Error("Invalid workspace app manifest", { cause });
    }
  }
  return origins;
}
