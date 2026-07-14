// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { BuildOnlinePopover } from "./BuilderWaitlistPopover";
import { TemplateCard, templates } from "./TemplateCard";

afterEach(() => {
  cleanup();
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

  it("submits the selected template with customization waitlist requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<TemplateCard template={templates[0]} />);

    fireEvent.click(screen.getByRole("button", { name: "Customize It" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Online" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "reader@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));

    const waitlistRequests = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/_agent-native/builder/branch-waitlist"),
      );
    await waitFor(() => expect(waitlistRequests()).toHaveLength(1));
    const request = waitlistRequests()[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      email: "reader@example.com",
      source: "docs_template_card",
      template: templates[0].slug,
      useCase: "docs_edit_online_waitlist",
    });
  });
});
