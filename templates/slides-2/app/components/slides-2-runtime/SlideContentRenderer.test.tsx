// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queries: [] as Array<{
    action: string;
    args: Record<string, unknown>;
    enabled?: boolean;
  }>,
  query: {
    data: undefined as unknown,
    error: undefined as unknown,
    isLoading: false,
  },
  sandboxArtifact: undefined as unknown,
  htmlSlide: undefined as unknown,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  useActionQuery: (
    action: string,
    args: Record<string, unknown>,
    options?: { enabled?: boolean },
  ) => {
    mocks.queries.push({ action, args, enabled: options?.enabled });
    return mocks.query;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/deck/SlideRenderer", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: { slide: { id: string } }) => {
      mocks.htmlSlide = props.slide;
      return createElement("div", { "data-testid": "html-slide" });
    },
  };
});

vi.mock("./Slides2Canvas", async () => {
  const { createElement } = await import("react");
  return {
    Slides2Canvas: ({ children }: { children: React.ReactNode }) =>
      createElement("div", { "data-testid": "slides-2-canvas" }, children),
  };
});

vi.mock("./SandboxedSlide", async () => {
  const { createElement } = await import("react");
  return {
    SandboxedSlide: (props: { artifact: unknown }) => {
      mocks.sandboxArtifact = props.artifact;
      return createElement("div", { "data-testid": "sandboxed-slide" });
    },
  };
});

import type { Slide } from "@/context/DeckContext";

import SlideContentRenderer from "./SlideContentRenderer";

afterEach(cleanup);

beforeEach(() => {
  mocks.queries = [];
  mocks.query = { data: undefined, error: undefined, isLoading: false };
  mocks.sandboxArtifact = undefined;
  mocks.htmlSlide = undefined;
});

const sourceSlide = {
  id: "slide-source",
  content: "",
  sourceTsx: "export default function Slide() { return <main />; }",
  sourceRuntimeRequired: true,
  notes: "",
  layout: "content",
} as Slide;

const runtimeArtifact = {
  protocolVersion: 1,
  deckId: "deck-1",
  slideId: sourceSlide.id,
  revision: 3,
  sourceHash: "a".repeat(64),
  width: 1920,
  height: 1080,
  html: "",
  assetOrigins: [],
  runtime: { bundle: "validated-worker-artifact" },
};

describe("SlideContentRenderer", () => {
  it("renders source-backed slides with the bounded sandbox artifact", () => {
    mocks.query.data = runtimeArtifact;

    render(
      <SlideContentRenderer
        slide={sourceSlide}
        slidePosition={{ number: 2, count: 4 }}
        sourceDeckId="deck-1"
      />,
    );

    expect(mocks.queries).toEqual([
      {
        action: "get-slide-render",
        args: { deckId: "deck-1", slideId: sourceSlide.id },
        enabled: true,
      },
    ]);
    expect(screen.getByTestId("slides-2-canvas")).toBeTruthy();
    expect(screen.getByTestId("sandboxed-slide")).toBeTruthy();
    expect(mocks.sandboxArtifact).toBe(runtimeArtifact);
  });

  it("preserves HTML slide rendering without requesting a runtime", () => {
    const slide = {
      ...sourceSlide,
      content: "<main>Imported HTML</main>",
      sourceTsx: undefined,
      sourceRuntimeRequired: undefined,
    } as Slide;

    render(<SlideContentRenderer slide={slide} sourceDeckId="deck-1" />);

    expect(screen.getByTestId("html-slide")).toBeTruthy();
    expect(mocks.htmlSlide).toBe(slide);
    expect(mocks.queries).toEqual([]);
  });

  it("does not request source runtime for snapshots without a live deck ID", () => {
    render(<SlideContentRenderer slide={sourceSlide} />);

    expect(screen.getByRole("status").textContent).toBe(
      "presentation.reactSlideUnavailable",
    );
    expect(mocks.queries[0]).toMatchObject({ enabled: false });
  });

  it("shows an explicit error when the source render action fails", () => {
    mocks.query.error = new Error("render access denied");

    render(<SlideContentRenderer slide={sourceSlide} sourceDeckId="deck-1" />);

    expect(screen.getByRole("alert").textContent).toBe("render access denied");
  });
});
