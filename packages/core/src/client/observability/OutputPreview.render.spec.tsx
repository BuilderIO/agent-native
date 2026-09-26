// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseActionQuery } = vi.hoisted(() => ({
  mockUseActionQuery: vi.fn(),
}));
vi.mock("../use-action.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-action.js")>()),
  useActionQuery: mockUseActionQuery,
}));

import { OutputPreview } from "./OutputPreview.js";

beforeEach(() => vi.stubGlobal("IntersectionObserver", undefined));

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

  it("renders a full read-only MCP App without duplicating answer text", async () => {
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
    expect(container.querySelector('[data-preview-kind="text"]')).toBeNull();
  });

  it("does not invent a thumbnail from saved app markup", () => {
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

    expect(container.querySelector("[data-preview-kind]")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("does not use answer text as an app thumbnail", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer="A saved answer"
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

    expect(container.querySelector("[data-preview-kind]")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("does not use a descriptor as a thumbnail", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer="A saved answer"
          compact
          previewLabel="Agent output"
        />,
      );
    });

    expect(container.querySelector("[data-preview-kind]")).toBeNull();
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

describe("OutputPreview artifact reads", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockUseActionQuery.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("loads Design metadata first and only the selected HTML file", async () => {
    mockUseActionQuery.mockImplementation(
      (name: string, args: Record<string, unknown>) => {
        if (name === "get-design" && args.includeFileContent === false) {
          return {
            data: { files: [{ id: "file-1", filename: "index.html" }] },
            isError: false,
            isSuccess: true,
          };
        }
        if (name === "get-design" && args.fileId === "file-1") {
          return {
            data: {
              files: [
                {
                  content:
                    '<html><head><script>window.leak = true</script><style>.design { color: red; }</style></head><body><main class="design" onclick="window.leak = true"><img src="https://tracker.example/image.png">Real design</main></body></html>',
                },
              ],
            },
            isError: false,
            isSuccess: true,
          };
        }
        return { data: undefined, isError: false, isSuccess: false };
      },
    );

    act(() => {
      root.render(
        <OutputPreview
          answer=""
          artifactOnly
          artifactPreviewAppId="design"
          artifactPreviewId="design-1"
          previewLabel="Preview"
        />,
      );
    });

    expect(mockUseActionQuery).toHaveBeenCalledWith(
      "get-design",
      { id: "design-1", includeFileContent: false },
      expect.objectContaining({ enabled: true }),
    );
    expect(mockUseActionQuery).toHaveBeenCalledWith(
      "get-design",
      {
        id: "design-1",
        fileId: "file-1",
        includeFileContent: true,
      },
      expect.objectContaining({ enabled: true }),
    );
    await vi.waitFor(() =>
      expect(container.querySelector("iframe")?.srcdoc).toContain(
        "Real design",
      ),
    );
    expect(container.querySelector("iframe")?.className).toContain("w-[400%]");
    expect(container.querySelector("iframe")?.srcdoc).not.toContain(
      "window.leak",
    );
    expect(container.querySelector("iframe")?.srcdoc).not.toContain(
      "tracker.example",
    );
  });

  it("loads only one Slides HTML document and lets admins choose another slide", async () => {
    mockUseActionQuery.mockImplementation(
      (name: string, args: Record<string, unknown>) => {
        if (name === "get-deck" && args.compact === "true") {
          return {
            data: {
              slides: [
                { id: "slide-1", title: "Intro" },
                { id: "slide-2", title: "Results" },
              ],
            },
            isError: false,
            isSuccess: true,
          };
        }
        if (name === "get-deck" && args.compact === "false") {
          return {
            data: {
              slides: [{ id: args.slideId, content: "<main>Slide</main>" }],
            },
            isError: false,
            isSuccess: true,
          };
        }
        return { data: undefined, isError: false, isSuccess: false };
      },
    );

    act(() => {
      root.render(
        <OutputPreview
          answer=""
          artifactOnly
          artifactPreviewAppId="slides"
          artifactPreviewId="deck-1"
          artifactPreviewUrl="https://slides.agent-native.com/deck/deck-1/present"
          previewLabel="Preview"
        />,
      );
    });

    expect(mockUseActionQuery).toHaveBeenCalledWith(
      "get-deck",
      { id: "deck-1", compact: "true" },
      expect.objectContaining({ enabled: true }),
    );
    expect(mockUseActionQuery).toHaveBeenCalledWith(
      "get-deck",
      { id: "deck-1", slideId: "slide-1", compact: "false" },
      expect.objectContaining({ enabled: true }),
    );
    expect(
      container.querySelectorAll("[data-review-slide-strip] button"),
    ).toHaveLength(2);
    await vi.waitFor(() =>
      expect(container.querySelector("iframe")?.srcdoc).toContain("Slide"),
    );
    expect(container.querySelector("iframe")?.className).toContain("w-[400%]");
    expect(container.querySelector("iframe")?.className).toContain("top-10");
  });
});

describe("OutputPreview authenticated artifact frames", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockUseActionQuery.mockImplementation((actionName, params) => {
      if (actionName === "get-deck") {
        return {
          data:
            params.compact === "true"
              ? { slides: [{ id: "slide-1" }] }
              : {
                  slides: [
                    { id: "slide-1", content: "<main>Saved slide</main>" },
                  ],
                },
          isError: false,
          isSuccess: true,
        };
      }
      return {
        data: {
          files: [
            {
              filename: "index.html",
              fileType: "text/html",
              content: "<main>Actual saved Design</main>",
            },
          ],
        },
        isError: false,
        isSuccess: true,
      };
    });
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the parent-fetched Design in an opaque sandbox", async () => {
    const origin = "https://design.agent-native.com";
    act(() => {
      root.render(
        <OutputPreview
          answer="Saved design"
          artifactPreviewAppId="design"
          artifactPreviewId="site-42"
          artifactPreviewUrl={`${origin}/present/site-42?reviewEmbed=1`}
          artifactOnly
          compact
          previewLabel="Agent output"
        />,
      );
    });

    await vi.waitFor(() =>
      expect(
        container.querySelector(
          '[data-preview-kind="design-iframe-thumbnail"] iframe',
        ),
      ).not.toBeNull(),
    );
    const preview = container.querySelector(
      '[data-preview-kind="design-iframe-thumbnail"]',
    );
    const iframe = preview?.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBeNull();
    expect(iframe?.srcdoc).toContain("Actual saved Design");
    expect(iframe?.srcdoc).toContain("connect-src 'none'");
    expect(iframe?.srcdoc).toContain("script-src 'none'");
    expect(iframe?.getAttribute("loading")).toBe("lazy");
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.className).toContain("h-[1200%]");
    expect(iframe?.className).toContain("w-[1200%]");
    expect(preview?.className).toContain("overflow-hidden");
  });

  it("fetches only the selected Slides page before rendering its HTML", async () => {
    act(() => {
      root.render(
        <OutputPreview
          answer="A saved summary"
          artifactPreviewAppId="slides"
          artifactPreviewId="deck-42"
          artifactPreviewUrl="https://slides.agent-native.com/deck/deck-42/present?reviewEmbed=1"
          artifactOnly
          compact
          previewLabel="Agent output"
        />,
      );
    });

    await vi.waitFor(() =>
      expect(
        container.querySelector(
          '[data-preview-kind="artifact-iframe-thumbnail"] iframe',
        ),
      ).not.toBeNull(),
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBeNull();
    expect(iframe?.srcdoc).toContain("Saved slide");
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(
      mockUseActionQuery.mock.calls.some(
        ([actionName, params]) =>
          actionName === "get-deck" &&
          params.slideId === "slide-1" &&
          params.compact === "false",
      ),
    ).toBe(true);
  });

  it("does not derive an authenticated preview from an artifact path alone", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer="A saved summary"
          compact
          previewLabel="Agent output"
        />,
      );
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[data-preview-kind]")).toBeNull();
  });

  it("renders no thumbnail when there is no real Design artifact", () => {
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
    expect(container.querySelector("[data-preview-kind]")).toBeNull();
  });

  it("never frames a Design URL scraped from the agent answer", () => {
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
