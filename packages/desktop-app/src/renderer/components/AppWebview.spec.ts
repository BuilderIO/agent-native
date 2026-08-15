// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { buildGuestThemeScript } from "../lib/theme.js";
import {
  APP_WEBVIEW_PREFERENCES,
  buildGuestAppChatSidebarStateScript,
  resolveAppWebviewPartition,
  resolveAppWebviewAuthState,
  resolveAppWebviewUrl,
  resolveGuestChatCommand,
} from "./AppWebview.js";

describe("AppWebview auth state", () => {
  it("recognizes framework and app-base sign-in routes", () => {
    expect(
      resolveAppWebviewAuthState(
        "https://calendar.agent-native.com/_agent-native/sign-in?return=%2F",
      ),
    ).toBe("unauthenticated");
    expect(
      resolveAppWebviewAuthState(
        "https://dispatch.agent-native.com/calendar/login",
      ),
    ).toBe("unauthenticated");
  });

  it("treats a normal app route as authenticated and blank pages as unknown", () => {
    expect(
      resolveAppWebviewAuthState("https://mail.agent-native.com/inbox"),
    ).toBe("authenticated");
    expect(resolveAppWebviewAuthState("about:blank")).toBe("unknown");
  });
});

describe("AppWebview partition selection", () => {
  it("keeps chat-first preview webviews on the app partition", () => {
    expect(
      resolveAppWebviewPartition({
        appId: "app-1",
        sourceUrl: "https://preview.example.com",
      }),
    ).toBe("persist:chat-first-browser");
    expect(
      resolveAppWebviewPartition({
        appId: "app-1",
        sourceUrl: "https://preview.example.com",
        partitionKey: "persist:app-app-1",
      }),
    ).toBe("persist:app-app-1");
  });

  it("keeps app tabs on their app-scoped partition", () => {
    expect(
      resolveAppWebviewPartition({
        appId: "app-1",
      }),
    ).toBe("persist:app-app-1");
  });
});

describe("AppWebview URL resolution", () => {
  const app = {
    id: "mail",
    name: "Mail",
    icon: "Mail",
    description: "Mail",
    devPort: 3003,
  };

  it("loads development apps directly instead of through the local frame", () => {
    expect(
      resolveAppWebviewUrl(app, {
        ...app,
        url: "https://mail.agent-native.com",
        devUrl: "http://localhost:3003",
        isBuiltIn: true,
        enabled: true,
        mode: "dev",
      }),
    ).toBe("http://localhost:3003");
  });

  it("uses the production URL by default", () => {
    expect(
      resolveAppWebviewUrl(app, {
        ...app,
        url: "https://mail.agent-native.com",
        devUrl: "http://localhost:3003",
        isBuiltIn: true,
        enabled: true,
      }),
    ).toBe("https://mail.agent-native.com");
  });

  it("falls back to the direct development port", () => {
    expect(
      resolveAppWebviewUrl(app, {
        ...app,
        url: "https://mail.agent-native.com",
        isBuiltIn: true,
        enabled: true,
        mode: "dev",
      }),
    ).toBe("http://localhost:3003");
  });
});

describe("AppWebview runtime preferences", () => {
  it("keeps guest pages eligible for Chromium background throttling", () => {
    expect(APP_WEBVIEW_PREFERENCES).toContain("backgroundThrottling=true");
    expect(APP_WEBVIEW_PREFERENCES).not.toContain("backgroundThrottling=false");
  });
});

describe("AppWebview per-app chat state propagation", () => {
  it("maps guest chat commands to host sidebar events", () => {
    expect(resolveGuestChatCommand("toggle")).toBe("agent-panel:toggle");
    expect(resolveGuestChatCommand("open")).toBe("agent-panel:open");
    expect(resolveGuestChatCommand("close")).toBe("agent-panel:close");
    expect(resolveGuestChatCommand("ignore")).toBeNull();
  });

  it("dispatches the host chat state inside the guest document", () => {
    let state: unknown;
    const handleState = (event: Event) => {
      state = (event as CustomEvent<{ open?: unknown; hosted?: unknown }>)
        .detail;
    };
    window.addEventListener("agent-native:per-app-chat-state", handleState);

    try {
      window.eval(buildGuestAppChatSidebarStateScript(true));
      expect(state).toEqual({ open: true, hosted: true });
    } finally {
      window.removeEventListener(
        "agent-native:per-app-chat-state",
        handleState,
      );
    }
  });
});

describe("AppWebview theme propagation", () => {
  it("updates the guest root and shared theme storage", () => {
    document.documentElement.className = "light";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "light";
    window.localStorage.removeItem("theme");

    let changeDetail: unknown;
    const onThemeChange = (event: Event) => {
      changeDetail = (event as CustomEvent).detail;
    };
    window.addEventListener("agent-native:theme-change", onThemeChange);

    try {
      new Function(buildGuestThemeScript("dark"))();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.classList.contains("light")).toBe(false);
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
      expect(window.localStorage.getItem("theme")).toBe("dark");
      expect(changeDetail).toEqual({
        type: "agent-native-theme-update",
        theme: "dark",
        isDark: true,
      });
    } finally {
      window.removeEventListener("agent-native:theme-change", onThemeChange);
    }
  });
});
