const AWARENESS_POST_TIMEOUT_MS = 5_000;

const inFlightAwarenessPosts = new Map<string, Promise<void>>();

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
  const send = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      AWARENESS_POST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(`${baseUrl}/${docId}/awareness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          state: state ? JSON.stringify(state) : null,
        }),
        signal: controller.signal,
        ...(keepalive ? { keepalive: true } : {}),
      });
      await response.clone().arrayBuffer();
      return response;
    } finally {
      clearTimeout(timeout);
    }
  };
  const dispatchImmediately = keepalive && state !== null;
  const post = dispatchImmediately ? send() : previous.then(send);
  const pending = Promise.allSettled([previous, post]).then(() => {});

  inFlightAwarenessPosts.set(key, pending);
  void pending.then(() => {
    if (inFlightAwarenessPosts.get(key) === pending) {
      inFlightAwarenessPosts.delete(key);
    }
  });
  return post;
}
