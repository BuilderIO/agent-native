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
): Promise<void> {
  const key = awarenessPostKey(baseUrl, docId, clientId);
  const previous = inFlightAwarenessPosts.get(key) ?? Promise.resolve();
  const post = previous
    .catch(() => {})
    .then(async () => {
      await fetch(`${baseUrl}/${docId}/awareness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          state: state ? JSON.stringify(state) : null,
        }),
        ...(keepalive ? { keepalive: true } : {}),
      });
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
