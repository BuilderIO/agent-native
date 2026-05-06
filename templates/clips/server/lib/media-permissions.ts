export const MEDIA_CAPTURE_PERMISSIONS_POLICY =
  "camera=(self), microphone=(self), display-capture=(self), geolocation=(), screen-wake-lock=()";

export function withMediaCapturePermissions(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Permissions-Policy", MEDIA_CAPTURE_PERMISSIONS_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
