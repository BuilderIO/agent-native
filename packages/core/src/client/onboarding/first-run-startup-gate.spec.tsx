// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  fetchStatus: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("./first-run-enabled.js", () => ({
  isFirstRunOnboardingEnabled: mocks.enabled,
}));

vi.mock("./first-run-status.js", () => ({
  fetchFirstRunOnboardingStatus: mocks.fetchStatus,
}));

vi.mock("./use-preview-mode.js", () => ({
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

import { FirstRunOnboardingStartupGate } from "./first-run-startup-gate.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("holds the app behind a neutral screen while eligibility is unresolved", () => {
    const status = deferred<boolean>();
    mocks.fetchStatus.mockReturnValue(status.promise);

    act(() => {
      root.render(
        <FirstRunOnboardingStartupGate>
          <div data-testid="app-content">app</div>
        </FirstRunOnboardingStartupGate>,
      );
    });

    expect(mocks.fetchStatus).toHaveBeenCalledOnce();
    expect(
      container.querySelector("[data-first-run-startup-loading]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-first-run-app-hidden]"),
    ).not.toBeNull();
  });

  it("reveals an existing-organization member without mounting onboarding", async () => {
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
  });

  it("keeps the app hidden and owns the onboarding surface for a new user", async () => {
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
    expect(
      container.querySelector("[data-first-run-app-hidden]"),
    ).not.toBeNull();
    expect(
      container
        .querySelector("[data-testid='first-run-onboarding']")
        ?.getAttribute("data-initial-first-run"),
    ).toBe("true");
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
