// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { DashboardFilterBar } from "./DashboardFilterBar";

describe("collapsed filter bar layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders a Filters label before the toggle", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <DashboardFilterBar
            filters={[{ id: "since", label: "Since", type: "date" }]}
          />
        </MemoryRouter>,
      );
    });

    const label = container.querySelector("span");
    expect(label?.textContent).toBe("sqlDashboard.filters");
    expect(label?.className).toContain("group-data-[state=open]:hidden");

    const trigger = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("sqlDashboard.hide"),
    );
    expect(
      label!.compareDocumentPosition(trigger!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      (trigger as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("sqlDashboard.filters");
    expect(container.textContent).toContain("sqlDashboard.show");
  });
});
