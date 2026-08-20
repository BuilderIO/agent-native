// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    const messages: Record<string, string> = {
      "downloadPage.title": "Download Agent Native",
      "downloadPage.body": "All your apps in one desktop shell.",
      "downloadPage.downloadInstaller": "Download installer",
      "downloadPage.checkingRelease": "Checking the latest desktop release...",
      "downloadPage.loadError": "Could not load the latest desktop installer.",
      "downloadPage.unavailable": "Installer unavailable for this platform",
      "downloadPage.stable": "Stable",
      "downloadPage.nightly": "Nightly",
      "downloadPage.switchToNightly": "Switch to Nightly builds",
      "downloadPage.switchToStable": "Switch to stable builds",
      "downloadPage.runFromSource": "Or run from source",
      "downloadPage.runFromSourceBody": "Run locally.",
      "downloadPage.platforms.mac.primary": "Download for Apple Silicon",
      "downloadPage.platforms.mac.alternative": "Intel Mac",
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
      name: "Agent Native Nightly-arm64.dmg",
      url: "https://downloads.example.com/nightly.dmg",
      size: 123,
      kind: "mac-arm64",
    },
  ],
};

describe("DownloadPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
    vi.clearAllMocks();
  });

  it("switches the title and direct installer links between stable and Nightly", async () => {
    render(<DownloadPage />);

    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: "Download for Apple Silicon" })
          .getAttribute("href"),
      ).toBe(productionManifest.assets[0].url);
    });

    expect(
      screen.getByRole("heading", { name: "Download Agent Native" }),
    ).toBeTruthy();
    expect(screen.queryByText(productionManifest.version)).toBeNull();
    expect(screen.queryByText(nightlyManifest.version)).toBeNull();
    expect(screen.queryByRole("link", { name: /GitHub/i })).toBeNull();

    fireEvent.click(
      screen.getByRole("switch", { name: "Switch to Nightly builds" }),
    );

    expect(
      screen.getByRole("heading", { name: "Download Agent Native Nightly" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: "Download for Apple Silicon" })
          .getAttribute("href"),
      ).toBe(nightlyManifest.assets[0].url);
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/desktop-latest.json?channel=nightly",
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Switch to stable builds" }),
    );

    expect(
      screen.getByRole("heading", { name: "Download Agent Native" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        screen
          .getByRole("link", { name: "Download for Apple Silicon" })
          .getAttribute("href"),
      ).toBe(productionManifest.assets[0].url);
    });
  });
});
