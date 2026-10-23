// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actionCalls: [] as Array<{ action: string; args: Record<string, unknown> }>,
  actionResponses: [] as Array<Promise<unknown>>,
  deck: undefined as unknown,
  translate: (key: string) => key,
  renderCalls: [] as Array<{
    action: string;
    args: Record<string, unknown>;
    enabled?: boolean;
  }>,
  renderQuery: {
    data: undefined as unknown,
    error: undefined as unknown,
    isLoading: false,
  },
  sandboxArtifact: undefined as unknown,
  sandboxProps: undefined as Record<string, unknown> | undefined,
  htmlSlide: undefined as unknown,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  callActionWithRetry: (action: string, args: Record<string, unknown>) => {
    mocks.actionCalls.push({ action, args });
    return mocks.actionResponses.shift() ?? Promise.resolve(mocks.deck);
  },
  useActionQuery: (
    action: string,
    args: Record<string, unknown>,
    options?: { enabled?: boolean },
  ) => {
    mocks.renderCalls.push({ action, args, enabled: options?.enabled });
    return mocks.renderQuery;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => mocks.translate,
}));

vi.mock("@agent-native/core/client/navigation", () => ({
  isInAgentEmbed: () => false,
  postNavigate: vi.fn(),
}));

vi.mock("@agent-native/core/shared", () => ({
  normalizeDocumentTitle: (title: string) => title,
}));

vi.mock("@/hooks/use-deck-design-system", () => ({
  useDeckDesignSystem: () => ({ designSystem: undefined }),
}));

vi.mock("@/i18n/en-US", () => ({
  default: { raw: { slidePreviewTitle: "Slide preview" } },
}));

vi.mock("@/components/deck/SlideRenderer", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: { slide: { id: string } }) => {
      mocks.htmlSlide = props.slide;
      return createElement("div", {
        "data-testid": "html-slide",
        "data-slide-id": props.slide.id,
      });
    },
  };
});

vi.mock("@/components/slides-2-runtime/Slides2Canvas", async () => {
  const { createElement } = await import("react");
  return {
    Slides2Canvas: ({ children }: { children: React.ReactNode }) =>
      createElement("div", { "data-testid": "slides-2-canvas" }, children),
  };
});

vi.mock("@/components/slides-2-runtime/SandboxedSlide", async () => {
  const { createElement } = await import("react");
  return {
    SandboxedSlide: (props: Record<string, unknown>) => {
      mocks.sandboxArtifact = props.artifact;
      mocks.sandboxProps = props;
      return createElement("div", { "data-testid": "sandboxed-slide" });
    },
  };
});

import type { Slide } from "@/context/DeckContext";

import SlideRoute from "./slide";

afterEach(cleanup);

beforeEach(() => {
  mocks.actionCalls = [];
  mocks.deck = undefined;
  mocks.actionResponses = [];
  mocks.renderCalls = [];
  mocks.renderQuery = { data: undefined, error: undefined, isLoading: false };
  mocks.sandboxArtifact = undefined;
  mocks.sandboxProps = undefined;
  mocks.htmlSlide = undefined;
});

function RouteSwitcher() {
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setSearchParams({ deckId: "deck-next", slideNumber: "1" })
        }
      >
        Next deck
      </button>
      <button
        type="button"
        onClick={() =>
          setSearchParams({
            deckId: "deck-source",
            slideNumber: "1",
            step: "2",
          })
        }
      >
        Set reveal step
      </button>
      <button
        type="button"
        onClick={() =>
          setSearchParams({
            deckId: "deck-source",
            slideNumber: "1",
            step: "501",
          })
        }
      >
        Set invalid reveal step
      </button>
    </>
  );
}

function renderRoute(
  withSwitcher = false,
  initialEntry = "/slide?deckId=deck-source&slideNumber=1",
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      {withSwitcher ? <RouteSwitcher /> : null}
      <SlideRoute />
    </MemoryRouter>,
  );
}

