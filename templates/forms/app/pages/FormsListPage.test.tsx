// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.hoisted(() => vi.fn());
const formsQueryMock = vi.hoisted(() => ({
  data: [
    {
      id: "form-1",
      title: "Project intake",
      description: "Collect the project brief.",
      createdAt: "2026-08-01T00:00:00.000Z",
      responseCount: 3,
      status: "draft",
      visibility: "private",
      role: "owner",
    },
  ],
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));
const mutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: () => "Aug 1",
    formatNumber: (value: number) => String(value),
  }),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/ui", () => ({
  buildSignInReturnHref: () => "/sign-in",
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetHeaderActions: vi.fn(),
  useSetPageTitle: vi.fn(),
}));

vi.mock("@agent-native/toolkit/sharing", () => ({
  VisibilityBadge: ({ visibility }: { visibility?: string }) => (
    <span>{visibility}</span>
  ),
}));

vi.mock("@/components/CloudUpgrade", () => ({
  CloudUpgrade: () => null,
}));

vi.mock("@/hooks/use-db-status", () => ({
  useDbStatus: () => ({ isLocal: false }),
}));

vi.mock("@/hooks/use-forms", () => ({
  useCreateForm: () => mutationMock,
  useDeleteForm: () => mutationMock,
  useForms: () => formsQueryMock,
  useRestoreForm: () => mutationMock,
  useUpdateForm: () => mutationMock,
}));

import { MemoryRouter } from "react-router";

import { FormsListPage } from "./FormsListPage";

describe("FormsListPage", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    navigateMock.mockClear();
  });

  function renderPage() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <MemoryRouter initialEntries={["/forms"]}>
          <FormsListPage />
        </MemoryRouter>,
      );
    });
  }

  it("renders primary form navigation as a native link", () => {
    renderPage();

    const link = container?.querySelector<HTMLAnchorElement>(
      'a[href="/forms/form-1"]',
    );

    expect(link?.textContent).toContain("Project intake");
  });

  it("keeps modified link clicks out of the row navigate handler", () => {
    renderPage();

    const link = container?.querySelector<HTMLAnchorElement>(
      'a[href="/forms/form-1"]',
    );
    expect(link).toBeTruthy();

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    link?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("keeps plain row clicks navigating to the form", () => {
    renderPage();

    const row = container?.querySelector<HTMLElement>('[role="button"]');
    expect(row).toBeTruthy();

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(navigateMock).toHaveBeenCalledWith("/forms/form-1");
  });
});
