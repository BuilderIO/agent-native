const FRAMEWORK_ROUTE_PREFIX = "/_agent-native";

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function configuredBasePath(): string {
  const env = (
    import.meta as unknown as {
      env?: Record<string, string | boolean | undefined>;
    }
  ).env;
  const value = env?.VITE_APP_BASE_PATH ?? env?.APP_BASE_PATH ?? env?.BASE_URL;
  return typeof value === "string" ? normalizeBasePath(value) : "";
}

function pathDerivedBasePath(): string {
  if (typeof window === "undefined") return "";
  const pathname = window.location.pathname;
  const markerIndex = pathname.indexOf(FRAMEWORK_ROUTE_PREFIX);
  if (markerIndex <= 0) return "";
  return normalizeBasePath(pathname.slice(0, markerIndex));
}

export function appBasePath(): string {
  return configuredBasePath() || pathDerivedBasePath();
}

export function agentNativePath(path: string): string {
  if (!path.startsWith(FRAMEWORK_ROUTE_PREFIX)) return path;
  return `${appBasePath()}${path}`;
}
