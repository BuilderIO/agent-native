// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadFile } from "../../db-admin/export-utils.js";
import { DataTableWidget } from "./DataTableWidget.js";

vi.mock("../../components/ui/dropdown-menu.js", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../db-admin/export-utils.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../db-admin/export-utils.js")>();
  return {
    ...actual,
    downloadFile: vi.fn(),
  };
});

const roots: Root[] = [];
const initialBasePath = process.env.VITE_APP_BASE_PATH;

async function renderWidget(action: { label: string; href: string }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <DataTableWidget
        action={action}
        table={{
          title: "Responses",
          columns: [{ key: "name", label: "Name" }],
          rows: [{ id: "1", name: "Ada" }],
        }}
      />,
    );
  });
  return container;
}

describe("DataTableWidget", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
    document.body.innerHTML = "";
    process.env.VITE_APP_BASE_PATH = initialBasePath;
    vi.mocked(downloadFile).mockClear();
  });

  it("does not render executable action URLs", async () => {
    const container = await renderWidget({
      label: "Open",
      href: "javascript:alert(1)",
    });

    expect(container.querySelector("a")).toBeNull();
  });

  it("routes app-relative action URLs through the configured basename", async () => {
    process.env.VITE_APP_BASE_PATH = "/mounted";

    const container = await renderWidget({
      label: "Open",
      href: "/forms/form-1",
    });

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/mounted/forms/form-1",
    );
  });

  it("exports visible table rows as CSV from the overflow menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <DataTableWidget
          table={{
            title: "Responses",
            columns: [
              { key: "name", label: "Name" },
              { key: "score", label: "Score", align: "right" },
            ],
            rows: [
              { id: "1", name: "Ada", score: 42 },
              { id: "2", name: "Grace, Hopper", score: 7 },
            ],
          }}
        />,
      );
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Download CSV"))
        ?.click();
    });

    expect(downloadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^responses-\d{4}-\d{2}-\d{2}\.csv$/),
      "text/csv;charset=utf-8",
      'Name,Score\r\nAda,42\r\n"Grace, Hopper",7',
    );
  });
});
