import { agentNativePath } from "@agent-native/core/client/api-path";

const MAX_RENDER_REQUEST_BYTES = 5_000_000;
const RENDER_ERROR_FALLBACK = "PNG export rendering failed."; // i18n-ignore: Logged only; the UI shows localized generic copy.

export class NativeExportRenderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "NativeExportRenderError";
  }
}

export async function renderNativeExportPng(args: {
  html: string;
  width: number;
  height: number;
  scale: number;
}): Promise<Blob> {
  const body = JSON.stringify(args);
  if (new TextEncoder().encode(body).byteLength > MAX_RENDER_REQUEST_BYTES) {
    throw new NativeExportRenderError(
      "PNG export request exceeds the 5 MB limit.",
      "export_too_large",
    );
  }
  const capabilityUrl = agentNativePath("/_agent-native/ui-capability");
  const actionUrl = agentNativePath("/_agent-native/actions/render-export-png");
  const request = () =>
    fetch(actionUrl, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Native-Frontend": "1",
      },
      body,
    });

  const capability = await fetch(capabilityUrl, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!capability.ok) {
    throw new Error("Could not authorize the export renderer.");
  }
  const response = await request();

  if (!response.ok) {
    const failure = await response
      .clone()
      .json()
      .then(
        (body: {
          error?: unknown;
          errorCode?: unknown;
          message?: unknown;
        }) => ({
          message:
            typeof body.error === "string"
              ? body.error
              : typeof body.message === "string"
                ? body.message
                : RENDER_ERROR_FALLBACK,
          errorCode:
            typeof body.errorCode === "string" ? body.errorCode : undefined,
        }),
      )
      .catch(() => ({
        message: RENDER_ERROR_FALLBACK,
        errorCode: undefined,
      }));
    throw new NativeExportRenderError(
      failure.message,
      failure.errorCode ??
        (response.status === 413 ? "export_too_large" : "export_failed"),
    );
  }
  if (!response.headers.get("Content-Type")?.startsWith("image/png")) {
    throw new Error("PNG export renderer returned an invalid image.");
  }
  return response.blob();
}
