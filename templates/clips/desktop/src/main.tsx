import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
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
import { RecordingPill } from "./overlays/record-pill";
import { MeetingPill } from "./overlays/recording-pill";
import { RegionGuideEditor, RegionGuides } from "./overlays/region-guides";
import { RegionRecordBorder } from "./overlays/region-record-border";

import "./tailwind.css";

function currentRoute(): string {
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  return hash.split("/")[0] || "popover";
}

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
      return <RecordingPill />;
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
      return <MeetingPill />;
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
  if (import.meta.env.DEV) installBrowserPreview();
  installAuthFetchInterceptor();
  installRouteAttributes(route === "settings" ? "popover" : route);
  initDesktopSentry(route);
  installConsoleCapture(route);
  installBeforeUnloadCleanup();
  installHeapDebugLog();
  ReactDOM.createRoot(rootEl).render(
    <AgentNativeI18nProvider persistPreference={false}>
      {pickRoute(route)}
    </AgentNativeI18nProvider>,
  );
}
