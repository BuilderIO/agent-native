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

describe("OutputPreview trusted Design frames", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders a bounded, lazy, no-referrer iframe for a real Design route", () => {
    const origin = "https://design.agent-native.com";
    act(() => {
      root.render(
        <OutputPreview
          answer={JSON.stringify({
            type: "design",
            title: "Saved design",
            url: `${origin}/design/site-42?view=overview#screen-2`,
          })}
          compact
          previewLabel="Agent output"
        />,
      );
    });

    const preview = container.querySelector(
      '[data-preview-kind="design-iframe-thumbnail"]',
    );
    const iframe = preview?.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(
      `${origin}/present/site-42?reviewEmbed=1`,
    );
    expect(iframe?.getAttribute("loading")).toBe("lazy");
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe?.className).toContain("h-[600%]");
    expect(iframe?.className).toContain("w-[600%]");
    expect(preview?.className).toContain("overflow-hidden");
  });

  it("renders the evidenced Design artifact path as its real thumbnail", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer="A saved summary"
          compact
          designPreviewPath="/present/design-17"
          previewLabel="Agent output"
        />,
      );
    });

    const iframe = container.querySelector(
      '[data-preview-kind="design-iframe-thumbnail"] iframe',
    );
    expect(iframe?.getAttribute("src")).toBe(
      `${window.location.origin}/present/design-17?reviewEmbed=1`,
    );
  });

  it("shows real design text instead of a fabricated thumbnail when no route exists", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer={JSON.stringify({
            type: "design",
            title: "A real design title",
            summary: "A real design summary",
            tokens: [{ label: "Accent", value: "green" }],
          })}
          compact
          previewLabel="Agent output"
        />,
      );
    });

    expect(container.querySelector("iframe")).toBeNull();
    const preview = container.querySelector(
      '[data-preview-kind="design-thumbnail"]',
    );
    expect(preview?.textContent).toContain("A real design title");
    expect(preview?.textContent).toContain("A real design summary");
    expect(preview?.querySelectorAll("span")).toHaveLength(1);
  });

  it("never frames an untrusted Design route", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer={JSON.stringify({
            type: "design",
            title: "Untrusted route",
            url: "https://evil.example/design/site-42",
          })}
          compact
          previewLabel="Agent output"
        />,
      );
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(
      container.querySelector('[data-preview-kind="design-iframe-thumbnail"]'),
    ).toBeNull();
  });
});
