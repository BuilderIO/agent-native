const truthy = (v: string | undefined) => v === "1" || v === "true";
const enabled = truthy(process.env.DEBUG) || truthy(process.env.CLIPS_DEBUG);

export function debugLog(...args: unknown[]): void {
  if (enabled) console.log(...args);
}
