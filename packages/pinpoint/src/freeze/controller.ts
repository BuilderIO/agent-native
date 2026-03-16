// @agent-native/pinpoint — Unified freeze controller
// MIT License
//
// Lazy initialization — nothing is patched until first freeze() call.

import { freezeCSS } from "./css-freeze.js";
import { freezeWAAPI } from "./waapi-freeze.js";
import { freezeReact } from "./react-freeze.js";
import { freezeMedia } from "./media-freeze.js";
import { freezeJSTimers } from "./js-freeze.js";

let cleanups: Array<() => void> = [];
let active = false;

export interface FreezeOptions {
  /** Freeze JS timers (opt-in, disabled by default) */
  jsTimers?: boolean;
}

/**
 * Freeze all animations, transitions, React updates, and media.
 * Call unfreeze() to restore.
 */
export function freeze(
  _elements?: Element[],
  options: FreezeOptions = {},
): void {
  if (active) return;
  active = true;

  cleanups = [freezeCSS(), freezeWAAPI(), freezeReact(), freezeMedia()];

  if (options.jsTimers) {
    cleanups.push(freezeJSTimers());
  }
}

/**
 * Unfreeze everything and restore normal behavior.
 */
export function unfreeze(): void {
  if (!active) return;
  active = false;

  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      // Best-effort cleanup
    }
  }
  cleanups = [];
}

/**
 * Check if freeze is currently active.
 */
export function isFreezeActive(): boolean {
  return active;
}
