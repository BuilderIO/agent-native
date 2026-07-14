import type { H3Event } from "h3";
import { getRequestURL } from "h3";

import { noteRequestOrigin } from "../lib/post-finalize-dispatch.js";

interface NitroAppLike {
  hooks: {
    hook: (name: string, fn: (event: H3Event) => void) => void;
  };
}

/**
 * Remember the origin real clients reach this server on, so background
 * self-dispatches (post-finalize worker) target the actual host/port
 * instead of an env-guessed default that pointed at :3000 in local dev.
 */
export default (nitroApp: NitroAppLike) => {
  nitroApp.hooks.hook("request", (event) => {
    try {
      noteRequestOrigin(getRequestURL(event).origin);
    } catch {
      // Origin capture is best-effort.
    }
  });
};
