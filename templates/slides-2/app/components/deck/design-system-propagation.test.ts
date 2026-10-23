// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SlideContentRenderer from "@/components/slides-2-runtime/SlideContentRenderer";
import type { Slide } from "@/context/DeckContext";
import SlideRoute from "@/routes/slide";

const mocks = vi.hoisted(() => ({
  actionCalls: [] as Array<{ action: string; args: Record<string, unknown> }>,
  queryCalls: [] as Array<{
    action: string;
    args?: Record<string, unknown>;
    enabled?: boolean;
  }>,
  deck: undefined as unknown,
  designSystem: {
    colors: {
      primary: "#2148C0",
      secondary: "#A8492C",
      accent: "#C01B70",
      background: "#101010",
      surface: "#242424",
      text: "#F2F2F2",
      textMuted: "#B8B8B8",
    },
    typography: {
      headingFont: "Inter",
      bodyFont: "Inter",
      headingWeight: "700",
      bodyWeight: "400",
      headingSizes: { h1: "46px", h2: "30px", h3: "24px" },
    },
    spacing: { slidePadding: "80px", elementGap: "24px" },
    borders: { radius: "12px", accentWidth: "2px" },
    slideDefaults: { background: "#101010", labelStyle: "uppercase" as const },
    logos: [],
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  callActionWithRetry: (action: string, args: Record<string, unknown>) => {
    mocks.actionCalls.push({ action, args });
    return Promise.resolve(mocks.deck);
  },
  useActionQuery: (
    action: string,
    args?: Record<string, unknown>,
    options?: { enabled?: boolean },
  ) => {
    mocks.queryCalls.push({ action, args, enabled: options?.enabled });
    return action === "get-design-system" && options?.enabled
      ? {
          data: {
            id: "system-1",
            title: "Brand system",
            data: JSON.stringify(mocks.designSystem),
          },
          isLoading: false,
        }
      : { data: undefined, error: undefined, isLoading: false };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/navigation", () => ({
  isInAgentEmbed: () => false,
  postNavigate: vi.fn(),
}));

vi.mock("@/i18n/en-US", () => ({
  default: { raw: { slidePreviewTitle: "Slide preview" } },
}));

vi.mock("./MermaidRenderer", async () => {
  const { createElement } = await import("react");
  return { MermaidRenderer: () => createElement("div") };
});

vi.mock("./ExcalidrawSlide", async () => {
  const { createElement } = await import("react");
  return {
    ExcalidrawThumbnail: () => createElement("div"),
    parseExcalidrawData: () => null,
  };
});

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function readAppFile(relativePath: string) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

function findOpeningTag(source: string, componentName: string) {
  const openingTag = new RegExp(`<${componentName}\\b`, "g");

  for (const match of source.matchAll(openingTag)) {
    let braceDepth = 0;
    let quote: '"' | "'" | "`" | null = null;
    let escaped = false;

    for (
      let index = (match.index ?? 0) + match[0].length;
      index < source.length;
      index += 1
    ) {
      const character = source[index];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        braceDepth += 1;
      } else if (character === "}") {
        braceDepth -= 1;
      } else if (character === ">" && braceDepth === 0) {
        return source.slice(match.index, index + 1);
      }
    }
  }

  return undefined;
}

function expectsDesignSystemProp(source: string, componentName: string) {
  expect(findOpeningTag(source, componentName)).toContain(
    "designSystem={designSystem}",
  );
}

afterEach(cleanup);

beforeEach(() => {
  mocks.actionCalls = [];
  mocks.queryCalls = [];
  mocks.deck = undefined;
});

describe("slide design-system propagation", () => {
  it("keeps preview and presentation renderers on the active deck tokens", () => {
    expectsDesignSystemProp(
      // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
      readAppFile("components/editor/EditorSidebar.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
      readAppFile("components/editor/GeneratingSlidePreview.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
      readAppFile("components/presentation/PresentationView.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
      readAppFile("components/presentation/PresenterView.tsx"),
      "SlideRenderer",
    );

    // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
    const deckEditorSource = readAppFile("pages/DeckEditor.tsx");
    expectsDesignSystemProp(deckEditorSource, "EditorSidebar");
    expectsDesignSystemProp(deckEditorSource, "GeneratingSlidePreview");
    // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
    expectsDesignSystemProp(readAppFile("pages/Presentation.tsx"), "View");

    // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
    const sharedPresentationSource = readAppFile(
      "pages/SharedPresentation.tsx",
    );
    expect(sharedPresentationSource).toContain("deck.designSystem");
    expectsDesignSystemProp(sharedPresentationSource, "PresentationView");
  });

  it("renders linked tokens through the slide preview route and runtime renderer", async () => {
    const slide: Slide = {
      id: "slide-route",
      layout: "blank",
      notes: "",
      content: '<div class="fmd-slide"><h1>Route preview</h1></div>',
    };
    mocks.deck = {
      title: "Brand deck",
      designSystemId: "system-1",
      slides: [slide],
    };

    render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/slide?deckId=deck-1&slideNumber=1"] },
        createElement(SlideRoute),
      ),
    );

    await waitFor(() => {
      const canvas = document.querySelector<HTMLElement>(
        '[data-slide-canvas="slide-route"]',
      );
      expect(canvas?.style.getPropertyValue("--ds-accent")).toBe("#C01B70");
      expect(canvas?.style.getPropertyValue("--ds-text")).toBe("#F2F2F2");
    });
    expect(mocks.actionCalls).toContainEqual({
      action: "get-deck",
      args: { id: "deck-1" },
    });
    expect(mocks.queryCalls).toContainEqual({
      action: "get-design-system",
      args: { id: "system-1", deckId: "deck-1" },
      enabled: true,
    });
  });

  it("applies the supplied design-system tokens in the exported content renderer", () => {
    const slide: Slide = {
      id: "slide-wrapper",
      layout: "blank",
      notes: "",
      content: '<div class="fmd-slide"><h1>Runtime preview</h1></div>',
    };

    render(
      createElement(SlideContentRenderer, {
        slide,
        designSystem: mocks.designSystem,
      }),
    );

    const canvas = document.querySelector<HTMLElement>(
      '[data-slide-canvas="slide-wrapper"]',
    );
    expect(canvas?.style.getPropertyValue("--ds-accent")).toBe("#C01B70");
    expect(canvas?.style.getPropertyValue("--ds-text-muted")).toBe("#B8B8B8");
  });
});
