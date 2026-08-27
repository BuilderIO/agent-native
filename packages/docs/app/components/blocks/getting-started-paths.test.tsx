// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../../i18n";
import { GettingStartedPathsBlock } from "./getting-started-paths";

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

afterEach(() => {
  cleanup();
  trackEvent.mockClear();
});

function renderPaths() {
  return render(
    <MemoryRouter initialEntries={["/docs"]}>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <GettingStartedPathsBlock blockId="paths" ctx={{}} data={{}} />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

describe("GettingStartedPathsBlock", () => {
  it("offers alternatives to local development", () => {
    const { container } = renderPaths();

    const callout = container.querySelector('.an-callout[data-tone="info"]');
    expect(callout?.textContent).toBe(
      "Not building locally? Explore a live app first, or join the waitlist to build in the browser instead.",
    );
    expect(
      screen
        .getByRole("link", { name: "Explore a live app" })
        .getAttribute("href"),
    ).toBe("/apps");
    expect(screen.queryByRole("link", { name: /Build locally/ })).toBeNull();
  });

  it("opens the shared waitlist popover", () => {
    renderPaths();

    fireEvent.click(
      screen.getByRole("button", {
        name: "join the waitlist",
      }),
    );

    const popover = screen
      .getByText("Join the waitlist")
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
      option: "build_online",
      location: "getting_started",
    });
    expect(trackEvent).toHaveBeenCalledWith("click build online", {
      location: "getting_started",
    });
  });
});
