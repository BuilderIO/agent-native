// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutputPreview } from "./OutputPreview.js";

describe("OutputPreview chart accessibility", () => {
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
  });

  it("includes plotted points in the chart accessible name", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer={JSON.stringify({
            type: "chart",
            title: "Latency",
            unit: "ms",
            data: [
              { label: "p50", value: 120 },
              { label: "p95", value: 480 },
            ],
          })}
          previewLabel="Agent output"
        />,
      );
    });

    const chart = container.querySelector('[data-preview-kind="chart"]');
    expect(chart?.getAttribute("role")).toBe("img");
    expect(chart?.getAttribute("aria-label")).toBe(
      "Latency: p50: 120ms, p95: 480ms",
    );
  });
});

describe("OutputPreview saved MCP Apps", () => {
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
  });

  it("keeps the saved answer alongside a full read-only MCP App", async () => {
    await act(async () => {
      root.render(
        <OutputPreview
          answer="Fallback answer"
          maxAppHeight={420}
          previewLabel="Agent output"
          inlineApp={{
            serverId: "design",
            toolName: "render",
            originalToolName: "render",
            resourceUri: "ui://design",
            toolInput: {},
            toolResult: {},
            resource: {
              uri: "ui://design",
              mimeType: "text/html;profile=mcp-app",
              text: "<html><body>Saved design</body></html>",
            },
          }}
        />,
      );
    });

    await vi.waitFor(() =>
      expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe(
        "",
      ),
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.style.maxHeight).toBe("420px");
    await vi.waitFor(() => expect(iframe?.srcdoc).toContain("Saved design"));
    expect(
      container.querySelector('[data-preview-kind="text"]')?.textContent,
    ).toBe("Fallback answer");
  });

  it("shows an app thumbnail without mounting its iframe", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer=""
          compact
          previewLabel="Agent output"
          inlineApp={{
            serverId: "design",
            toolName: "render",
            originalToolName: "render",
            resourceUri: "ui://design",
            toolInput: {},
            toolResult: {},
            resource: {
              uri: "ui://design",
              mimeType: "text/html;profile=mcp-app",
              text: "<html><body>Saved design</body></html>",
            },
          }}
        />,
      );
    });

    expect(
      container.querySelector('[data-preview-kind="app-thumbnail"]'),
    ).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("prefers an app thumbnail over answer text in compact mode", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer="A saved answer"
          compact
          inlineAppTitle="Design preview"
          previewLabel="Agent output"
          inlineApp={{
            serverId: "design",
            toolName: "render",
            originalToolName: "render",
            resourceUri: "ui://design",
            toolInput: {},
            toolResult: {},
            resource: {
              uri: "ui://design",
              mimeType: "text/html;profile=mcp-app",
              text: "<html><body>Saved design</body></html>",
            },
          }}
        />,
      );
    });

    expect(
      container.querySelector('[data-preview-kind="app-thumbnail"]')
        ?.textContent,
    ).toBe("Design preview");
    expect(container.querySelector('[data-preview-kind="text"]')).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("shows a descriptor-only app thumbnail over answer text", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer="A saved answer"
          compact
          inlineAppTitle="Slides deck"
          previewLabel="Agent output"
        />,
      );
    });

    expect(
      container.querySelector('[data-preview-kind="app-thumbnail"]')
        ?.textContent,
    ).toBe("Slides deck");
    expect(container.querySelector('[data-preview-kind="text"]')).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("shows the saved app rather than duplicating its structured payload", async () => {
    act(() => {
      root.render(
        <OutputPreview
          answer={JSON.stringify({
            type: "design",
            title: "A story in three slides",
            summary: "Signal, evidence, next step.",
          })}
          previewLabel="Agent output"
          inlineApp={{
            serverId: "slides",
            toolName: "render",
            originalToolName: "render",
            resourceUri: "ui://slides/render",
            toolInput: {},
            toolResult: {},
            resource: {
              uri: "ui://slides/render",
              mimeType: "text/html;profile=mcp-app",
              text: "<html><body>Rendered slides</body></html>",
            },
          }}
        />,
      );
    });

    await vi.waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull(),
    );
    expect(container.textContent).not.toContain("A story in three slides");
    expect(container.querySelector('[data-preview-kind="design"]')).toBeNull();
  });
});
