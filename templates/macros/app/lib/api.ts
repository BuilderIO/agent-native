import { agentNativePath } from "@agent-native/core/client/api-path";

import { TAB_ID } from "./tab-id";

export async function apiFetch(
  url: string,
  options?: RequestInit,
): Promise<any> {
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Request-Source": TAB_ID,
  });
  new Headers(options?.headers).forEach((value, key) =>
    headers.set(key, value),
  );
  const res = await fetch(agentNativePath(url), {
    ...options,
    headers,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`) as Error & {
      details?: any;
    };
    err.details = data?.details;
    throw err;
  }
  return data;
}
