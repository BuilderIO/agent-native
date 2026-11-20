const MESSAGE_FOR_CODE = new Map([
  ["design_unreachable", "designScreen.errorUnreachable"],
  ["design_refused", "designScreen.errorRefused"],
  ["design_signed_out", "designScreen.errorSignedOut"],
  ["design_screen_signed_out", "designScreen.errorSignedOut"],
  ["design_screen_edit_required", "designScreen.errorEditRequired"],
  ["design_screen_wider_than_design", "designScreen.errorPublicPage"],
  ["design_invalid_response", "designScreen.errorUnreadableAnswer"],
]);

export function designScreenErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string | undefined {
  const code = (error as { errorCode?: unknown } | null | undefined)?.errorCode;
  const key = typeof code === "string" ? MESSAGE_FOR_CODE.get(code) : undefined;
  if (key) return t(key);
  return error instanceof Error ? error.message : undefined;
}
