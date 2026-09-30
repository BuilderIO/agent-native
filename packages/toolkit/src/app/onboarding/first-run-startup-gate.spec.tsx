// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  fetchStatus: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("@agent-native/core/client/onboarding/first-run-enabled", () => ({
  isFirstRunOnboardingEnabled: mocks.enabled,
}));

vi.mock(
  "@agent-native/core/client/onboarding/first-run-status",
  async (importOriginal) => ({
    ...(await importOriginal<typeof import("./first-run-status.js")>()),
    fetchFirstRunOnboardingStatus: mocks.fetchStatus,
  }),
);

vi.mock("@agent-native/core/client/onboarding/use-preview-mode", () => ({
  useOnboardingPreviewMode: mocks.preview,
}));

vi.mock("./FirstRunOnboarding.js", () => ({
  FirstRunOnboarding: ({ initialFirstRun }: { initialFirstRun?: boolean }) => (
    <div
      data-testid="first-run-onboarding"
      data-initial-first-run={String(initialFirstRun === true)}
    />
  ),
}));

import { FIRST_RUN_ONBOARDING_COOKIE } from "@agent-native/core/shared/first-run-onboarding";

import {
  FirstRunOnboardingStartupGate,
  useFirstRunOnboardingGateOwnsSurface,
} from "./first-run-startup-gate.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

let nextMountId = 0;

function StatefulApp() {
  const [mountId] = React.useState(() => ++nextMountId);
  return <div data-testid="stateful-app" data-mount-id={mountId} />;
}

function GateOwnershipProbe() {
  const ownsSurface = useFirstRunOnboardingGateOwnsSurface();
  return <div data-testid="gate-ownership">{String(ownsSurface)}</div>;
}

