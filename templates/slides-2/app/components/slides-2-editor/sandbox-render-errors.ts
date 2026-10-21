export type SandboxRenderErrorKey =
  | "editorExport.renderFormatUnsupported"
  | "editorExport.unsafeAssetOrigin"
  | "editorExport.exportFailed";

const KNOWN_RENDER_ERRORS: Record<string, SandboxRenderErrorKey> = {
  "invalid-slide-render-artifact": "editorExport.renderFormatUnsupported",
  "secure-slide-render-unavailable": "editorExport.exportFailed",
  "slide-render-failed": "editorExport.exportFailed",
  "slide-render-timeout": "editorExport.exportFailed",
  "unsafe-slide-asset-origin": "editorExport.unsafeAssetOrigin",
};

export function getSandboxRenderErrorKey(
  error: unknown,
): SandboxRenderErrorKey | null {
  if (!(error instanceof Error)) return null;
  if (KNOWN_RENDER_ERRORS[error.message])
    return KNOWN_RENDER_ERRORS[error.message]!;
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(error.message)
    ? "editorExport.exportFailed"
    : null;
}
