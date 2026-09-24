export function resolveStartMs(
  startMs: number,
  durationMs?: number | null,
): number {
  if (!Number.isFinite(startMs) || startMs < 0) return 0;
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    startMs > durationMs
  ) {
    return 0;
  }
  return startMs;
}

export function parseTimeParam(raw: string | null): number {
  if (!raw) return 0;
  const value = raw.trim();
  if (!value) return 0;

  if (/^\d+(\.\d+)?$/.test(value)) {
    return Math.floor(parseFloat(value) * 1000);
  }

  if (/^\d+:\d+(:\d+)?$/.test(value)) {
    const parts = value.split(":").map((part) => parseInt(part, 10));
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
    if (parts.length === 3) {
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
  }

  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}
