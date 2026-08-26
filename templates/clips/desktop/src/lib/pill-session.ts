/**
 * What the recording pill does when the recorder flips `clips:toolbar-enabled`.
 *
 * The pill's window outlives a single take: a restart reuses it for the
 * replacement session, and the completion card keeps it open after a stop. So
 * "enabled" is not simply "show the controls" — it also decides whether the
 * previous session's card is retired.
 */

export type PillMode = "recording" | "confirm" | "done";

export type ToolbarEnabledEffect =
  /** A live session is taking a window still showing the last take's card. */
  | "adopt-new-session"
  /** No session owns the pill: snap the segments back to their rest state. */
  | "reset-to-rest"
  /** Leave the pill exactly as it is. */
  | "keep";

export function toolbarEnabledEffect(
  enabled: boolean,
  mode: PillMode,
): ToolbarEnabledEffect {
  if (enabled) {
    // A confirm strip is deliberately NOT rescued here. The recorder re-emits
    // `toolbar-enabled(true)` on every `toolbar-ready` handshake, so resetting
    // on enable would close a question the user is still reading. Answering a
    // confirm therefore has to leave confirm mode at the point of the answer.
    return mode === "done" ? "adopt-new-session" : "keep";
  }
  // The completion card owns the window after a stop; disabling the controls
  // must not wipe it out from under the user.
  return mode === "done" ? "keep" : "reset-to-rest";
}
