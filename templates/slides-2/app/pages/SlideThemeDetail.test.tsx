// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  previewQueries: [] as Array<{ id: string; pageIndex: number }>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => null,
  useActionQuery: (
    action: string,
    input: { id: string; pageIndex?: number },
  ) => {
    if (action === "get-slide-theme") {
      return {
        data: {
          id: input.id,
          name: "Aero",
          description: "Theme description",
          mode: "dark",
          preview: { background: "#111", text: "#fff", accent: "#aaf" },
          guide: "Theme guide",
        },
        error: undefined,
        isError: false,
        isLoading: false,
      };
    }
    if (action === "get-slide-theme-preview") {
      mocks.previewQueries.push({
        id: input.id,
        pageIndex: input.pageIndex ?? 0,
      });
      return {
        data: { pageIndex: input.pageIndex ?? 0, pageCount: 3 },
        error: undefined,
        isError: false,
        isLoading: false,
      };
    }
    throw new Error(`Unexpected theme action: ${action}`);
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, number>) =>
    values ? `${key}:${values.current}/${values.total}` : key,
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetPageTitle: vi.fn(),
}));

vi.mock("@/pages/SlideThemes", () => ({
  ThemePreview: ({
    theme,
    pageIndex,
  }: {
    theme: { name: string };
    pageIndex: number;
  }) => (
    <div data-testid="theme-preview">
      {theme.name}:{pageIndex}
    </div>
  ),
}));

import SlideThemeDetailPage from "./SlideThemeDetail";

afterEach(cleanup);

beforeEach(() => {
  mocks.previewQueries = [];
});

function renderThemeDetail() {
  const router = createMemoryRouter(
    [{ path: "/themes/:id", element: <SlideThemeDetailPage /> }],
    { initialEntries: ["/themes/aero"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("slide theme detail previews", () => {
  it("moves between demo pages with previous and next controls", () => {
    renderThemeDetail();

    expect(screen.getByTestId("theme-preview").textContent).toBe("Aero:0");
    expect(
      (
        screen.getByRole("button", {
          name: "templatesPage.previous",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "templatesPage.next" }));
    expect(screen.getByTestId("theme-preview").textContent).toBe("Aero:1");
    expect(mocks.previewQueries.at(-1)).toEqual({ id: "aero", pageIndex: 1 });

    fireEvent.click(
      screen.getByRole("button", { name: "templatesPage.previous" }),
    );
    expect(screen.getByTestId("theme-preview").textContent).toBe("Aero:0");
    expect(mocks.previewQueries.at(-1)).toEqual({ id: "aero", pageIndex: 0 });
  });

  it("supports arrow-key navigation", () => {
    renderThemeDetail();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("theme-preview").textContent).toBe("Aero:1");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("theme-preview").textContent).toBe("Aero:0");
  });
});
