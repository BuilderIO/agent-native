// One bucketing for prompt length on every client and server event, so prompt
// events from both sides group together in the warehouse.
export function promptLengthBucket(prompt: unknown): string {
  const length = typeof prompt === "string" ? prompt.trim().length : 0;
  if (length === 0) return "0";
  if (length <= 50) return "1-50";
  if (length <= 500) return "50-500";
  return "500+";
}
