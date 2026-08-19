// @vitest-environment happy-dom

import type { AppConfig, AppDefinition } from "@shared/app-registry";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { buildGuestThemeScript } from "../lib/theme.js";
import {
  APP_WEBVIEW_PREFERENCES,
  buildGuestAppChatSidebarStateScript,
  resolveAppWebviewPartition,
  resolveAppWebviewAuthState,
  resolveAppWebviewUrl,
  isDesktopIdentityAuthenticated,
  isDesktopIdentityGateEligible,
  isDesktopIdentityGateUnauthenticated,
  shouldSuppressDesktopSignInPrompt,
  resolveGuestChatCommand,
  resolveDesktopIdentityLazySyncStatus,
  rememberDesktopIdentityStatus,
  invalidateRememberedDesktopIdentityStatus,
  shouldReuseRememberedDesktopIdentitySession,
  default as AppWebview,
} from "./AppWebview.js";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

beforeAll(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
  }
});

describe("Desktop identity lazy child synchronization", () => {
  it("does not demote a verified workspace session when child sync fails", () => {
    expect(resolveDesktopIdentityLazySyncStatus("signed-in", false)).toBe(
      "signed-in",
    );
    expect(resolveDesktopIdentityLazySyncStatus("signed-in", true)).toBe(
      "signed-in",
    );
  });

  it("reuses a verified workspace session when an app tab is activated", () => {
    expect(shouldReuseRememberedDesktopIdentitySession("signed-in")).toBe(true);
    expect(
      shouldReuseRememberedDesktopIdentitySession("sign-in-required"),
    ).toBe(false);
    expect(
      shouldReuseRememberedDesktopIdentitySession("signed-in", "signed-in"),
    ).toBe(false);
    expect(
      shouldReuseRememberedDesktopIdentitySession(
        "signed-in",
        undefined,
        Date.now() - 60_000,
      ),
    ).toBe(true);
    expect(
      shouldReuseRememberedDesktopIdentitySession(
        "signed-in",
        undefined,
        Date.now() - 10 * 60_000,
      ),
    ).toBe(false);
  });
});

describe("Desktop identity activation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    Object.defineProperty(HTMLElement.prototype, "executeJavaScript", {
      configurable: true,
      value: () => Promise.resolve(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    invalidateRememberedDesktopIdentityStatus();
  });

  it("keeps a remembered session gated until child synchronization completes", async () => {
    let resolveSynchronization!: (synchronized: boolean) => void;
    const ensureAppSession = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSynchronization = resolve;
        }),
    );
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        identity: {
          getSettings: vi.fn(async () => ({ ssoEnabled: true })),
          getStatus: vi.fn(async () => "signed-in"),
          ensureAppSession,
          onStatusChange: vi.fn(() => () => {}),
          signIn: vi.fn(async () => true),
          authenticate: vi.fn(async () => ({ ok: true })),
          requestMagicLink: vi.fn(async () => ({ ok: true })),
        },
      },
    });
    rememberDesktopIdentityStatus("signed-in");
    root = createRoot(container);

    const app: AppDefinition = {
      id: "mail",
      name: "Mail",
      icon: "mail",
      description: "",
      devPort: 3000,
    };
    const appConfig: AppConfig = {
      id: "mail",
      name: "Mail",
      icon: "mail",
      description: "",
      url: "https://mail.agent-native.com",
      devPort: 3000,
      isBuiltIn: true,
      enabled: true,
      mode: "prod",
    };

    act(() => {
      root.render(
        React.createElement(AppWebview, {
          app,
          appConfig,
          isActive: true,
          theme: "dark",
        }),
      );
    });
    await vi.waitFor(() =>
      expect(ensureAppSession).toHaveBeenCalledWith("mail"),
    );

    const webviewSlot = [
      ...container.querySelectorAll(".webview-slot > div"),
    ].find((element) => element.querySelector("webview")) as
      | HTMLElement
      | undefined;
    expect(webviewSlot?.style.display).toBe("none");
    expect(container.textContent).not.toContain("Checking...");

    await act(async () => {
      resolveSynchronization(true);
      await Promise.resolve();
    });

    expect(webviewSlot?.style.display).toBe("flex");
  });

  it("invalidates a remembered session when lazy sync is rejected", async () => {
    let syncAttempts = 0;
    const getStatus = vi.fn(async () => "signed-in" as const);
    const ensureAppSession = vi.fn(async () => {
      syncAttempts += 1;
      return syncAttempts > 1;
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        identity: {
          getSettings: vi.fn(async () => ({ ssoEnabled: true })),
          getStatus,
          ensureAppSession,
          onStatusChange: vi.fn(() => () => {}),
        },
      },
    });
    rememberDesktopIdentityStatus("signed-in");
    root = createRoot(container);

    const app = {
      id: "mail",
      name: "Mail",
      icon: "mail",
      description: "",
      devPort: 3000,
    };
    const appConfig = {
      ...app,
      url: "https://mail.agent-native.com",
      isBuiltIn: true,
      enabled: true,
      mode: "prod" as const,
    };

    act(() => {
      root.render(
        React.createElement(AppWebview, {
          app,
          appConfig,
          isActive: true,
          theme: "dark",
        }),
      );
    });
    await vi.waitFor(() => expect(ensureAppSession).toHaveBeenCalledTimes(1));

    act(() => {
      root.render(
        React.createElement(AppWebview, {
          app,
          appConfig,
          isActive: false,
          theme: "dark",
        }),
      );
    });
    act(() => {
      root.render(
        React.createElement(AppWebview, {
          app,
          appConfig,
          isActive: true,
          theme: "dark",
        }),
      );
    });
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
    expect(ensureAppSession).toHaveBeenCalledTimes(2);
  });

  it("does not extend the remembered-session TTL on cached activation", async () => {
    const now = vi.spyOn(Date, "now");
    let currentTime = 1_000_000;
    now.mockImplementation(() => currentTime);
    try {
      const getStatus = vi.fn(async () => "signed-in" as const);
      Object.defineProperty(window, "electronAPI", {
        configurable: true,
        value: {
          identity: {
            getSettings: vi.fn(async () => ({ ssoEnabled: true })),
            getStatus,
            ensureAppSession: vi.fn(async () => true),
            onStatusChange: vi.fn(() => () => {}),
          },
        },
      });
      rememberDesktopIdentityStatus("signed-in", currentTime);
      root = createRoot(container);
      const app = {
        id: "mail",
        name: "Mail",
        icon: "mail",
        description: "",
        devPort: 3000,
      };
      const appConfig = {
        ...app,
        url: "https://mail.agent-native.com",
        isBuiltIn: true,
        enabled: true,
        mode: "prod" as const,
      };

      act(() => {
        root.render(
          React.createElement(AppWebview, {
            app,
            appConfig,
            isActive: true,
            theme: "dark",
          }),
        );
      });
      await vi.waitFor(() => expect(getStatus).not.toHaveBeenCalled());

      currentTime += 5 * 60 * 1000 + 1;
      act(() => {
        root.render(
          React.createElement(AppWebview, {
            app,
            appConfig,
            isActive: false,
            theme: "dark",
          }),
        );
      });
      act(() => {
        root.render(
          React.createElement(AppWebview, {
            app,
            appConfig,
            isActive: true,
            theme: "dark",
          }),
        );
      });
      await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
    } finally {
      now.mockRestore();
    }
  });
});

