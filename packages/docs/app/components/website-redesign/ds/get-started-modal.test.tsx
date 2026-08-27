// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../../../i18n";
import { GetStartedCta } from "./get-started-modal";
import { SnackbarProvider } from "./snackbar";

afterEach(() => {
  cleanup();
});

function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="pathname">{pathname}</span>;
}

function renderCta() {
  return render(
    <MemoryRouter>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <SnackbarProvider>
          <GetStartedCta location="hero">Get started</GetStartedCta>
          <LocationProbe />
        </SnackbarProvider>
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

function trigger() {
  return screen.getByRole("link", { name: "Get started" });
}

describe("GetStartedCta", () => {
  it("stays a real link to /apps for the no-JS case", () => {
    renderCta();

    expect(trigger().getAttribute("href")).toBe("/apps");
  });

  it("opens the dialog on a plain click instead of navigating", () => {
    renderCta();

    fireEvent.click(trigger());

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("pathname").textContent).toBe("/");
  });

  it("offers the three documented paths inside the dialog", () => {
    renderCta();

    fireEvent.click(trigger());
    const dialog = within(screen.getByRole("dialog"));

    expect(
      dialog.getByRole("button", { name: "Copy install command" }).textContent,
    ).toContain("npx @agent-native/core@latest create my-app");
    expect(
      dialog.getByRole("link", { name: "Read the docs" }).getAttribute("href"),
    ).toBe("/docs");
    expect(
      dialog.getByRole("link", { name: "Browse apps" }).getAttribute("href"),
    ).toBe("/apps");
    expect(dialog.getByRole("button", { name: "Build online" })).toBeTruthy();
  });

  it.each([
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["middle", { button: 1 }],
  ])("leaves a %s click to the browser", (_name, init) => {
    renderCta();

    fireEvent.click(trigger(), init);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("pathname").textContent).toBe("/");
  });
});
