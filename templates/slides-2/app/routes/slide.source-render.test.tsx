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
  deck: undefined as unknown,
  getDeck: undefined as ((deckId: string) => Promise<unknown>) | undefined,
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
  htmlSlide: undefined as unknown,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  callActionWithRetry: (action: string, args: Record<string, unknown>) => {
    mocks.actionCalls.push({ action, args });
    if (mocks.getDeck) return mocks.getDeck(args.id as string);
    return Promise.resolve(mocks.deck);
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
      return createElement("div", { "data-testid": "html-slide" });
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
    SandboxedSlide: (props: { artifact: unknown }) => {
      mocks.sandboxArtifact = props.artifact;
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
  mocks.getDeck = undefined;
  mocks.renderCalls = [];
  mocks.renderQuery = { data: undefined, error: undefined, isLoading: false };
  mocks.sandboxArtifact = undefined;
  mocks.htmlSlide = undefined;
});

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/slide?deckId=deck-source&slideNumber=1"]}>
      <SlideRoute />
    </MemoryRouter>,
  );
}

function RouteWithDeckNavigation() {
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <button
        onClick={() =>
          setSearchParams({ deckId: "deck-next", slideNumber: "1" })
        }
      >
        Load next deck
      </button>
      <SlideRoute />
    </>
  );
}

function renderRouteWithNavigation(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RouteWithDeckNavigation />
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
  });

  it("keeps imported HTML slides on the existing renderer", async () => {
    const importedSlide = {
      id: "slide-html",
      content: "<main>Imported slide</main>",
      notes: "",
      layout: "content",
    } as Slide;
    mocks.deck = { title: "Imported deck", slides: [importedSlide] };

    renderRoute();

    await waitFor(() => expect(screen.getByTestId("html-slide")).toBeTruthy());

    expect(mocks.htmlSlide).toBe(importedSlide);
    expect(mocks.renderCalls.every((call) => call.enabled === false)).toBe(
      true,
    );
  });

  it("clears a previous load error when a new deck loads successfully", async () => {
    const nextSlide = {
      id: "slide-next",
      content: "<main>Next deck</main>",
      notes: "",
      layout: "content",
    } as Slide;
    mocks.getDeck = (deckId) =>
      deckId === "deck-source"
        ? Promise.reject(new Error("previous load failed"))
        : Promise.resolve({ slides: [nextSlide] });

    renderRouteWithNavigation("/slide?deckId=deck-source&slideNumber=1");

    expect(await screen.findByText("previous load failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load next deck" }));

    await waitFor(() => expect(mocks.htmlSlide).toBe(nextSlide));
    expect(screen.queryByText("previous load failed")).toBeNull();
  });

  it("ignores a stale deck load that completes after navigation", async () => {
    const staleSlide = {
      id: "slide-stale",
      content: "<main>Stale deck</main>",
      notes: "",
      layout: "content",
    } as Slide;
    const nextSlide = {
      id: "slide-next",
      content: "<main>Next deck</main>",
      notes: "",
      layout: "content",
    } as Slide;
    let resolveStaleDeck!: (deck: unknown) => void;
    mocks.getDeck = (deckId) =>
      deckId === "deck-source"
        ? new Promise((resolve) => {
            resolveStaleDeck = resolve;
          })
        : Promise.resolve({ slides: [nextSlide] });

    renderRouteWithNavigation("/slide?deckId=deck-source&slideNumber=1");
    await waitFor(() => expect(mocks.actionCalls).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Load next deck" }));

    await waitFor(() => expect(mocks.htmlSlide).toBe(nextSlide));
    await act(async () => {
      resolveStaleDeck({ slides: [staleSlide] });
      await Promise.resolve();
    });
    expect(mocks.htmlSlide).toBe(nextSlide);
  });
});
