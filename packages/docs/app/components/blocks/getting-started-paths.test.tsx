// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: "Launch Builder" })).toBeTruthy();
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
    expect(
      screen
        .getByRole("button", { name: "Launch Builder" })
        .querySelector("svg"),
    ).not.toBeNull();
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

  it("opens the shared waitlist popover from the cloud CTA", () => {
    renderPaths(<GettingStartedCloudContent />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Launch Builder",
      }),
    );

    const popover = screen
      .getByText("Build in the browser")
      .closest("[role=dialog]");
    expect(popover).not.toBeNull();
    expect(popover?.className).toContain("data-[state=open]:animate-in");
    expect(popover?.className).toContain(
      "data-[side=bottom]:slide-in-from-top-2",
    );
    expect(popover?.className).toContain("w-[min(100vw-32px,360px)]");
    expect(
      within(popover as HTMLElement).getByText(
        "Rapidly generate agent-native apps in the cloud. Join the waitlist for early access.",
      ),
    ).toBeTruthy();
    const email = within(popover as HTMLElement).getByLabelText("Email");
    expect(email).toBeTruthy();
    expect(email.getAttribute("placeholder")).toBe("you@company.com");
    expect(trackEvent).toHaveBeenCalledWith("choose get started path", {
      option: "build_cloud",
      location: "getting_started",
    });
    expect(trackEvent).toHaveBeenCalledWith("click build online", {
      location: "getting_started",
    });
  });
});
