// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { collectDesktopOnboardingHosts } from "../host-extensions.js";
import {
  OnboardingHostSlot,
  type DesktopOnboardingHost,
} from "./OnboardingHostSlot.js";

describe("OnboardingHostSlot", () => {
  let container: HTMLDivElement;
  let root: Root;
  let getOnboardingScope: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    getOnboardingScope = vi.fn().mockResolvedValue("a".repeat(64));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { identity: { getOnboardingScope } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function voiceHost(onActiveChange = vi.fn()): DesktopOnboardingHost {
    return {
      appId: "voice",
      onActiveChange,
      render: ({ scope, onClose }) => (
        <>
          <button
            type="button"
            data-scope={scope.status === "ready" ? scope.key : scope.status}
            onClick={() => onClose()}
          >
            Voice setup
          </button>
          {scope.status === "unavailable" ? (
            <button type="button" data-retry onClick={() => scope.retry()}>
              Retry
            </button>
          ) : null}
        </>
      ),
    };
  }

  async function render(
    hosts: readonly DesktopOnboardingHost[],
    props: {
      activeAppId?: string;
      signedIn?: boolean;
      identityEpoch?: number;
    } = {},
  ) {
    await act(async () => {
      root.render(
        <OnboardingHostSlot
          hosts={hosts}
          activeAppId={props.activeAppId ?? "voice"}
          signedIn={props.signedIn ?? true}
          identityEpoch={props.identityEpoch ?? 0}
        />,
      );
    });
  }

  it("renders nothing and reads no scope without hosts", async () => {
    await render([]);
    expect(container.innerHTML).toBe("");
    expect(getOnboardingScope).not.toHaveBeenCalled();
  });

  it("shows the active app's host with the account scope", async () => {
    const onActiveChange = vi.fn();
    await render([voiceHost(onActiveChange)]);
    const button = container.querySelector("button");
    expect(button?.dataset.scope).toBe("a".repeat(64));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
  });

  it("hides for a signed-out person or another app", async () => {
    const onActiveChange = vi.fn();
    const hosts = [voiceHost(onActiveChange)];
    await render(hosts, { signedIn: false });
    expect(container.querySelector("button")).toBeNull();
    expect(getOnboardingScope).not.toHaveBeenCalled();
    await render(hosts, { activeAppId: "mail" });
    expect(container.querySelector("button")).toBeNull();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("stays closed for that account until the app changes", async () => {
    const hosts = [voiceHost()];
    await render(hosts);
    await act(async () => container.querySelector("button")?.click());
    expect(container.querySelector("button")).toBeNull();
    await render(hosts, { activeAppId: "mail" });
    await render(hosts, { activeAppId: "voice" });
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("reads the scope again when the identity changes", async () => {
    const hosts = [voiceHost()];
    await render(hosts);
    getOnboardingScope.mockResolvedValueOnce("b".repeat(64));
    await render(hosts, { identityEpoch: 1 });
    expect(container.querySelector("button")?.dataset.scope).toBe(
      "b".repeat(64),
    );
  });

  it("keeps a dismissal while the same account's scope is read again", async () => {
    const onActiveChange = vi.fn();
    const hosts = [voiceHost(onActiveChange)];
    await render(hosts);
    await act(async () => container.querySelector("button")?.click());
    let resolveScope: (scope: string) => void = () => {};
    getOnboardingScope.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveScope = resolve;
      }),
    );
    onActiveChange.mockClear();

    await render(hosts, { identityEpoch: 1 });
    expect(container.querySelector("button")).toBeNull();
    await act(async () => resolveScope("a".repeat(64)));
    expect(container.querySelector("button")).toBeNull();
    expect(onActiveChange).not.toHaveBeenCalledWith(true);

    getOnboardingScope.mockResolvedValueOnce("b".repeat(64));
    await render(hosts, { identityEpoch: 2 });
    expect(container.querySelector("button")?.dataset.scope).toBe(
      "b".repeat(64),
    );
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
  });

  it("never hands a host the previous account's key after the identity changes", async () => {
    const seen: string[] = [];
    const host: DesktopOnboardingHost = {
      appId: "voice",
      render: ({ scope }) => {
        seen.push(scope.status === "ready" ? scope.key : scope.status);
        return null;
      },
    };
    await render([host]);
    expect(seen.at(-1)).toBe("a".repeat(64));
    let resolveScope: (scope: string) => void = () => {};
    getOnboardingScope.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveScope = resolve;
      }),
    );
    const before = seen.length;
    await render([host], { identityEpoch: 1 });
    expect(seen.slice(before)).not.toContain("a".repeat(64));
    expect(seen.at(-1)).toBe("loading");
    await act(async () => resolveScope("b".repeat(64)));
    expect(seen.at(-1)).toBe("b".repeat(64));
  });

  it("shows a dismissed host again with its retry when the next account's read fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const hosts = [voiceHost()];
    await render(hosts);
    await act(async () => container.querySelector("button")?.click());
    expect(container.querySelector("button")).toBeNull();

    getOnboardingScope.mockRejectedValueOnce(new Error("broker offline"));
    await render(hosts, { identityEpoch: 1 });
    expect(container.querySelector("button")?.dataset.scope).toBe(
      "unavailable",
    );
    expect(container.querySelector("[data-retry]")).not.toBeNull();
    consoleError.mockRestore();
  });

  it("tells the host a failed scope read apart from loading, and retries it", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getOnboardingScope.mockReturnValueOnce(new Promise<string>(() => {}));
    const hosts = [voiceHost()];
    await render(hosts);
    expect(container.querySelector("button")?.dataset.scope).toBe("loading");

    getOnboardingScope.mockRejectedValueOnce(new Error("broker offline"));
    await render(hosts, { identityEpoch: 1 });
    expect(container.querySelector("button")?.dataset.scope).toBe(
      "unavailable",
    );
    expect(consoleError).toHaveBeenCalled();

    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry]")?.click(),
    );
    expect(container.querySelector("button")?.dataset.scope).toBe(
      "a".repeat(64),
    );
    expect(getOnboardingScope).toHaveBeenCalledTimes(3);
    consoleError.mockRestore();
  });
});

describe("collectDesktopOnboardingHosts", () => {
  it("collects each module's hosts and refuses a malformed export", () => {
    const host = { appId: "voice", render: () => null };
    expect(
      collectDesktopOnboardingHosts({
        "./host-extensions/b.tsx": { onboardingHosts: [host] },
      }),
    ).toEqual([host]);
    expect(() =>
      collectDesktopOnboardingHosts({
        "./host-extensions/a.tsx": { onboardingHosts: [{ appId: "voice" }] },
      }),
    ).toThrow(/onboardingHosts/);
  });
});
