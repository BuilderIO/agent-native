const origins = new WeakMap<object, "recovery">();

export function withContentSaveOrigin<T extends object>(
  payload: T,
  origin?: "recovery",
): T {
  if (origin) origins.set(payload, origin);
  return payload;
}

export function contentSaveTelemetryHeaders(
  payload: object,
  defaultOrigin?: "recovery",
): Record<string, string> | undefined {
  const origin = origins.get(payload) ?? defaultOrigin;
  return origin ? { "X-Content-Save-Origin": origin } : undefined;
}