describe("Desktop identity gate eligibility", () => {
  it("covers canonical production apps but not browser surfaces", () => {
    expect(
      isDesktopIdentityGateEligible(
        { id: "mail" },
        {
          isBuiltIn: true,
          mode: "prod",
          url: "https://mail.agent-native.com",
        },
      ),
    ).toBe(true);
    expect(
      isDesktopIdentityGateEligible(
        { id: "mail" },
        {
          isBuiltIn: true,
          mode: "prod",
          url: "https://mail.agent-native.com",
        },
        "https://example.com",
      ),
    ).toBe(false);
    expect(
      isDesktopIdentityGateEligible(
        { id: "mail" },
        {
          isBuiltIn: true,
          mode: "prod",
          url: "https://example.com/mail",
        },
      ),
    ).toBe(false);
  });

  it("requires an explicit opt-in for custom production apps", () => {
    expect(
      isDesktopIdentityGateEligible(
        { id: "workspace-reports" },
        {
          isBuiltIn: false,
          mode: "prod",
          url: "https://workspace.example/reports",
          workspaceSso: false,
        },
      ),
    ).toBe(false);
    expect(
      isDesktopIdentityGateEligible(
        { id: "workspace-reports" },
        {
          isBuiltIn: false,
          mode: "prod",
          url: "https://workspace.example/reports",
          workspaceSso: true,
        },
      ),
    ).toBe(true);
  });

  it("does not gate local development apps", () => {
    expect(
      isDesktopIdentityGateEligible(
        { id: "workspace-reports" },
        {
          isBuiltIn: false,
          mode: "dev",
          url: "https://workspace.example/reports",
          workspaceSso: true,
        },
      ),
    ).toBe(false);
  });

  it("only suppresses the ordinary prompt when the canary broker is available", () => {
    const app = {
      id: "workspace-reports",
      isBuiltIn: false,
      mode: "prod" as const,
      url: "https://workspace.example/reports",
      workspaceSso: true,
    };
    expect(shouldSuppressDesktopSignInPrompt(app, app, false)).toBe(false);
    expect(shouldSuppressDesktopSignInPrompt(app, app, true)).toBe(true);
  });
});

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

  it("reports only native sign-in gate states as unauthenticated", () => {
    expect(isDesktopIdentityGateUnauthenticated("sign-in-required")).toBe(true);
    expect(isDesktopIdentityGateUnauthenticated("failed")).toBe(true);
    expect(isDesktopIdentityGateUnauthenticated("checking")).toBe(false);
    expect(isDesktopIdentityGateUnauthenticated("signed-in")).toBe(false);
    expect(isDesktopIdentityGateUnauthenticated("idle")).toBe(false);
    expect(isDesktopIdentityAuthenticated("signed-in")).toBe(true);
    expect(isDesktopIdentityAuthenticated("sign-in-required")).toBe(false);
    expect(isDesktopIdentityAuthenticated("checking")).toBe(false);
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
