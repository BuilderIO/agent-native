export async function readZoomUntilAvailable(
  readZoom: () => Promise<number | null>,
  wait: (milliseconds: number) => Promise<unknown>,
  deadline: number,
  now = Date.now,
): Promise<number | null> {
  while (now() < deadline) {
    const zoom = await readZoom();
    if (zoom !== null && Number.isFinite(zoom) && zoom > 0) return zoom;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(250, remaining));
  }
  return null;
}

export async function waitForAnimationFrame(
  waitForFrame: () => Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  if (timeoutMs <= 0) return false;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // A host-side timer still runs if the browser stops producing frames.
    return await Promise.race([
      waitForFrame().then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
