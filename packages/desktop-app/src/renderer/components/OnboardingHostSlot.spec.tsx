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
        <button
          type="button"
          data-scope={scope ?? ""}
          onClick={() => onClose()}
        >
          Voice setup
        </button>
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
