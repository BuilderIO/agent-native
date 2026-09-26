// @agent-native/pinpoint — Unified freeze controller
// MIT License
//
// Lazy initialization — nothing is patched until first freeze() call.

import { freezeCSS } from "./css-freeze.js";
import { freezeJSTimers } from "./js-freeze.js";
import { freezeMedia } from "./media-freeze.js";
import { freezeReact } from "./react-freeze.js";
import { freezeWAAPI } from "./waapi-freeze.js";

let cleanups: Array<() => void> = [];
let active = false;

export interface FreezeOptions {
  jsTimers?: boolean;
}

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

export function isFreezeActive(): boolean {
  return active;
}
