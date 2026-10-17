/**
 * Transport for the Builder host protocol (`design:*` in, `agentNative.*` /
 * `builder.*` / `design:close` out).
 *
 * - `parent-window` (default): the editor runs at `/visual-edit/shell` inside
 *   a cross-origin iframe and talks to `window.parent` with origin checks.
 * - `in-process`: a host page that renders the editor in its own document
 *   installs its own channel with `installInProcessDesignHostChannel`, and the
 *   same messages travel however that host carries them.
 *
 * Call sites only ever use `getDesignHostChannel()`, so the editor does not
 * know or care which one it is running under.
 */
import { getBuilderParentOrigin } from "@agent-native/core/client/host";

import { rememberBuilderHostOrigin } from "@/lib/builder-host-origin";

export interface DesignHostMessage {
  type: string;
  data?: any;
}

export type DesignHostListener = (message: DesignHostMessage) => void;

export interface DesignHostChannel {
  readonly kind: "parent-window" | "in-process";
  /** Origin the editor should treat as "the host" (for logging/bookkeeping). */
  readonly hostOrigin: string | null;
  send(message: DesignHostMessage): void;
  subscribe(listener: DesignHostListener): () => void;
}

function isTrustedBuilderHostOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return (
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

function createParentWindowChannel(): DesignHostChannel {
  let parentOrigin: string | null = null;
  return {
    kind: "parent-window",
    get hostOrigin() {
      return parentOrigin ?? getBuilderParentOrigin();
    },
    send(message) {
      if (typeof window === "undefined" || window.parent === window) return;
      window.parent.postMessage(
        message,
        parentOrigin ?? getBuilderParentOrigin() ?? "*",
      );
    },
    subscribe(listener) {
      if (typeof window === "undefined") return () => {};
      function onMessage(event: MessageEvent) {
        if (event.source !== window.parent) return;
        const origin = event.origin ?? "";
        if (!isTrustedBuilderHostOrigin(origin)) return;
        const data = event.data;
        if (!data || typeof data.type !== "string") return;
        if (data.type === "design:init" && !parentOrigin) {
          parentOrigin = origin;
          rememberBuilderHostOrigin(origin);
        }
        listener(data);
      }
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    },
  };
}

let inProcessChannel: DesignHostChannel | null = null;
let parentWindowChannel: DesignHostChannel | null = null;

export function installInProcessDesignHostChannel(
  channel: DesignHostChannel | null,
): void {
  inProcessChannel = channel;
}

/** True when a host page mounted the editor directly (no iframe). */
export function isInProcessDesignHost(): boolean {
  return inProcessChannel !== null;
}

export function getDesignHostChannel(): DesignHostChannel {
  if (inProcessChannel) return inProcessChannel;
  parentWindowChannel ??= createParentWindowChannel();
  return parentWindowChannel;
}

/**
 * True whenever a host page mounted the editor in its own document, in either
 * mode (shell canvas or production editor). Document-level side effects
 * (title, history, `<html>` classes) belong to the host then.
 */
let hostedInProcess = false;

export function markHostedInProcess(hosted: boolean): void {
  hostedInProcess = hosted;
}

export function isHostedInProcess(): boolean {
  return hostedInProcess || inProcessChannel !== null;
}
