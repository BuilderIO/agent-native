import { getAppConfig } from "../app-config/index.js";

export function workspacePrivateOrigins(): string[] {
  const config = getAppConfig();
  const origins = [
    config.workspace.gatewayUrl,
    config.app.url,
    ...config.a2a.allowedOrigins,
  ].filter((value): value is string => value !== undefined);

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
