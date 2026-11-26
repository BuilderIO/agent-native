const NATIVE_CAPTURE_ERRORS = [
  ["display_unavailable", "NativeCaptureDisplayUnavailableError"],
  ["upload_credentials_missing", "NativeCaptureUploadUnavailableError"],
  ["native_take_saved_locally", "NativeTakeSavedLocallyError"],
] as const;

export type NativeCaptureErrorCode = (typeof NATIVE_CAPTURE_ERRORS)[number][0];

export class NativeCaptureError extends Error {
  readonly code: NativeCaptureErrorCode;

  constructor(code: NativeCaptureErrorCode, name: string, message: string) {
    super(message);
    this.code = code;
    this.name = name;
  }
}

export function nativeCaptureError(cause: unknown): NativeCaptureError | null {
  const message = cause instanceof Error ? cause.message : String(cause);
  for (const [code, name] of NATIVE_CAPTURE_ERRORS) {
    if (message.startsWith(`${code}:`)) {
      return new NativeCaptureError(code, name, message);
    }
  }
  return null;
}

const TYPED_CAPTURE_START_ERRORS = new Set<string>([
  "RecordingTeardownUnconfirmedError",
  "CaptureStartAbortedError",
  "CaptureTeardownUnconfirmedError",
  ...NATIVE_CAPTURE_ERRORS.map(([, name]) => name),
]);

export function isTypedCaptureStartError(error: unknown): error is Error {
  return error instanceof Error && TYPED_CAPTURE_START_ERRORS.has(error.name);
}
