// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { BuildOnlinePopover } from "./BuilderWaitlistPopover";
import { TemplateCard, templates } from "./TemplateCard";

afterEach(cleanup);

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
  it("opens Build online in the shared animated popover", () => {
    renderWithProviders(<BuildOnlinePopover location="templates_index" />);

    fireEvent.click(screen.getByRole("button", { name: "Build online" }));

    const content = screen
      .getByText("Join the waitlist")
      .closest("[role=dialog]");
    expect(content).not.toBeNull();
    expectAnimatedPopover(content as HTMLElement);
  });

  it("keeps Customize It modes inside the shared animated popover", () => {
    renderWithProviders(<TemplateCard template={templates[0]} />);

    fireEvent.click(screen.getByRole("button", { name: "Customize It" }));

    const editOnline = screen.getByRole("button", { name: "Edit Online" });
    const content = editOnline.closest("[role=dialog]");
    expect(content).not.toBeNull();
    expectAnimatedPopover(content as HTMLElement);

    fireEvent.click(editOnline);
    expect(screen.getByText("Join the waitlist")).toBeTruthy();
  });
});
