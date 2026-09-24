/**
 * Three outcomes, not two. "No WebGPU in this browser" and "the probe itself
 * broke" are different facts, and collapsing them into a boolean is how a
 * broken probe gets reported as an unsupported browser forever.
 */
export type WebgpuSupport = "supported" | "unsupported" | "probe-failed";

/**
 * `navigator.gpu` existing is not support: a blocklisted driver, a headless
 * container, or a software-only adapter all expose the namespace and then
 * return null from requestAdapter().
 */
export async function probeWebgpuSupport(): Promise<WebgpuSupport> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") return "unsupported";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "supported" : "unsupported";
  } catch {
    return "probe-failed";
  }
}
