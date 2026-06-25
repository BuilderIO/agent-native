// camera=* (not (self)) so the Clips browser extension's camera bubble — injected
// as a cross-origin iframe — can run on Clips pages too; (self) only allows the
// app's own same-origin camera. Display-capture stays same-origin. The browser
// still prompts for camera/mic permission per origin.
export const MEDIA_CAPTURE_PERMISSIONS_POLICY =
  "camera=*, microphone=(self), display-capture=(self), geolocation=(), screen-wake-lock=()";

export function withMediaCapturePermissions(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Permissions-Policy", MEDIA_CAPTURE_PERMISSIONS_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
