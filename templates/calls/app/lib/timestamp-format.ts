export function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export const mmss = formatMs;

export function parseTimestamp(input: string): number {
  if (!input) return 0;
  const parts = input.trim().split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return 0;
  const nums = parts.map(Number);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (nums.length === 1) {
    seconds = nums[0];
  } else if (nums.length === 2) {
    [minutes, seconds] = nums;
  } else if (nums.length === 3) {
    [hours, minutes, seconds] = nums;
  } else {
    return 0;
  }
  return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) * 1000));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