describe("FirstRunOnboardingStartupGate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.enabled.mockReset();
    mocks.fetchStatus.mockReset();
    mocks.preview.mockReset();
    mocks.enabled.mockReturnValue(true);
    mocks.preview.mockReturnValue(false);
    document.cookie = `${FIRST_RUN_ONBOARDING_COOKIE}=1; path=/`;
    nextMountId = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    document.cookie = `${FIRST_RUN_ONBOARDING_COOKIE}=; Max-Age=0; path=/`;
  });

  it("skips the status round trip when the server has no first-run cookie", () => {
    document.cookie = `${FIRST_RUN_ONBOARDING_COOKIE}=; Max-Age=0; path=/`;

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <GateOwnershipProbe />
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    expect(mocks.fetchStatus).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid='gate-ownership']")?.textContent,
    ).toBe("false");
    expect(
      container.querySelector("[data-testid='app-content']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-first-run-startup-loading]"),
    ).toBeNull();
  });

  it("diagnoses an inaccessible cookie and skips the startup gate", () => {
    const cookie = vi
      .spyOn(document, "cookie", "get")
      .mockImplementation(() => {
        throw new DOMException("Sandboxed document", "SecurityError");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      act(() => {
        root.render(
          <FirstRunOnboardingStartupGate>
            <div data-testid="app-content">app</div>
          </FirstRunOnboardingStartupGate>,
        );
      });
    } finally {
      cookie.mockRestore();
    }

    expect(mocks.fetchStatus).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[onboarding] first-run cookie is unreadable; skipping startup gate",
    );
    warn.mockRestore();
    expect(
      container.querySelector("[data-testid='app-content']"),
    ).not.toBeNull();
  });

  it("holds the app behind a neutral screen while eligibility is unresolved", () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <GateOwnershipProbe />
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    expect(mocks.fetchStatus).toHaveBeenCalledOnce();
    const loading = container.querySelector("[data-first-run-startup-loading]");
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.getAttribute("aria-label")).toBe("Loading application");
    expect(loading?.hasAttribute("inert")).toBe(false);
    expect(loading?.querySelector("[inert]")).not.toBeNull();
    expect(
      container.querySelector("[data-first-run-app-hidden]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='gate-ownership']")?.textContent,
    ).toBe("true");
  });

  it("reveals an existing-organization member without mounting onboarding", async () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <GateOwnershipProbe />
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    await act(async () => {
      status.resolve(false);
      await status.promise;
    });

    expect(
      container.querySelector("[data-testid='app-content']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-first-run-startup-loading]"),
    ).toBeNull();
    expect(container.querySelector("[data-first-run-app-hidden]")).toBeNull();
    expect(
      container.querySelector("[data-testid='first-run-onboarding']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='gate-ownership']")?.textContent,
    ).toBe("false");
  });

  it("does not remount the app when eligibility resolves", async () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <StatefulApp />
        </FirstRunOnboardingStartupGate>,
      );
    });

    const mountId = container
      .querySelector("[data-testid='stateful-app']")
      ?.getAttribute("data-mount-id");

    await act(async () => {
      status.resolve(false);
      await status.promise;
    });

    expect(
      container
        .querySelector("[data-testid='stateful-app']")
        ?.getAttribute("data-mount-id"),
    ).toBe(mountId);
  });

  it("does not remount the app when the server clears the cookie", async () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <StatefulApp />
        </FirstRunOnboardingStartupGate>,
      );
    });

    const mountId = container
      .querySelector("[data-testid='stateful-app']")
      ?.getAttribute("data-mount-id");

    await act(async () => {
      status.resolve(false);
      await status.promise;
    });
    document.cookie = `${FIRST_RUN_ONBOARDING_COOKIE}=; Max-Age=0; path=/`;
    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <StatefulApp />
        </FirstRunOnboardingStartupGate>,
      );
    });

    expect(mocks.fetchStatus).toHaveBeenCalledOnce();
    expect(
      container
        .querySelector("[data-testid='stateful-app']")
        ?.getAttribute("data-mount-id"),
    ).toBe(mountId);
  });

  it("suppresses the onboarding surface without remounting the app", async () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <GateOwnershipProbe />
          <StatefulApp />
        </FirstRunOnboardingStartupGate>,
      );
    });
    await act(async () => {
      status.resolve(true);
      await status.promise;
    });

    const mountId = container
      .querySelector("[data-testid='stateful-app']")
      ?.getAttribute("data-mount-id");
    expect(
      container.querySelector("[data-testid='first-run-onboarding']"),
    ).not.toBeNull();

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate suppressSurface>
          <GateOwnershipProbe />
          <StatefulApp />
        </FirstRunOnboardingStartupGate>,
      );
    });

    expect(container.querySelector("[data-first-run-app-hidden]")).toBeNull();
    expect(
      container.querySelector("[data-testid='first-run-onboarding']"),
    ).toBeNull();
    expect(
      container
        .querySelector("[data-testid='stateful-app']")
        ?.getAttribute("data-mount-id"),
    ).toBe(mountId);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <GateOwnershipProbe />
          <StatefulApp />
        </FirstRunOnboardingStartupGate>,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-testid='first-run-onboarding']"),
      ).not.toBeNull();
    });
    expect(
      container
        .querySelector("[data-testid='stateful-app']")
        ?.getAttribute("data-mount-id"),
    ).toBe(mountId);
  });

  it("keeps the app visible while a suppressed onboarding check is pending", async () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate suppressSurface>
          <GateOwnershipProbe />
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    expect(
      container.querySelector("[data-testid='app-content']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-first-run-startup-loading]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='gate-ownership']")?.textContent,
    ).toBe("false");

    await act(async () => {
      status.resolve(true);
      await status.promise;
    });

    expect(
      container.querySelector("[data-testid='first-run-onboarding']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='app-content']"),
    ).not.toBeNull();
  });

  it("keeps the app hidden and owns the onboarding surface for a new user", async () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <GateOwnershipProbe />
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    await act(async () => {
      status.resolve(true);
      await status.promise;
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-testid='first-run-onboarding']"),
      ).not.toBeNull();
    });
    expect(
      container.querySelector("[data-first-run-app-hidden]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='gate-ownership']")?.textContent,
    ).toBe("true");
    expect(
      container
        .querySelector("[data-testid='first-run-onboarding']")
        ?.getAttribute("data-initial-first-run"),
    ).toBe("true");
  });

  it("reveals the app after the eligible user completes onboarding", async () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    await act(async () => {
      status.resolve(true);
      await status.promise;
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-testid='first-run-onboarding']"),
      ).not.toBeNull();
    });

    act(() => {
      window.dispatchEvent(new Event("agent-native:first-run-completed"));
    });

    expect(
      container.querySelector("[data-testid='app-content']"),
    ).not.toBeNull();
    expect(container.querySelector("[data-first-run-app-hidden]")).toBeNull();
    expect(
      container.querySelector("[data-testid='first-run-onboarding']"),
    ).toBeNull();
  });

  it("fails closed to the app if the eligibility check is unavailable", async () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    await act(async () => {
      status.reject(new Error("unavailable"));
      await status.promise.catch(() => undefined);
    });

    expect(
      container.querySelector("[data-testid='app-content']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-first-run-startup-loading]"),
    ).toBeNull();
  });

  it("does not gate preview mode", () => {
    mocks.preview.mockReturnValue(true);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    expect(mocks.fetchStatus).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid='app-content']"),
    ).not.toBeNull();
  });
});
