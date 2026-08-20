import { invoke } from "@tauri-apps/api/core";
import React from "react";
import ReactDOM from "react-dom/client";

import { App, installAuthFetchInterceptor } from "./app";
import { installBrowserPreview } from "./dev/browser-preview";
import { initDesktopSentry } from "./lib/sentry";
import { asDesktopSettingsTab } from "./lib/settings-navigation";
import { Bubble } from "./overlays/bubble";
import { Countdown } from "./overlays/countdown";
import { Finalizing } from "./overlays/finalizing";
import { FlowBar } from "./overlays/flow-bar";
import { MeetingNotification } from "./overlays/meeting-notification";
import { MeetingNub } from "./overlays/meeting-nub";
import { MonitorPicker } from "./overlays/monitor-picker";
import { Preparing } from "./overlays/preparing";
import { RecordingPill } from "./overlays/recording-pill";
import { RegionGuideEditor, RegionGuides } from "./overlays/region-guides";
import { RegionRecordBorder } from "./overlays/region-record-border";
import { Toolbar } from "./overlays/toolbar";

// Imports styles.css itself, into a lower cascade layer — see tailwind.css.
import "./tailwind.css";

/**
 * One bundle, one HTML, many views. We pick which component to mount based
 * on the URL hash so each Tauri window (spawned from Rust with
 * `index.html#<name>`) renders only what it needs.
 */
function currentRoute(): string {
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  // `#settings/advanced` names a surface plus where to open it; the route is
  // the part before the slash.
  return hash.split("/")[0] || "popover";
}

/** `#settings/advanced` → "advanced". */
function currentRouteDetail(): string | undefined {
  return window.location.hash.replace(/^#/, "").toLowerCase().split("/")[1];
}

function installRouteAttributes(route: string): void {
  document.documentElement.dataset.clipsRoute = route;
  document.body.dataset.clipsRoute = route;
}

function pickRoute(route: string): React.ReactElement {
  switch (route) {
    case "countdown":
      return <Countdown />;
    case "toolbar":
      return <Toolbar />;
    case "bubble":
      return <Bubble />;
    case "finalizing":
      return <Finalizing />;
    case "preparing":
      return <Preparing />;
    case "meeting-notif":
      return <MeetingNotification />;
    case "meeting-nub":
      return <MeetingNub />;
    case "flow-bar":
      return <FlowBar />;
    case "recording-pill":
      return <RecordingPill />;
    case "region-guides":
      return <RegionGuides />;
    case "region-guides-editor":
      return <RegionGuideEditor />;
    case "region-capture-selector":
      return <RegionGuideEditor mode="capture" />;
    case "region-record-border":
      return <RegionRecordBorder />;
    case "monitor-picker":
      return <MonitorPicker />;
    // Opens the popover straight onto Settings. Rust never spawns this route —
    // it exists so `#settings` / `#settings/advanced` reaches the surface
    // directly in a browser tab or a dev window.
    case "settings":
      return (
        <App
          initialView="settings"
          initialSettingsTab={asDesktopSettingsTab(currentRouteDetail())}
        />
      );
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
  const tag = currentRoute();
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

/**
 * Tee the webview console into the persistent backend log file.
 *
 * In production the webview has no devtools and `console.*` output is lost, so
 * frontend errors can't be debugged after the fact. We wrap each console method
 * to also forward its message to the Rust `frontend_log` command, which prints
 * it into the same redirected stdout/stderr that backs `clips-tray.log`. The
 * original console behavior is preserved (tee, not replace)
 */
function installConsoleCapture(route: string): void {
  const serialize = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value instanceof Error)
      return value.stack || `${value.name}: ${value.message}`;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const forward = (level: string, args: unknown[]): void => {
    try {
      const message = `[${route}] ${args.map(serialize).join(" ")}`;
      // Swallow failures — logging must never throw into the app, and we must
      // not call console here or we'd recurse.
      void invoke("frontend_log", { level, message }).catch(() => {});
    } catch {
      // ignore
    }
  };

  const levels = ["log", "info", "warn", "error", "debug"] as const;
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      forward(level, args);
    };
  }

  window.addEventListener("error", (event) => {
    forward("error", [
      `uncaught: ${event.message}`,
      event.error instanceof Error
        ? event.error
        : `${event.filename}:${event.lineno}`,
    ]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    forward("error", ["unhandledrejection:", event.reason]);
  });
}

const rootEl = document.getElementById("root");
if (rootEl) {
  const route = currentRoute();
  // Before anything reads Tauri internals: outside the app shell this keeps the
  // surfaces mountable in a browser tab. No-ops inside Tauri, absent in prod.
  if (import.meta.env.DEV) installBrowserPreview();
  // Before React renders: covers fetches made during the first commit.
  installAuthFetchInterceptor();
  // `settings` is the popover window showing one of its views, so it takes the
  // popover's shell styling rather than a full-viewport overlay's.
  installRouteAttributes(route === "settings" ? "popover" : route);
  initDesktopSentry(route);
  installConsoleCapture(route);
  installBeforeUnloadCleanup();
  installHeapDebugLog();
  // NOTE: intentionally NOT wrapping in React.StrictMode. StrictMode
  // double-mounts effects in development, which means every useEffect
  // that invokes a Tauri command runs twice (show_bubble / resize_popover
  // / etc.), producing the rapid-fire flicker we were seeing where the
  // camera bubble re-created itself ~30 times a second. Tauri windows
  // are real OS resources — not an environment where double-mount is
  // harmless.
  ReactDOM.createRoot(rootEl).render(pickRoute(route));
}
