// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appBasePathMock, WorkspaceAppMountResolutionError } = vi.hoisted(() => {
  class WorkspaceAppMountResolutionError extends Error {}
  const appBasePathMock = vi.fn((): string => {
    throw new WorkspaceAppMountResolutionError("Workspace mount is unknown");
  });
  return { appBasePathMock, WorkspaceAppMountResolutionError };
});

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: appBasePathMock,
  WorkspaceAppMountResolutionError,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    const messages: Record<string, string> = {
      "downloadPage.title": "Download Agent-Native",
      "downloadPage.body": "All your apps in one desktop shell.",
      "downloadPage.downloadInstaller": "Download installer",
      "downloadPage.downloadStarted": "Download started",
      "downloadPage.downloadAgain": "Didn't work? Try downloading again",
      "downloadPage.checkingRelease": "Checking the latest desktop release...",
      "downloadPage.loadError": "Could not load the latest desktop installer.",
      "downloadPage.retry": "Retry",
      "downloadPage.unavailable": "Installer unavailable for this platform",
      "downloadPage.allPlatforms": "All platforms",
      "downloadPage.stable": "Stable",
      "downloadPage.nightly": "Nightly",
      "downloadPage.runFromSource": "Or run from source",
      "downloadPage.runFromSourceBody": "Run locally.",
      "downloadPage.platforms.mac.primary": "Download for Apple Silicon",
      "downloadPage.platforms.mac.alternative": "Intel Mac",
      "downloadPage.platforms.mac.gridPrimary": "Apple Silicon",
      "downloadPage.platforms.mac.gridAlternative": "Intel",
      "downloadPage.platforms.windows.primary": "Download for Windows",
      "downloadPage.platforms.windows.alternative": "ARM64",
      "downloadPage.platforms.windows.gridPrimary": "x64 installer",
      "downloadPage.platforms.windows.gridAlternative": "Arm64 installer",
      "downloadPage.platforms.linux.primary": "Download Linux archive",
      "downloadPage.platforms.linux.appImage": "Download AppImage",
      "downloadPage.platforms.linux.deb": "Download .deb",
      "downloadPage.platforms.linux.gridPrimary": "x86_64",
      "downloadPage.platforms.linux.gridAppImage": "Universal",
      "downloadPage.platforms.linux.gridDeb": "Debian / Ubuntu",
      "common.copyCommand": "Copy command",
      "common.copied": "Copied",
    };
    return messages[key] ?? key;
  },
}));

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("./TemplateCard", () => ({ trackEvent }));

import DownloadPage from "../routes/download";

const productionManifest = {
  version: "1.2.3",
  tag: "v1.2.3",
  pub_date: "2026-08-20T00:00:00Z",
  assets: [
    {
      name: "Agent-Native-arm64.dmg",
      url: "https://downloads.example.com/production.dmg",
      size: 123,
      kind: "mac-arm64",
    },
  ],
};

const nightlyManifest = {
  version: "1.2.4-nightly.1",
  tag: "v1.2.4-nightly.1",
  pub_date: "2026-08-20T00:00:00Z",
  assets: [
    {
      name: "Agent-Native Nightly-arm64.dmg",
      url: "https://downloads.example.com/nightly.dmg",
      size: 123,
      kind: "mac-arm64",
    },
  ],
};

describe("DownloadPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    appBasePathMock.mockReturnValue("");
    window.localStorage.clear();
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    });
    fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      json: async () =>
        input.includes("channel=nightly")
          ? nightlyManifest
          : productionManifest,
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("switches the title and direct installer links between stable and Nightly", async () => {
    appBasePathMock.mockReturnValue("/docs");
    render(<DownloadPage />);

    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: "Download for Apple Silicon" })
          .getAttribute("href"),
      ).toBe(productionManifest.assets[0].url);
    });

    expect(
      screen.getByRole("heading", { name: "Download Agent-Native" }),
    ).toBeTruthy();
    expect(screen.queryByText(productionManifest.version)).toBeNull();
    expect(screen.queryByText(nightlyManifest.version)).toBeNull();
    expect(screen.queryByRole("link", { name: /GitHub/i })).toBeNull();
    expect(
      screen
        .getByRole("radio", { name: "Stable" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Nightly" }));

    expect(
      screen.getByRole("heading", { name: "Download Agent-Native Nightly" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("heading", { name: "Download Agent-Native Nightly" })
        .querySelector("span"),
    ).toBeNull();
    expect(
      screen
        .getByRole("radio", { name: "Nightly" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: "Download for Apple Silicon" })
          .getAttribute("href"),
      ).toBe(nightlyManifest.assets[0].url);
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/docs/api/desktop-latest.json?channel=nightly",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Stable" }));

    expect(
      screen.getByRole("heading", { name: "Download Agent-Native" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: "Download for Apple Silicon" })
          .getAttribute("href"),
      ).toBe(productionManifest.assets[0].url);
    });
  });

  it("offers a retry when workspace mount details are unavailable", async () => {
    appBasePathMock.mockImplementation(() => {
      throw new WorkspaceAppMountResolutionError("Workspace mount is unknown");
    });
    render(<DownloadPage />);

    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a confirmed state and retry link after starting a download", async () => {
    render(<DownloadPage />);

    const download = await screen.findByRole("link", {
      name: "Download for Apple Silicon",
    });
    expect(download.getAttribute("target")).toBe("_blank");

    fireEvent.click(download);

    expect(
      screen
        .getByRole("link", { name: "Download started" })
        .getAttribute("href"),
    ).toBe(productionManifest.assets[0].url);
    expect(
      screen
        .getByRole("link", {
          name: "Didn't work? Try downloading again",
        })
        .getAttribute("href"),
    ).toBe(productionManifest.assets[0].url);
  });

  it("keeps the download button fixed while the channel manifest loads", async () => {
    let resolveManifest!: (response: {
      ok: boolean;
      json: () => Promise<typeof productionManifest>;
    }) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveManifest = resolve;
        }),
    );

    render(<DownloadPage />);

    const loadingButton = screen.getByRole("button", {
      name: "Checking the latest desktop release...",
    });
    expect((loadingButton as HTMLButtonElement).disabled).toBe(true);
    expect(loadingButton.getAttribute("aria-busy")).toBe("true");
    expect(loadingButton.className).toContain("max-w-[18rem]");
    expect(loadingButton.textContent).not.toContain(
      "Checking the latest desktop release...",
    );

    resolveManifest({
      ok: true,
      json: async () => productionManifest,
    });

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Download for Apple Silicon" }),
      ).toBeTruthy();
    });
  });

  it("offers a retry action when the manifest request fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("temporary failure"));

    render(<DownloadPage />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    expect(retry.getAttribute("aria-busy")).toBe("false");

    fireEvent.click(retry);

    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: "Download for Apple Silicon" })
          .getAttribute("href"),
      ).toBe(productionManifest.assets[0].url);
    });
  });

  it("offers a retry when the workspace mount cannot be resolved", async () => {
    appBasePathMock.mockImplementation(() => {
      throw new WorkspaceAppMountResolutionError("Workspace mount is unknown");
    });

    render(<DownloadPage />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
