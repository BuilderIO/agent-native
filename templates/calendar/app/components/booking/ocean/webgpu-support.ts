export type WebgpuSupport = "supported" | "unsupported" | "probe-failed";

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
