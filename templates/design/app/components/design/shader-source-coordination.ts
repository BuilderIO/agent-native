export type ShaderSourceTransform = (html: string) => {
  html: string;
  errors: string[];
};

export type ShaderSourceEditResult =
  | { status: "applied" | "unchanged" }
  | { status: "failed"; error: string };

export interface ShaderEditorContext {
  designId?: string;
  fileId?: string;
  content?: string;
  nodeId?: string;
  selector?: string;
  onApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
    previousContent?: string,
  ) => void;
  editSource?: (transform: ShaderSourceTransform) => ShaderSourceEditResult;
}

// Source actions and editor-local writes share a file, so serialize their commits.
const shaderWriteLocks = new Map<string, Promise<void>>();

export function isShaderWriteInFlight(fileId: string | undefined): boolean {
  return !!fileId && shaderWriteLocks.has(fileId);
}

export async function waitForShaderWriteToSettle(
  fileId: string | undefined,
): Promise<void> {
  if (!fileId) return;
  const pending = shaderWriteLocks.get(fileId);
  if (pending) await pending;
}

export function withShaderWriteLock<T>(
  fileId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = shaderWriteLocks.get(fileId) ?? Promise.resolve();
  const run = previous.then(fn);
  const settleMarker = run.then(
    () => undefined,
    () => undefined,
  );
  shaderWriteLocks.set(fileId, settleMarker);
  void settleMarker.finally(() => {
    if (shaderWriteLocks.get(fileId) === settleMarker)
      shaderWriteLocks.delete(fileId);
  });
  return run;
}

export function broadcastShaderMessage(message: Record<string, unknown>): void {
  if (typeof document === "undefined") return;
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe")) {
    try {
      frame.contentWindow?.postMessage(message, "*");
      // coercion-ok: detached frames cannot receive an optional rescan notification; continue notifying live frames.
    } catch {}
  }
}
