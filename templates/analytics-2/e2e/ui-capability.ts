import type { APIRequestContext, APIResponse } from "@playwright/test";

export function uiOriginHeaders(base: string): Record<string, string> {
  return {
    origin: new URL(base).origin,
    "sec-fetch-site": "same-origin",
  };
}

export function uiActionHeaders(base: string): Record<string, string> {
  return {
    ...uiOriginHeaders(base),
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
}

export async function ensureUiCapability(
  request: APIRequestContext,
  base: string,
): Promise<void> {
  const response = await request.get(`${base}/_agent-native/ui-capability`, {
    headers: uiOriginHeaders(base),
    maxRedirects: 0,
    timeout: 15_000,
  });
  if (!response.ok()) {
    throw new Error(`ui-capability: HTTP ${response.status()}`);
  }
}

export async function fetchUiAction(
  request: APIRequestContext,
  base: string,
  url: string,
  options: {
    method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
    headers?: Record<string, string>;
    data?: unknown;
    timeout?: number;
  },
): Promise<APIResponse> {
  const headers = {
    ...uiActionHeaders(base),
    ...options.headers,
  };
  const send = () =>
    request.fetch(url, {
      method: options.method,
      headers,
      ...(options.data !== undefined ? { data: options.data } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    });

  let response = await send();
  if (response.status() === 403 && options.method !== "GET") {
    let needsCapability = false;
    try {
      const text = await response.text();
      needsCapability = text.includes("ui_capability_required");
    } catch {
      needsCapability = false;
    }
    if (needsCapability) {
      await ensureUiCapability(request, base);
      response = await send();
    }
  }
  return response;
}
