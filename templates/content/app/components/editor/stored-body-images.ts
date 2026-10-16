// Image sources a static body on screen could not load. The body draws each as
// the image block draws a failed load, and an editor taking over from it starts
// those blocks failed too, rather than growing them when its own load of the
// same source fails a moment later.
const failedSources = new Set<string>();
let bodiesOnScreen = 0;

export function noteStoredBodyImageFailed(src: string): void {
  failedSources.add(src);
}

export function storedBodyImageFailed(src: string): boolean {
  return failedSources.has(src);
}

/** Counts a static body on screen; the returned function takes it off. */
export function storedBodyOnScreen(): () => void {
  bodiesOnScreen += 1;
  return () => {
    bodiesOnScreen -= 1;
    // A body handing over leaves in the commit that mounts the next one, so the
    // failures last until no body is on screen after it.
    queueMicrotask(() => {
      if (bodiesOnScreen === 0) failedSources.clear();
    });
  };
}
