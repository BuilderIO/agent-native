import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { Countdown } from "./overlays/countdown";
import { Toolbar } from "./overlays/toolbar";
import { Bubble } from "./overlays/bubble";
import { Finalizing } from "./overlays/finalizing";
import { Onboarding } from "./overlays/onboarding";
import { MeetingNotification } from "./overlays/meeting-notification";
import { MeetingNub } from "./overlays/meeting-nub";
import { FlowBar } from "./overlays/flow-bar";
import "./styles.css";

/**
 * One bundle, one HTML, nine views. We pick which component to mount based
 * on the URL hash so each Tauri window (spawned from Rust with
 * `index.html#<name>`) renders only what it needs.
 */
function pickRoute(): React.ReactElement {
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  switch (hash) {
    case "countdown":
      return <Countdown />;
    case "toolbar":
      return <Toolbar />;
    case "bubble":
      return <Bubble />;
    case "finalizing":
      return <Finalizing />;
    case "onboarding":
      return <Onboarding />;
    case "meeting-notif":
      return <MeetingNotification />;
    case "meeting-nub":
      return <MeetingNub />;
    case "flow-bar":
      return <FlowBar />;
    default:
      return <App />;
  }
}

/**
 * Last-ditch cleanup on window teardown.
 *
 * React cleanup doesn't always run when a Tauri webview is destroyed — in
 * production the window close path tears down the webview process directly
 * without giving React a chance to flush effect cleanups. That's usually
 * fine for our overlay windows (the whole webview heap goes with them),
 * but the popover webview stays alive across entire recording sessions,
 * and hot-reload in dev can tear down the JS page without React cleanup
 * firing either. `beforeunload` catches those paths.
 *
 * We iterate every `<video>` and `<canvas>` on the page, pause + null
 * their sources, and stop any MediaStreamTrack attached via `srcObject`.
 * This is belt-and-suspenders — the effects should already have done it,
 * but if one didn't (because its unlisten was still a pending promise,
 * or because an exception short-circuited the cleanup), this catches it.
 */
function installBeforeUnloadCleanup(): void {
  const cleanup = () => {
    try {
      for (const el of Array.from(document.querySelectorAll("video"))) {
        try {
          const v = el as HTMLVideoElement;
          const src = v.srcObject as MediaStream | null;
          if (src && typeof src.getTracks === "function") {
            for (const t of src.getTracks()) {
              try {
                t.stop();
              } catch {
                // ignore
              }
            }
          }
          try {
            v.pause();
          } catch {
            // ignore
          }
          v.srcObject = null;
          v.src = "";
          v.removeAttribute("src");
          try {
            v.load();
          } catch {
            // ignore
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore — best-effort
    }
  };
  window.addEventListener("beforeunload", cleanup, { capture: true });
  window.addEventListener("pagehide", cleanup, { capture: true });
}

/**
 * Dev-only heap growth logger. Every 30s we dump
 * `performance.memory.usedJSHeapSize` with a short context tag so leak
 * hunting is observable from the devtools console without instrumenting
 * anything further. No-op in production (and no-op on browsers/webviews
 * that don't expose `performance.memory`, which is a Chromium/WebKit-ish
 * non-standard API).
 */
function installHeapDebugLog(): void {
  if (!import.meta.env.DEV) return;
  const perf = performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  };
  if (!perf.memory) return;
  const tag = window.location.hash.replace(/^#/, "").toLowerCase() || "popover";
  const fmt = (n: number | undefined) =>
    n == null ? "?" : `${(n / (1024 * 1024)).toFixed(1)}MB`;
  setInterval(() => {
    const m = perf.memory;
    if (!m) return;
    console.log(
      `[clips-heap][${tag}] used=${fmt(m.usedJSHeapSize)} total=${fmt(m.totalJSHeapSize)} limit=${fmt(m.jsHeapSizeLimit)}`,
    );
  }, 30_000);
}

const rootEl = document.getElementById("root");
if (rootEl) {
  installBeforeUnloadCleanup();
  installHeapDebugLog();
  // NOTE: intentionally NOT wrapping in React.StrictMode. StrictMode
  // double-mounts effects in development, which means every useEffect
  // that invokes a Tauri command runs twice (show_bubble / resize_popover
  // / etc.), producing the rapid-fire flicker we were seeing where the
  // camera bubble re-created itself ~30 times a second. Tauri windows
  // are real OS resources — not an environment where double-mount is
  // harmless.
  ReactDOM.createRoot(rootEl).render(pickRoute());
}
