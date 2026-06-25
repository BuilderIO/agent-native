// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { DataTableWidget } from "./DataTableWidget.js";

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
});
