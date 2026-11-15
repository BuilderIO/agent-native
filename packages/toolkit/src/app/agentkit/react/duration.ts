export function formatAgentKitDuration(
  ms: number,
  units: { hour?: string; minute?: string; second?: string } = {},
): string {
  const hour = units.hour ?? "h";
  const minute = units.minute ?? "m";
  const second = units.second ?? "s";
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  if (totalSeconds < 60) return `${Math.max(1, totalSeconds)}${second}`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0
      ? `${minutes}${minute}`
      : `${minutes}${minute} ${seconds}${second}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours}${hour}`
    : `${hours}${hour} ${remainingMinutes}${minute}`;
}
