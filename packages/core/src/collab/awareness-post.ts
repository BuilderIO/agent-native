const AWARENESS_POST_TIMEOUT_MS = 5_000;

let lastClientSequence = 0;

function nextClientSequence(): number {
  const sequence = Math.max(Date.now() * 1_000, lastClientSequence + 1);
  if (!Number.isSafeInteger(sequence)) {
    throw new Error(
      "awareness client sequence exceeded the safe integer range",
    );
  }
  lastClientSequence = sequence;
  return sequence;
}

export function postAwarenessState(
  baseUrl: string,
  docId: string,
  clientId: number,
  state: Record<string, unknown> | null,
  keepalive = false,
): Promise<Response> {
  const clientSequence = nextClientSequence();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AWARENESS_POST_TIMEOUT_MS,
  );

  return fetch(`${baseUrl}/${docId}/awareness`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      clientSequence,
      state: state ? JSON.stringify(state) : null,
    }),
    signal: controller.signal,
    ...(keepalive ? { keepalive: true } : {}),
  })
    .then(async (response) => {
      await response.clone().arrayBuffer();
      return response;
    })
    .finally(() => {
      clearTimeout(timeout);
    });
}
