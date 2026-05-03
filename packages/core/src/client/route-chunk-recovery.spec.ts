// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  createRouteChunkRecoveryState,
  getFreshIntendedNavigation,
  installRouteChunkRecovery,
  intendedHrefFromClick,
  isDynamicImportFailureMessage,
  isRouteModuleReloadMessage,
  rememberIntendedNavigation,
} from "./route-chunk-recovery.js";

function createFakeWindow(
  startHref = "https://example.com/dispatch/apps",
  opts: { lockReload?: boolean } = {},
) {
  const documentListeners = new Map<string, EventListener[]>();
  const windowListeners = new Map<string, EventListener[]>();
  const originalReload = vi.fn();
  const fakeLocation = {
    href: startHref,
    get origin() {
      return new URL(fakeLocation.href).origin;
    },
    assign: vi.fn((href: string) => {
      fakeLocation.href = href;
    }),
    reload: originalReload,
  };
  if (opts.lockReload) {
    Object.defineProperty(fakeLocation, "reload", {
      configurable: false,
      enumerable: true,
      value: originalReload,
      writable: false,
    });
  }
  const originalPushState = vi.fn(
    (state: unknown, _title: string, url?: string | URL | null) => {
      fakeHistory.state = state;
      if (url) fakeLocation.href = new URL(String(url), fakeLocation.href).href;
    },
  );
  const originalReplaceState = vi.fn(
    (state: unknown, _title: string, url?: string | URL | null) => {
      fakeHistory.state = state;
      if (url) fakeLocation.href = new URL(String(url), fakeLocation.href).href;
    },
  );
  const fakeHistory = {
    state: null as unknown,
    pushState: originalPushState,
    replaceState: originalReplaceState,
  };
  const fakeWindow = {
    document: {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        documentListeners.set(type, [
          ...(documentListeners.get(type) ?? []),
          listener,
        ]);
      }),
    },
    location: fakeLocation,
    history: fakeHistory,
    console: {
      error: vi.fn(),
    },
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      windowListeners.set(type, [
        ...(windowListeners.get(type) ?? []),
        listener,
      ]);
    }),
  } as unknown as Window;

  return {
    fakeWindow,
    fakeLocation,
    fakeHistory,
    originalPushState,
    originalReplaceState,
    originalReload,
    dispatchDocument(type: string, event: Event) {
      for (const listener of documentListeners.get(type) ?? []) listener(event);
    },
    dispatchWindow(type: string, event: Event) {
      for (const listener of windowListeners.get(type) ?? []) listener(event);
    },
  };
}

