const AWARENESS_POST_TIMEOUT_MS = 5_000;

const inFlightAwarenessPosts = new Map<string, Promise<Response>>();

function awarenessPostKey(
  baseUrl: string,
  docId: string,
  clientId: number,
): string {
  return `${baseUrl}::${docId}::${clientId}`;
}

export function postAwarenessState(
  baseUrl: string,
  docId: string,
  clientId: number,
  state: Record<string, unknown> | null,
  keepalive = false,
): Promise<Response> {
  const key = awarenessPostKey(baseUrl, docId, clientId);
  const previous = inFlightAwarenessPosts.get(key) ?? Promise.resolve();
  const post = previous
    .catch(() => {})
    .then(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        AWARENESS_POST_TIMEOUT_MS,
      );
      try {
        return await fetch(`${baseUrl}/${docId}/awareness`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            state: state ? JSON.stringify(state) : null,
          }),
          signal: controller.signal,
          ...(keepalive ? { keepalive: true } : {}),
        });
      } finally {
        clearTimeout(timeout);
      }
    });

  inFlightAwarenessPosts.set(key, post);
  void post.then(
    () => {
      if (inFlightAwarenessPosts.get(key) === post) {
        inFlightAwarenessPosts.delete(key);
      }
    },
    () => {
      if (inFlightAwarenessPosts.get(key) === post) {
        inFlightAwarenessPosts.delete(key);
      }
    },
  );
  return post;
}
