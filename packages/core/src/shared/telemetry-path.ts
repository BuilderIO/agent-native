function normalizeSegment(segment: string): string {
  if (!segment) return segment;
  if (/^[0-9]+$/.test(segment)) return ":id";
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)) return ":id";
  if (
    /^(run|turn|thread|design|screen|file|msg|key|tok)_[a-z0-9_-]+$/i.test(
      segment,
    )
  ) {
    return ":id";
  }
  if (/^(run|turn)-[0-9]{10,}-[a-z0-9]+$/i.test(segment)) return ":id";
  if (segment.length > 36 && /^[a-z0-9_-]+$/i.test(segment)) return ":id";
  return segment;
}

export function normalizeHttpTelemetryPath(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalized
    .split("/")
    .map((segment, index) => (index === 0 ? "" : normalizeSegment(segment)))
    .join("/");
}
