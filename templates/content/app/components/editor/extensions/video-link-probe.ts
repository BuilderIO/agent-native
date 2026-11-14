const PROBE_TIMEOUT_MS = 8_000;

/**
 * Whether the reader's browser can play `src` as a video: it loads only the
 * file's metadata, in a detached `<video>`, so Content's server never
 * fetches the link. A page, an image or a dead link fails or times out.
 */
export function probeVideoSource(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let settled = false;
    const finish = (playable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(playable);
    };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    video.addEventListener("loadedmetadata", () =>
      finish(video.videoWidth > 0 || Number.isFinite(video.duration)),
    );
    video.addEventListener("error", () => finish(false));
    video.src = src;
  });
}
