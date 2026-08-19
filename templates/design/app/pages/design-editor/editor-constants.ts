export const MAX_GENERATION_ATTEMPTS = 3;
export const AUTO_RETRY_DELAY_MS = 1200;
export const HOST_CHAT_SLOT_MESSAGE = "agentNative.chatSlot";
export const STORED_RUN_LIVENESS_GRACE_MS = 20_000;

export const OVERVIEW_ZOOM_THRESHOLD = 60;
export const MOTION_DOCK_TRANSITION_MS = 200;
export const MOTION_DOCK_EXIT_SETTLE_MS = 80;
export const MOTION_DOCK_EXIT_FALLBACK_MS = MOTION_DOCK_TRANSITION_MS * 2 + 600;
export const MOTION_AUTOSAVE_DELAY_MS = 500;
export const DESIGN_SELECTION_ZOOM_SAVE_DELAY_MS = 150;

/** Retry window for dropping an untouched text node whose screen content has
 *  not caught up with the insert yet — see removeEmptyTextNodeWithRetry. */
export const EMPTY_TEXT_CLEANUP_RETRY_MS = 400;

/** Floor for an inspector-typed frame size, matching the frame tool's own
 *  drawing minimum (see getDraftGeometryForTool). */
export const MIN_FRAME_SIZE_PX = 24;
export const BOARD_SURFACE_SIZE = 131_072;

/** Gates non-essential diagnostic console.warn calls (e.g. the cross-screen
 * anchor-stamp fallback warning) so production consoles stay quiet while
 * dev builds keep the signal. Real correctness-guard warnings (frame
 * geometry rejection, poisoned-coord normalization) stay unconditional —
 * this flag is only for lower-signal "known degraded path taken" notices. */
export const DESIGN_EDITOR_DEBUG_LOGS = import.meta.env.DEV;

/** Extensions that the localhost bridge allows to be written back to source. */
export const LOCALHOST_WRITE_EXTENSIONS = new Set([".html", ".htm", ".css"]);

/**
 * Compiled framework route extensions we can *detect* as local source but
 * cannot yet write back to (React/TS component files require build-time
 * source mapping, not a raw HTML/CSS write). "Apply to source" shows as a
 * disabled affordance with an explanatory tooltip for these instead of
 * disappearing entirely.
 */
export const LOCALHOST_COMPILED_SOURCE_EXTENSIONS = new Set([".jsx", ".tsx"]);

export const NO_LOCALHOST_WRITE_CONTENT_MESSAGE =
  "No content to write. Open the screen first."; /* i18n-ignore */
export const NO_LOCALHOST_CONNECTION_MESSAGE =
  "No localhost connection for this screen. Reconnect and try again."; /* i18n-ignore */
export const NO_LOCALHOST_WRITE_PATH_MESSAGE =
  "Can't determine the source file for this screen."; /* i18n-ignore */
export const TWEAK_CONTROLS_EDIT_ACCESS_MESSAGE =
  "You need edit access to add tweak controls."; /* i18n-ignore */

export const PENDING_STRUCTURE_VERIFICATION_TIMEOUT_MS = 60_000;
export const PENDING_STRUCTURE_RUNTIME_TIMEOUT_MS = 15_000;
export const PENDING_STRUCTURE_SOURCE_POLL_MS = 750;
export const PENDING_STRUCTURE_RUNTIME_POLL_MS = 150;
