export interface ClipsActionTarget {
  serverUrl: string;
  authToken: string;
}

export async function callClipsActionFor<T>(
  target: ClipsActionTarget,
  name: string,
  body: Record<string, unknown>,
  opts?: { method?: "GET" | "POST"; signal?: AbortSignal },
): Promise<T> {
  const base = target.serverUrl.replace(/\/+$/, "");
  const method = opts?.method ?? "POST";
  const headers = new Headers();
  if (target.authToken) {
    headers.set("Authorization", `Bearer ${target.authToken}`);
  }
  let url = `${base}/_agent-native/actions/${name}`;
  let requestBody: string | undefined;
  if (method === "GET") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value != null)
        params.set(
          key,
          typeof value === "string" ? value : (JSON.stringify(value) ?? ""),
        );
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  } else {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: requestBody,
    signal: opts?.signal,
  });
  const text = await response.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Keep text fallback below.
  }
  if (!response.ok) {
    const message =
      json?.error ||
      json?.message ||
      (response.status === 401
        ? "Sign in to transcribe meetings."
        : text.slice(0, 180) || `Request failed (${response.status})`);
    throw new Error(message);
  }
  return (json?.result ?? json) as T;
}
