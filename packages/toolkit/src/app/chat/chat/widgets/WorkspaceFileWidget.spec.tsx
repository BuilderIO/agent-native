// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceFileWidget } from "./WorkspaceFileWidget.js";

describe("WorkspaceFileWidget", () => {
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

  it("renders an authenticated direct-download link", () => {
    act(() => {
      root.render(
        <WorkspaceFileWidget
          result={{
            file: {
              resourceId: "resource/example",
              path: "exports/report.csv",
              name: "report.csv",
              contentType: "text/csv",
              sizeBytes: 2048,
            },
          }}
        />,
      );
    });

    const link = container.querySelector("a");
    expect(container.textContent).toContain("report.csv");
    expect(container.textContent).toContain("2 KB");
    expect(container.textContent).toContain("Download");
    expect(link?.getAttribute("href")).toBe(
      "/_agent-native/resources/resource%2Fexample?download=1",
    );
    expect(link?.getAttribute("download")).toBe("report.csv");
  });
});