describe("route chunk recovery", () => {
  it("detects React Router and dynamic import failures", () => {
    expect(
      isRouteModuleReloadMessage(
        "Error loading route module `/dispatch/assets/new-app-abc.js`, reloading page...",
      ),
    ).toBe(true);
    expect(
      isRouteModuleReloadMessage(
        "Failed to fetch dynamically imported module: /assets/foo.js",
      ),
    ).toBe(false);
    expect(
      isDynamicImportFailureMessage(
        "Failed to fetch dynamically imported module: https://example.com/assets/foo.js",
      ),
    ).toBe(true);
    expect(
      isDynamicImportFailureMessage(
        "Importing a module script failed: https://example.com/assets/foo.js",
      ),
    ).toBe(true);
    expect(isDynamicImportFailureMessage("plain network error")).toBe(false);
  });

  it("keeps a fresh intended navigation target for recovery", () => {
    const state = createRouteChunkRecoveryState();
    rememberIntendedNavigation(
      state,
      "https://agent-workspace.builder.io/dispatch/new-app",
      1_000,
    );

    expect(
      getFreshIntendedNavigation(
        state,
        "https://agent-workspace.builder.io/dispatch/apps",
        5_000,
      ),
    ).toBe("https://agent-workspace.builder.io/dispatch/new-app");
    expect(
      getFreshIntendedNavigation(
        state,
        "https://agent-workspace.builder.io/dispatch/apps",
        20_001,
      ),
    ).toBe(null);
    expect(
      getFreshIntendedNavigation(
        state,
        "https://agent-workspace.builder.io/dispatch/new-app",
        5_000,
      ),
    ).toBe(null);
  });

  it("remembers only plain same-origin link clicks", () => {
    window.history.replaceState({}, "", "/dispatch/apps");
    document.body.innerHTML = `
      <a id="same" href="/dispatch/new-app"><span>New app</span></a>
      <a id="external" href="https://other.example/new-app">External</a>
      <a id="blank" href="/dispatch/new-app" target="_blank">Blank</a>
    `;

    const sameSpan = document.querySelector("#same span")!;
    const sameEvent = new MouseEvent("click", {
      bubbles: true,
      button: 0,
    });
    Object.defineProperty(sameEvent, "target", { value: sameSpan });

    const external = document.querySelector("#external")!;
    const externalEvent = new MouseEvent("click", {
      bubbles: true,
      button: 0,
    });
    Object.defineProperty(externalEvent, "target", { value: external });

    const blank = document.querySelector("#blank")!;
    const blankEvent = new MouseEvent("click", {
      bubbles: true,
      button: 0,
    });
    Object.defineProperty(blankEvent, "target", { value: blank });

    const modifiedEvent = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      metaKey: true,
    });
    Object.defineProperty(modifiedEvent, "target", { value: sameSpan });

    expect(intendedHrefFromClick(window, sameEvent)).toBe(
      "http://localhost:3000/dispatch/new-app",
    );
    expect(intendedHrefFromClick(window, externalEvent)).toBe(null);
    expect(intendedHrefFromClick(window, blankEvent)).toBe(null);
    expect(intendedHrefFromClick(window, modifiedEvent)).toBe(null);
  });

  it("tracks same-origin pushState and replaceState targets", () => {
    const {
      fakeWindow,
      fakeLocation,
      originalPushState,
      originalReplaceState,
    } = createFakeWindow();

    installRouteChunkRecovery(fakeWindow);

    fakeWindow.history.pushState({}, "", "/dispatch/new-app");
    expect(originalPushState).toHaveBeenCalledWith({}, "", "/dispatch/new-app");
    expect(fakeLocation.href).toBe("https://example.com/dispatch/new-app");

    fakeWindow.history.replaceState({}, "", "https://example.com/starter");
    expect(originalReplaceState).toHaveBeenCalledWith(
      {},
      "",
      "https://example.com/starter",
    );
    expect(fakeLocation.href).toBe("https://example.com/starter");
  });

  it("hard-navigates to the intended target when React Router would reload the current page", () => {
    const { fakeWindow, fakeLocation, originalReload, dispatchDocument } =
      createFakeWindow();

    installRouteChunkRecovery(fakeWindow);

    const anchor = {
      tagName: "A",
      href: "https://example.com/dispatch/new-app",
      hasAttribute: () => false,
      getAttribute: () => null,
      parentElement: null,
    };
    dispatchDocument("click", {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: anchor,
    } as unknown as MouseEvent);

    fakeWindow.console.error(
      "Error loading route module `/dispatch/assets/new-app-stale.js`, reloading page...",
    );

    expect(fakeLocation.assign).toHaveBeenCalledWith(
      "https://example.com/dispatch/new-app",
    );
    expect(fakeLocation.href).toBe("https://example.com/dispatch/new-app");

    // React Router calls location.reload() after logging the route-module
    // failure. If our best-effort reload patch sticks, it must not reload the
    // old page; if it cannot stick in a real browser, the href is already fixed.
    fakeLocation.reload();
    expect(fakeLocation.assign).toHaveBeenCalledTimes(2);
    expect(originalReload).not.toHaveBeenCalled();
  });

  it("recovers unhandled dynamic import rejections using the intended target", () => {
    const { fakeWindow, fakeLocation, dispatchDocument, dispatchWindow } =
      createFakeWindow();

    installRouteChunkRecovery(fakeWindow);

    const anchor = {
      tagName: "A",
      href: "https://example.com/dispatch/new-app",
      hasAttribute: () => false,
      getAttribute: () => null,
      parentElement: null,
    };
    dispatchDocument("click", {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: anchor,
    } as unknown as MouseEvent);

    const preventDefault = vi.fn();
    dispatchWindow("unhandledrejection", {
      reason: new Error(
        "Failed to fetch dynamically imported module: https://example.com/dispatch/assets/new-app-stale.js",
      ),
      preventDefault,
    } as unknown as PromiseRejectionEvent);

    expect(fakeLocation.assign).toHaveBeenCalledWith(
      "https://example.com/dispatch/new-app",
    );
    expect(preventDefault).toHaveBeenCalled();
  });

  it("moves the current URL before reload when the browser will not let reload be patched", () => {
    const { fakeWindow, fakeLocation, originalReload, dispatchDocument } =
      createFakeWindow("https://example.com/dispatch/apps", {
        lockReload: true,
      });

    installRouteChunkRecovery(fakeWindow);

    const anchor = {
      tagName: "A",
      href: "https://example.com/dispatch/new-app",
      hasAttribute: () => false,
      getAttribute: () => null,
      parentElement: null,
    };
    dispatchDocument("click", {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: anchor,
    } as unknown as MouseEvent);

    fakeWindow.console.error(
      "Error loading route module `/dispatch/assets/new-app-stale.js`, reloading page...",
    );
    fakeLocation.reload();

    expect(fakeLocation.href).toBe("https://example.com/dispatch/new-app");
    expect(originalReload).toHaveBeenCalledOnce();
  });

  it("installs only once per window", () => {
    const { fakeWindow } = createFakeWindow();

    installRouteChunkRecovery(fakeWindow);
    installRouteChunkRecovery(fakeWindow);

    expect(fakeWindow.document.addEventListener).toHaveBeenCalledTimes(1);
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("falls back to the original reload when there is no fresh target", () => {
    const { fakeWindow, fakeLocation, originalReload } = createFakeWindow();

    installRouteChunkRecovery(fakeWindow);

    fakeWindow.console.error(
      "Error loading route module `/dispatch/assets/new-app-stale.js`, reloading page...",
    );
    fakeLocation.reload();

    expect(fakeLocation.assign).not.toHaveBeenCalled();
    expect(originalReload).toHaveBeenCalledOnce();
  });
});
