export function webCaptureUrl(input: {
  clipsBaseUrl: string;
  extensionId: string;
  sessionId: string;
  mode: "screen" | "screen+camera" | "camera";
  surface: "browser" | "window" | "monitor" | "camera";
  developerLogs: boolean;
  diagnosticConsent: boolean;
  requestedHistorySeconds: number;
}): string {
  if (
    !Number.isInteger(input.requestedHistorySeconds) ||
    input.requestedHistorySeconds < 0 ||
    input.requestedHistorySeconds > 300
  )
    throw new RangeError("invalid-diagnostic-history");
  const url = new URL(`${input.clipsBaseUrl.replace(/\/+$/, "")}/record`);
  url.searchParams.set("mode", input.mode);
  if (input.surface !== "camera")
    url.searchParams.set("surface", input.surface);
  url.searchParams.set("clipsExtensionId", input.extensionId);
  url.searchParams.set("clipsCaptureSessionId", input.sessionId);
  url.searchParams.set("developerLogs", input.developerLogs ? "1" : "0");
  if (input.diagnosticConsent) {
    url.searchParams.set("privateContextConsent", "1");
    url.searchParams.set(
      "privateContextHistorySeconds",
      String(input.requestedHistorySeconds),
    );
  }
  return url.toString();
}

export function webCaptureSenderAllowed(input: {
  senderUrl?: string | undefined;
  senderTabId?: number | undefined;
  recorderTabId: number;
  clipsBaseUrl: string;
}): boolean {
  if (!input.senderUrl || input.senderTabId !== input.recorderTabId)
    return false;
  if (!URL.canParse(input.senderUrl) || !URL.canParse(input.clipsBaseUrl))
    return false;
  return new URL(input.senderUrl).origin === new URL(input.clipsBaseUrl).origin;
}
