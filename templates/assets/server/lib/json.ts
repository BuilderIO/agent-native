import { getConfiguredAppBasePath } from "@agent-native/core/server";

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function nowIso(): string {
  return new Date().toISOString();
}

function withAppBasePath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const basePath = getConfiguredAppBasePath();
  if (!basePath || path === basePath || path.startsWith(`${basePath}/`)) {
    return path;
  }
  return `${basePath}${path}`;
}

export function absoluteUrl(path: string): string {
  const scopedPath = withAppBasePath(path);
  const base =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL ||
    "";
  if (!base) return scopedPath;
  try {
    return new URL(scopedPath, `${base.replace(/\/$/, "")}/`).toString();
  } catch {
    return scopedPath;
  }
}
