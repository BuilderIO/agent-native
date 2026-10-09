import type {
  ShaderSourceEditResult,
  ShaderSourceTransform,
} from "@/components/design/inspector/GlslShaderPanel";

export interface ShaderSourceEditArgs {
  /** The editor's own latest copy of the file, including edits not yet saved. */
  getScreenContent: (fileId: string) => string;
  applyFileContentUpdate: (
    fileId: string,
    content: string,
    options: { persist: boolean; recordHistory: boolean },
  ) => { status: string };
  saveFailedMessage: string;
}

/**
 * Edits a file's HTML for the shader picker, through the editor. The server's
 * source actions cannot serve the board (`read-source-file` answers it with an
 * empty file and `apply-source-edit` does not find it), so a shader applied to
 * or removed from a frame drawn there is read from the editor's copy and
 * written back the way every other edit is: saved by the editor, one history
 * step.
 */
export function runShaderSourceEdit(
  {
    getScreenContent,
    applyFileContentUpdate,
    saveFailedMessage,
  }: ShaderSourceEditArgs,
  fileId: string,
  transform: ShaderSourceTransform,
): ShaderSourceEditResult {
  const base = getScreenContent(fileId);
  const result = transform(base);
  if (result.errors.length > 0) {
    return { status: "failed", error: result.errors[0]! };
  }
  if (result.html === base) return { status: "unchanged" };
  const written = applyFileContentUpdate(fileId, result.html, {
    persist: true,
    recordHistory: true,
  });
  return written.status === "refused"
    ? { status: "failed", error: saveFailedMessage }
    : { status: "applied" };
}
