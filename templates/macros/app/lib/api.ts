import { TAB_ID } from "./tab-id";
import { agentNativePath } from "@agent-native/core/client";

export async function apiFetch(
  url: string,
  options?: RequestInit,
): Promise<any> {
  const res = await fetch(agentNativePath(url), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
      ...options?.headers,
    },
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
