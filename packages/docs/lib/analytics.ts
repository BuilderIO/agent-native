import { wrapWithAnalytics } from "@agent-native/core/server";

export function wrapDocumentResponse(response: Response): Response {
  if (!response.body) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(wrapWithAnalytics(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
