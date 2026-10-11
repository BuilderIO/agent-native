// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantReadyProvider } from "../shell-ready";
import DocsLayout from "./DocsLayout";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentAskPopover: ({ open }: { open: boolean }) =>
    open ? <div data-testid="question-composer" /> : null,
}));
vi.mock("./DocsSidebar", () => ({ default: () => null }));
vi.mock("./MobileDocsNav", () => ({ default: () => null }));
vi.mock("./DocsPrevNext", () => ({ default: () => null }));
vi.mock("./docs-content", () => ({ hasLocalizedDoc: () => false }));

afterEach(cleanup);

function DocsNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => void navigate("/docs/actions-defining/")}>
        Next doc
      </button>
      <DocsLayout toc={[{ id: "overview", label: "Overview" }]}>
        <h1>{location.pathname}</h1>
      </DocsLayout>
    </>
  );
}

describe("docs question loading across navigation", () => {
  it("cancels a pending composer when the document changes", async () => {
    let ready!: () => void;
    const pending = new Promise<void>((resolve) => {
      ready = resolve;
    });
    render(
      <MemoryRouter initialEntries={["/docs/actions-overview/"]}>
        <AssistantReadyProvider value={() => pending}>
          <DocsNavigation />
        </AssistantReadyProvider>
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "header.askAssistant" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next doc" }));
    await act(async () => ready());
    await vi.dynamicImportSettled();
    expect(screen.getByRole("heading").textContent).toBe(
      "/docs/actions-defining/",
    );
    expect(screen.queryByTestId("question-composer")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "header.askAssistant",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("opens the composer when the user remains on the document", async () => {
    render(
      <MemoryRouter initialEntries={["/docs/actions-overview/"]}>
        <AssistantReadyProvider value={() => Promise.resolve()}>
          <DocsNavigation />
        </AssistantReadyProvider>
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "header.askAssistant" }),
    );
    await vi.dynamicImportSettled();
    await vi.waitFor(() =>
      expect(screen.getByTestId("question-composer")).toBeDefined(),
    );
  });
});
