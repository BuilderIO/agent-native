export const DESKTOP_LOCAL_CODE_CHANGE_EVENT =
  "agent-native:desktop-local-code-change";

export interface DesktopLocalCodeChangeDetail {
  prompt: string;
}

/**
 * Ask an embedding desktop shell to prepare a local code-change workspace.
 * The optional target keeps bubbling events scoped to the shell that owns the
 * chat card while preserving a window fallback for standalone consumers.
 */
export function requestDesktopLocalCodeChange(
  prompt: string,
  target: EventTarget | null = typeof window === "undefined" ? null : window,
): boolean {
  const trimmed = prompt.trim();
  if (!trimmed || !target) return false;

  target.dispatchEvent(
    new CustomEvent<DesktopLocalCodeChangeDetail>(
      DESKTOP_LOCAL_CODE_CHANGE_EVENT,
      {
        bubbles: true,
        detail: { prompt: trimmed },
      },
    ),
  );
  return true;
}
