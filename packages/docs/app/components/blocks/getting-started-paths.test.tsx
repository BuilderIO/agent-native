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

  it("opens a waitlist dialog", () => {
    renderPaths();

    fireEvent.click(
      screen.getByRole("button", {
        name: "join the waitlist",
      }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Build in the browser" }),
    ).toBeTruthy();
    expect(
      within(dialog).queryByText(
        "Build agent-native apps with no local setup.",
      ),
    ).toBeNull();
    const email = within(dialog).getByLabelText("Email");
    expect(email).toBeTruthy();
    expect(email.getAttribute("placeholder")).toBe("you@company.com");
    expect(document.activeElement).toBe(email);
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(dialog.className).toContain("!max-w-[440px]");
    expect(dialog.className).toContain("w-[calc(100vw-32px)]");
    expect(trackEvent).toHaveBeenCalledWith("choose get started path", {
      option: "build_online",
      location: "getting_started",
    });
    expect(trackEvent).toHaveBeenCalledWith("click build online", {
      location: "getting_started",
    });
  });
});
