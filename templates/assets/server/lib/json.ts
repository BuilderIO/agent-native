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

export function absoluteUrl(path: string): string {
  const base =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL ||
    "";
  if (!base) return path;
  try {
    return new URL(path, `${base.replace(/\/$/, "")}/`).toString();
  } catch {
    return path;
  }
}
