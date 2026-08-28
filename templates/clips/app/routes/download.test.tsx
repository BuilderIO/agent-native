// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, markDownloaded } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  markDownloaded: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { platform?: string }) => {
    const messages: Record<string, string> = {
      "downloadRoute.backToLibrary": "Back to library",
      "downloadRoute.clipsDesktop": "Clips Desktop",
      "downloadRoute.heroDescription": "Record your screen.",
      "downloadRoute.downloadFor": "Download for {{platform}}",
      "downloadRoute.retry": "Try again",
      "downloadRoute.stable": "Stable",
      "downloadRoute.nightly": "Nightly",
      "downloadRoute.switchToNightly": "Switch to Nightly builds",
      "downloadRoute.switchToStable": "Switch to stable builds",
    };
    return (messages[key] ?? key).replace(
      "{{platform}}",
      values?.platform ?? "",
    );
  },
}));

vi.mock("@/lib/capture-install-options", () => ({
  clipsChromeExtensionUrl: null,
  markDesktopAppDownloaded: markDownloaded,
  useClipsChromeExtensionEnabled: () => false,
}));

vi.mock("@/lib/download-release-channel", () => ({
  getDefaultDownloadChannel: () => "production",
}));

import DownloadPage from "./download";

const stableManifest = {
  version: "0.1.10",
  tag: "clips-v0.1.10",
  pub_date: null,
  assets: [
    {
      name: "Clips-universal.dmg",
      url: "https://downloads.example.com/stable-mac.dmg",
      size: 1,
      kind: "mac-universal",
    },
    {
      name: "Clips-x64.msi",
      url: "https://downloads.example.com/stable-windows.msi",
      size: 1,
      kind: "windows-msi",
    },
    {
      name: "Clips.AppImage",
      url: "https://downloads.example.com/stable-linux.AppImage",
      size: 1,
      kind: "linux-appimage",
    },
  ],
};

const nightlyManifest = {
  ...stableManifest,
  version: "0.1.11-nightly.1",
  tag: "clips-nightly-v0.1.11-1",
  assets: stableManifest.assets.map((asset) => ({
    ...asset,
    url: asset.url.replace("stable", "nightly"),
  })),
};

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Clips download page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    fetchMock.mockImplementation(async (input: string) => ({
      ok: true,
      json: async () =>
        input.includes("channel=nightly") ? nightlyManifest : stableManifest,
    }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    });
    await act(async () => {
      root.render(<DownloadPage />);
    });
    await flushEffects();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("selects platforms with direct downloads and switches to Nightly", async () => {
    expect(container.querySelector("h1")?.textContent).toBe("Clips Desktop");
    expect(container.querySelector("a[download]")?.textContent).toContain(
      "Download for macOS",
    );
    expect(container.querySelector("a[download]")?.getAttribute("href")).toBe(
      stableManifest.assets[0].url,
    );
    expect(
      container
        .querySelector('button[aria-label="macOS"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.textContent).not.toContain(stableManifest.version);

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Windows"]')
        ?.click();
    });
    expect(container.querySelector("a[download]")?.textContent).toContain(
      "Download for Windows",
    );
    expect(container.querySelector("a[download]")?.getAttribute("href")).toBe(
      stableManifest.assets[1].url,
    );

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[role="switch"]')
        ?.click();
    });
    await flushEffects();

    expect(container.querySelector("h1")?.textContent).toBe(
      "Clips Desktop Nightly",
    );
    expect(container.querySelector("a[download]")?.getAttribute("href")).toBe(
      nightlyManifest.assets[1].url,
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/clips-latest.json?channel=nightly",
    );
    expect(
      container
        .querySelector('button[role="switch"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });
});
