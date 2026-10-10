export interface ClipsActionTarget {
  serverUrl: string;
  authToken: string;
}

// Keeps the HTTP status so a caller can tell a claim conflict (409) from a
// transport or server failure.
export class ClipsActionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
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
      if (value == null) continue;
      // Arrays go out as repeated `key[]` parameters, which the action router
      // reads back as an array. An empty array sends nothing.
      if (Array.isArray(value)) {
        for (const item of value) params.append(`${key}[]`, String(item));
        continue;
      }
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
  const text = await response.text();
  let json: any = null;
  let parseError: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      parseError = error;
    }
  }
  if (!response.ok) {
    const message =
      json?.error ||
      json?.message ||
      (response.status === 401
        ? "Sign in to transcribe meetings."
        : text.slice(0, 180) || `Request failed (${response.status})`);
    throw new ClipsActionError(message, response.status);
  }
  if (!text) {
    throw new Error("Action returned an empty response.");
  }
  if (parseError) {
    // The desktop tsconfig targets ES2021, which has no Error `cause` option.
    const failure = new Error("Action returned an invalid JSON response.");
    Object.assign(failure, { cause: parseError });
    throw failure;
  }
  return (json?.result ?? json) as T;
}
