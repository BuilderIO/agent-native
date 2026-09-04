// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../../i18n";
import {
  GettingStartedCloudContent,
  GettingStartedPathsBlock,
  gettingStartedTabFromSearch,
  GettingStartedTabs,
} from "./getting-started-paths";

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

afterEach(() => {
  cleanup();
  trackEvent.mockClear();
});

function renderPaths(
  children: ReactNode = (
    <GettingStartedPathsBlock blockId="paths" ctx={{}} data={{}} />
  ),
) {
  return render(
    <MemoryRouter initialEntries={["/docs"]}>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        {children}
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

describe("GettingStartedPathsBlock", () => {
  it("renders local and cloud paths with the local path selected by default", () => {
    renderPaths();

    expect(
      screen
        .getByRole("tab", { name: /Build locally/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("tab", { name: /Build in the cloud/ })
        .getAttribute("href"),
    ).toBe("/docs/?tab=cloud");
  });

  it("renders the cloud path content when selected", () => {
    renderPaths(
      <>
        <GettingStartedTabs activeTab="cloud" />
        <GettingStartedCloudContent />
      </>,
    );

    expect(
      screen.getByText(
        "Build the same apps without installing anything. You describe what you want; the agent writes and runs the code in a workspace Builder hosts for you.",
      ),
    ).toBeTruthy();
    const launchBuilder = screen.getByRole("link", { name: "Launch Builder" });
    expect(launchBuilder).toBeTruthy();
    expect(launchBuilder.getAttribute("href")).toBe(
      "https://builder.io/signup",
    );
    expect(screen.getByText("Create a Builder account")).toBeTruthy();
    expect(
      screen.getByText(
        "Use your Builder account to build in the browser. Free to start, and no API keys to bring.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Prompt away")).toBeTruthy();
    expect(
      screen.getByText(
        "Describe what you want to build in plain language and the agent will create it for you.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Deploy")).toBeTruthy();
    expect(
      screen.getByText(
        "When you're ready, deploy your app with one click in Builder.",
      ),
    ).toBeTruthy();
    expect(launchBuilder.querySelector("svg")).not.toBeNull();
    expect(
      screen.queryByText(
        "It's the same open-source framework underneath. Your app exports to a normal repository anytime.",
      ),
    ).toBeNull();
    expect(screen.queryByText("Switch to building locally")).toBeNull();
  });

  it("recognizes only the cloud query value as the alternate path", () => {
    expect(gettingStartedTabFromSearch("")).toBe("local");
    expect(gettingStartedTabFromSearch("?tab=local")).toBe("local");
    expect(gettingStartedTabFromSearch("?tab=cloud")).toBe("cloud");
    expect(gettingStartedTabFromSearch("?tab=other")).toBe("local");
  });
});
