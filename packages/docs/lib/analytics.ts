import { wrapWithAnalytics } from "@agent-native/core/server";

export function wrapDocumentResponse(response: Response): Response {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!response.body || contentType !== "text/html") return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(wrapWithAnalytics(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
