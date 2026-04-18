/**
 * Thin client for calling scheduling actions via the framework HTTP endpoint
 * (`/_agent-native/actions/:name`). Uses @tanstack/react-query.
 */
export async function callAction<T = any>(
  name: string,
  args?: Record<string, any>,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`/_agent-native/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
    signal: init?.signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Action ${name} failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}
