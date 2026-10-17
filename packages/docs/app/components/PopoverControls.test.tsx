// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../i18n";
import {
  BuildOnlinePopover,
  BuilderLaunchLink,
} from "./BuilderWaitlistPopover";
import { installAppLinkAttribution } from "./marketing-attribution";
import { TemplateLandingActions } from "./template-landing/TemplateLandingActions";
import { templates } from "./TemplateCard";
import { Button } from "./website-redesign/ds/button";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function renderWithProviders(children: ReactNode) {
  return render(
    <MemoryRouter>
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

function expectAnimatedPopover(element: HTMLElement) {
  expect(element.className).toContain("data-[state=open]:animate-in");
  expect(element.className).toContain("data-[state=closed]:animate-out");
  expect(element.className).toContain("data-[side=bottom]:slide-in-from-top-2");
}

describe("docs popover controls", () => {
  it("opens Builder launch links in a new tab", () => {
    renderWithProviders(
      <>
        <BuilderLaunchLink />
        <BuilderLaunchLink trigger={<a href="/docs">Custom launch</a>} />
      </>,
    );

    for (const name of ["Launch Builder", "Custom launch"]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(
        "https://builder.io/signup?initialPrompt=true&useFusion=true",
      );
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("launches online builds directly in Fusion without a waitlist", () => {
    renderWithProviders(
      <BuildOnlinePopover
        location="templates_index"
        trigger={
          <Button variant="white" icon={null} compact>
            Build online
          </Button>
        }
      />,
    );

    const link = screen.getByRole("link", { name: "Build online" });
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.origin + url.pathname).toBe("https://builder.io/signup");
    expect(url.searchParams.get("initialPrompt")).toBe("true");
    expect(url.searchParams.get("useFusion")).toBe("true");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByText(/waitlist/i)).toBeNull();
  });

  it("keeps Customize It modes inside the shared animated popover", () => {
    renderWithProviders(<TemplateLandingActions template={templates[0]} />);

    fireEvent.click(screen.getByRole("button", { name: "Customize It" }));

    const customizeOnline = screen.getByRole("button", {
      name: /^Online/,
    });
    const content = customizeOnline.closest("[role=dialog]");
    expect(content).not.toBeNull();
    expectAnimatedPopover(content as HTMLElement);
    expect(screen.queryByText("Join waitlist")).toBeNull();

    fireEvent.click(customizeOnline);
    expect(screen.getByText("Build in the browser")).toBeTruthy();
    const launch = screen.getByRole("link", { name: "Launch Builder" });
    expect(launch.getAttribute("href")).toBe(
      "https://builder.io/signup?initialPrompt=true&useFusion=true",
    );
  });

  it("passes stored first-touch attribution to demo links", () => {
    window.localStorage.setItem(
      "an_attribution",
      JSON.stringify({
        utm_source: "newsletter",
        utm_campaign: "launch",
      }),
    );
    // The site root installs this for every app link.
    const uninstall = installAppLinkAttribution();
    renderWithProviders(<TemplateLandingActions template={templates[0]} />);

    const demoLink = screen.getByRole("link", { name: "Try Clips free" });
    fireEvent.click(demoLink);
    uninstall();

    const url = new URL(demoLink.getAttribute("href") ?? "");
    expect(url.searchParams.get("utm_source")).toBe("newsletter");
    expect(url.searchParams.get("utm_campaign")).toBe("launch");
  });
});