describe("slide preview source rendering", () => {
  it("loads the saved source slide and renders its authorized sandbox artifact", async () => {
    const sourceSlide = {
      id: "slide-source",
      content: "",
      sourceTsx: "export default function Slide() { return <main />; }",
      sourceRuntimeRequired: true,
      notes: "",
      layout: "content",
    } as Slide;
    const artifact = {
      protocolVersion: 1,
      deckId: "deck-source",
      slideId: "slide-source",
      revision: 2,
      sourceHash: "a".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      assetOrigins: [],
      runtime: { bundle: "bounded-worker-artifact" },
    };
    mocks.deck = { title: "Source deck", slides: [sourceSlide] };
    mocks.renderQuery.data = artifact;

    renderRoute();

    await waitFor(() =>
      expect(screen.getByTestId("sandboxed-slide")).toBeTruthy(),
    );

    expect(mocks.actionCalls).toContainEqual({
      action: "get-deck",
      args: { id: "deck-source" },
    });
    expect(mocks.renderCalls).toContainEqual({
      action: "get-slide-render",
      args: { deckId: "deck-source", slideId: "slide-source" },
      enabled: true,
    });
    expect(mocks.sandboxArtifact).toBe(artifact);
    expect(mocks.sandboxProps?.initialRevealedSteps).toBeNull();
  });

  it("keeps the preview stage empty until the requested deck has loaded", async () => {
    let resolveDeck!: (deck: unknown) => void;
    const deckResponse = new Promise<unknown>((resolve) => {
      resolveDeck = resolve;
    });
    mocks.actionResponses = [deckResponse];

    renderRoute();

    await waitFor(() => expect(mocks.actionCalls).toHaveLength(1));
    expect(screen.queryByTestId("html-slide")).toBeNull();
    expect(screen.queryByTestId("sandboxed-slide")).toBeNull();

    await act(async () => {
      resolveDeck({
        title: "Loaded deck",
        slides: [{ id: "slide-html", content: "<main>Loaded</main>" }],
      });
      await deckResponse;
    });

    expect(screen.getByTestId("html-slide")).toBeTruthy();
  });

  it.each([
    ["0", 0],
    ["2", 2],
    ["500", 500],
  ])("starts the source slide at reveal step %s", async (step, expected) => {
    const sourceSlide = {
      id: "slide-source",
      content: "",
      sourceTsx: "export default function Slide() { return <main />; }",
      sourceRuntimeRequired: true,
      notes: "",
      layout: "content",
    } as Slide;
    mocks.deck = { title: "Source deck", slides: [sourceSlide] };
    mocks.renderQuery.data = {
      protocolVersion: 1,
      deckId: "deck-source",
      slideId: "slide-source",
      revision: 2,
      sourceHash: "a".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      assetOrigins: [],
      runtime: { bundle: "bounded-worker-artifact" },
    };

    renderRoute(false, `/slide?deckId=deck-source&slideNumber=1&step=${step}`);

    await waitFor(() =>
      expect(screen.getByTestId("sandboxed-slide")).toBeTruthy(),
    );
    expect(mocks.sandboxProps?.initialRevealedSteps).toBe(expected);
  });

  it.each(["", "invalid", "-1", "1.5", "1e2", " 1 ", "501"])(
    "rejects invalid preview reveal step %s before loading a deck",
    async (step) => {
      renderRoute(
        false,
        `/slide?deckId=deck-source&slideNumber=1&step=${encodeURIComponent(step)}`,
      );

      await waitFor(() =>
        expect(screen.getByText("raw.couldNotLoadSlide")).toBeTruthy(),
      );
      expect(mocks.actionCalls).toHaveLength(0);
    },
  );

  it("rejects ambiguous duplicate reveal steps before loading a deck", async () => {
    renderRoute(false, "/slide?deckId=deck-source&slideNumber=1&step=1&step=2");

    expect(screen.getByText("raw.couldNotLoadSlide")).toBeTruthy();
    expect(mocks.actionCalls).toHaveLength(0);
  });

  it("shows a status-specific error when the deck cannot be loaded", async () => {
    const unavailable = Object.assign(new Error("temporarily unavailable"), {
      status: 503,
    });
    mocks.actionResponses = [Promise.reject(unavailable)];

    renderRoute();

    await waitFor(() =>
      expect(screen.getByText("raw.deckLoadFailedStatus")).toBeTruthy(),
    );
    expect(screen.queryByTestId("html-slide")).toBeNull();
    expect(screen.queryByTestId("sandboxed-slide")).toBeNull();
  });

  it("shows an error instead of rendering an empty deck", async () => {
    mocks.deck = { title: "Empty deck", slides: [] };

    renderRoute();

    await waitFor(() =>
      expect(screen.getByText("raw.deckHasNoSlides")).toBeTruthy(),
    );
    expect(screen.queryByTestId("html-slide")).toBeNull();
    expect(screen.queryByTestId("sandboxed-slide")).toBeNull();
  });

  it("does not reload a deck when a valid reveal step changes", async () => {
    const sourceSlide = {
      id: "slide-source",
      content: "",
      sourceTsx: "export default function Slide() { return <main />; }",
      sourceRuntimeRequired: true,
      notes: "",
      layout: "content",
    } as Slide;
    mocks.deck = { title: "Source deck", slides: [sourceSlide] };
    mocks.renderQuery.data = {
      protocolVersion: 1,
      deckId: "deck-source",
      slideId: "slide-source",
      revision: 2,
      sourceHash: "a".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      assetOrigins: [],
      runtime: { bundle: "bounded-worker-artifact" },
    };

    renderRoute(true);
    await waitFor(() =>
      expect(screen.getByTestId("sandboxed-slide")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Set reveal step" }));

    await waitFor(() =>
      expect(mocks.sandboxProps?.initialRevealedSteps).toBe(2),
    );
    expect(mocks.actionCalls).toHaveLength(1);
  });

  it("rejects an invalid reveal-step navigation before rebuilding the sandbox", async () => {
    const sourceSlide = {
      id: "slide-source",
      content: "",
      sourceTsx: "export default function Slide() { return <main />; }",
      sourceRuntimeRequired: true,
      notes: "",
      layout: "content",
    } as Slide;
    mocks.deck = { title: "Source deck", slides: [sourceSlide] };
    mocks.renderQuery.data = {
      protocolVersion: 1,
      deckId: "deck-source",
      slideId: "slide-source",
      revision: 2,
      sourceHash: "a".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      assetOrigins: [],
      runtime: { bundle: "bounded-worker-artifact" },
    };

    renderRoute(true);
    await waitFor(() =>
      expect(screen.getByTestId("sandboxed-slide")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Set invalid reveal step" }),
    );

    expect(screen.getByText("raw.couldNotLoadSlide")).toBeTruthy();
    expect(mocks.actionCalls).toHaveLength(1);
  });

  it("recovers after an invalid reveal-step URL is corrected", async () => {
    const sourceSlide = {
      id: "slide-source",
      content: "",
      sourceTsx: "export default function Slide() { return <main />; }",
      sourceRuntimeRequired: true,
      notes: "",
      layout: "content",
    } as Slide;
    mocks.deck = { title: "Source deck", slides: [sourceSlide] };
    mocks.renderQuery.data = {
      protocolVersion: 1,
      deckId: "deck-source",
      slideId: "slide-source",
      revision: 2,
      sourceHash: "a".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      assetOrigins: [],
      runtime: { bundle: "bounded-worker-artifact" },
    };

    renderRoute(true, "/slide?deckId=deck-source&slideNumber=1&step=501");
    expect(screen.getByText("raw.couldNotLoadSlide")).toBeTruthy();
    expect(mocks.actionCalls).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Set reveal step" }));

    await waitFor(() =>
      expect(screen.getByTestId("sandboxed-slide")).toBeTruthy(),
    );
    expect(mocks.sandboxProps?.initialRevealedSteps).toBe(2);
    expect(mocks.actionCalls).toHaveLength(1);
  });

  it("keeps imported HTML slides on the existing renderer", async () => {
    const importedSlide = {
      id: "slide-html",
      content: "<main>Imported slide</main>",
      notes: "",
      layout: "content",
    } as Slide;
    mocks.deck = { title: "Imported deck", slides: [importedSlide] };

    renderRoute(false, "/slide?deckId=deck-source&slideNumber=1&step=2");

    await waitFor(() => expect(screen.getByTestId("html-slide")).toBeTruthy());

    expect(mocks.htmlSlide).toBe(importedSlide);
    expect(mocks.renderCalls.every((call) => call.enabled === false)).toBe(
      true,
    );
  });

  it("ignores stale deck responses after navigation and clears the old preview", async () => {
    let resolveFirst!: (deck: unknown) => void;
    let resolveSecond!: (deck: unknown) => void;
    const firstResponse = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise<unknown>((resolve) => {
      resolveSecond = resolve;
    });
    mocks.actionResponses = [firstResponse, secondResponse];

    renderRoute(true);
    await waitFor(() => expect(mocks.actionCalls).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Next deck" }));
    await waitFor(() => expect(mocks.actionCalls).toHaveLength(2));
    expect(screen.queryByTestId("html-slide")).toBeNull();

    await act(async () => {
      resolveFirst({
        title: "Stale deck",
        slides: [{ id: "stale-slide", content: "<main>Stale</main>" }],
      });
      await firstResponse;
    });
    expect(screen.queryByTestId("html-slide")).toBeNull();

    await act(async () => {
      resolveSecond({
        title: "Current deck",
        slides: [{ id: "current-slide", content: "<main>Current</main>" }],
      });
      await secondResponse;
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("html-slide").getAttribute("data-slide-id"),
      ).toBe("current-slide"),
    );
  });

  it("clears a prior preview error after a successful route change", async () => {
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    mocks.actionResponses = [
      Promise.reject(notFound),
      Promise.resolve({
        title: "Current deck",
        slides: [{ id: "current-slide", content: "<main>Current</main>" }],
      }),
    ];

    renderRoute(true, "/slide?deckId=deck-missing&slideNumber=1");
    await waitFor(() =>
      expect(screen.getByText("raw.deckNotFound")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next deck" }));

    await waitFor(() =>
      expect(
        screen.getByTestId("html-slide").getAttribute("data-slide-id"),
      ).toBe("current-slide"),
    );
    expect(screen.queryByText("raw.deckNotFound")).toBeNull();
  });
});
