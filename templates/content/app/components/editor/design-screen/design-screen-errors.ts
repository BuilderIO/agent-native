const MESSAGE_FOR_CODE = new Map([
  ["design_unreachable", "designScreen.errorUnreachable"],
  ["design_refused", "designScreen.errorRefused"],
  ["design_signed_out", "designScreen.errorSignedOut"],
  ["design_screen_signed_out", "designScreen.errorSignedOut"],
  ["design_screen_edit_required", "designScreen.errorEditRequired"],
  ["design_screen_wider_than_design", "designScreen.errorPublicPage"],
  ["design_screen_page_moved", "designScreen.errorPageMoved"],
  ["design_invalid_response", "designScreen.errorUnreadableAnswer"],
  ["design_screen_image_invalid", "designScreen.errorUnreadableAnswer"],
  ["design_screen_storage_unavailable", "designScreen.errorStorageUnavailable"],
]);

const MESSAGE_FOR_DESIGN_CODE = new Map([
  ["design_screen_live_effects", "designScreen.errorLiveEffects"],
  ["design_screen_live_app", "designScreen.errorLiveApp"],
  ["design_screen_navigated_away", "designScreen.errorNavigatedAway"],
  ["design_screen_too_large", "designScreen.errorTooLarge"],
  ["design_screen_render_unavailable", "designScreen.errorRenderUnavailable"],
  ["design_screen_render_busy", "designScreen.errorRenderUnavailable"],
  ["design_screen_render_timeout", "designScreen.errorRenderTimeout"],
]);

export function designScreenErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string | undefined {
  const failure = error as
    | { errorCode?: unknown; details?: { designCode?: unknown } }
    | null
    | undefined;
  const designCode = failure?.details?.designCode;
  const designKey =
    typeof designCode === "string"
      ? MESSAGE_FOR_DESIGN_CODE.get(designCode)
      : undefined;
  if (designKey) return t(designKey);
  const code = failure?.errorCode;
  const key = typeof code === "string" ? MESSAGE_FOR_CODE.get(code) : undefined;
  if (key) return t(key);
  return error instanceof Error ? error.message : undefined;
}
