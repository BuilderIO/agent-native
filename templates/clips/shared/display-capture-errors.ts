/**
 * Error shapes shared by everything that calls `getDisplayMedia`.
 *
 * Both the recorder and the screenshot capture have to tell "the user closed
 * the screen picker" apart from "screen capture is actually blocked": the
 * first is a silent no-op, the second needs an explanation. Browsers report
 * them with overlapping error names, so the test lives in one place.
 */

export function errorName(err: unknown): string {
  return (err as { name?: string } | null)?.name ?? "";
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err || "Unknown error";
  try {
    return JSON.stringify(err) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

export function isScreenPickerDismissal(err: unknown): boolean {
  const name = errorName(err);
  const message = errorMessage(err);
  if (name === "AbortError") return true;
  if (/cancelled|canceled|dismissed/i.test(message)) return true;
  // Chromium reports a user-cancelled screen picker as NotAllowedError with
  // a "by user" / "user denied" signal in the message. A bare NotAllowedError
  // without that signal can be an enterprise-policy block or other genuine
  // denial — surface those as errors instead of silently swallowing them.
  if (
    name === "NotAllowedError" &&
    /by user|user (cancelled|canceled|denied|dismissed)/i.test(message)
  ) {
    return true;
  }
  return false;
}
