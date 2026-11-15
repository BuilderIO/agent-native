/**
 * Who holds the push-to-talk dictation on the frontend, driven only by the
 * native `voice:shortcut-start` / `voice:shortcut-stop` events. Native code
 * decides ownership (only an input that owns the press gets a start), so
 * this follows it: a key start takes the press over from a link, a link up
 * only stops a dictation its own down started, and hands-free clears it.
 */
export type DictationPressOwner = "none" | "link" | "key";

export type DictationInputEvent =
  | { kind: "start"; source: "link"; stopOnly?: boolean }
  | { kind: "start"; source: "link-hands-free" }
  | { kind: "start"; source: "key" }
  | { kind: "stop"; source: "link" | "key" };

export type DictationInputAction =
  /** Start a push-to-talk link dictation. */
  | "start-link"
  /** Stop the link's dictation (never read as a key tap). */
  | "stop-link"
  /** Stop the running hands-free dictation. */
  | "stop-hands-free"
  /** Start or stop a hands-free dictation from the link. */
  | "hands-free-link"
  /** The dictation key's own start/stop handling. */
  | "key"
  | "ignore";

export interface DictationInputContext {
  handsFree: boolean;
  /** A dictation is running or starting. */
  busy: boolean;
}

export function reduceDictationInput(
  owner: DictationPressOwner,
  event: DictationInputEvent,
  context: DictationInputContext,
): { owner: DictationPressOwner; action: DictationInputAction } {
  if (event.kind === "start") {
    switch (event.source) {
      case "link-hands-free":
        return { owner: "none", action: "hands-free-link" };
      case "link":
        if (context.handsFree) return { owner, action: "stop-hands-free" };
        // A dictation this press didn't start: leave it, and its up with it.
        if (event.stopOnly || context.busy) return { owner, action: "ignore" };
        return { owner: "link", action: "start-link" };
      case "key":
        // Native only sends a key start for a press that owns the dictation,
        // including one that replaced a stale link press.
        return { owner: "key", action: "key" };
    }
  }
  if (event.source === "link") {
    if (owner !== "link") return { owner, action: "ignore" };
    if (context.handsFree) return { owner: "none", action: "ignore" };
    return { owner: "none", action: "stop-link" };
  }
  return { owner: owner === "key" ? "none" : owner, action: "key" };
}
