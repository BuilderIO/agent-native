// @vitest-environment happy-dom

import { trackEvent } from "@agent-native/core/client/analytics";
import type { SharedDeckResponse } from "@shared/api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: () => ({ data: { status: "ok", deck } }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-deck-design-system", () => ({
  mergeDesignSystemData: (data: unknown) => data,
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));
vi.mock("@/lib/slides-relay-tracking", () => ({ trackSlidesRelay: vi.fn() }));
vi.mock("@/components/presentation/present-channel", () => ({
  openPresentChannel: () => null,
  presentChannelSupported: () => true,
}));

// The real SlideRenderer sanitizes and injects the stored HTML. This stand-in
// injects it as-is so the build attributes reach the DOM the runtime queries.
vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: { id: string; content: string } }) => (
    <div
      data-testid={`rendered-${slide.id}`}
      dangerouslySetInnerHTML={{ __html: slide.content }}
    />
  ),
}));

import { trackSlidesRelay } from "@/lib/slides-relay-tracking";

import SharedPresentation, { PresentationLinkDeck } from "./SharedPresentation";

const revealSlide = `<div class="fmd-slide"><div class="text-box"><p>One</p><p>Two</p><p>Three</p></div></div>`;

const deck = {
  title: "Reveal deck",
  slides: [
    { id: "plain", content: "", layout: "content" },
    {
      id: "reveal",
      content: revealSlide,
      layout: "content",
      animations: [
        {
          id: "body",
          elementIndex: 0,
          elementPath: [0],
          byParagraph: true,
          type: "fade",
        },
      ],
    },
    { id: "after", content: "", layout: "content" },
  ],
} as unknown as SharedDeckResponse;

function tree(url: string) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/share/:token"
          element={<SharedPresentation initialDeck={deck} />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function revealParagraphs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-pstep]"),
  ).sort(
    (a, b) =>
      Number(a.getAttribute("data-pstep")) -
      Number(b.getAttribute("data-pstep")),
  );
}

function LiveDeck() {
  const { id } = useParams<{ id: string }>();
  return <PresentationLinkDeck deckId={id ?? ""} />;
}

function Location() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderLiveDeck() {
  return render(
    <MemoryRouter initialEntries={["/p/example-deck?slide=2"]}>
      <Location />
      <Routes>
        <Route path="/p/:id" element={<LiveDeck />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("live presentation exit", () => {
  it("returns an anonymous viewer to the public landing page on exit click", () => {
    renderLiveDeck();
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(trackEvent).toHaveBeenCalledWith("presented", {
      output_type: "deck",
      slide_count: 3,
      is_shared: true,
    });
    expect(trackSlidesRelay).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "presentation.exitPresentation" }),
    );

    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("returns an anonymous viewer to the public landing page on Escape", () => {
    renderLiveDeck();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("returns to the same public landing page when the browser exits fullscreen", async () => {
    const requestDescriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "requestFullscreen",
    );
    const elementDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenElement",
    );
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = document.documentElement;
      }),
    });
    try {
      renderLiveDeck();
      await act(async () => {});
      expect(fullscreenElement).not.toBeNull();

      await act(async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      });

      expect(screen.getByTestId("location").textContent).toBe("/");
    } finally {
      if (requestDescriptor)
        Object.defineProperty(
          document.documentElement,
          "requestFullscreen",
          requestDescriptor,
        );
      else
        Reflect.deleteProperty(document.documentElement, "requestFullscreen");
      if (elementDescriptor)
        Object.defineProperty(document, "fullscreenElement", elementDescriptor);
      else Reflect.deleteProperty(document, "fullscreenElement");
    }
  });
});

describe("snapshot presentation exit", () => {
  it.each(["click", "Escape"])(
    "returns to the snapshot link on %s",
    (method) => {
      render(
        <MemoryRouter initialEntries={["/share/snapshot-token?slide=2"]}>
          <Location />
          <Routes>
            <Route
              path="/share/:token"
              element={<SharedPresentation initialDeck={deck} />}
            />
          </Routes>
        </MemoryRouter>,
      );

      if (method === "click") {
        fireEvent.click(
          screen.getByRole("button", { name: "presentation.exitPresentation" }),
        );
      } else {
        fireEvent.keyDown(window, { key: "Escape" });
      }

      expect(screen.getByTestId("location").textContent).toBe(
        "/share/snapshot-token",
      );
    },
  );
});

describe("SharedPresentation deep link", () => {
  it("server markup is the same shell whatever the ?slide= query", () => {
    const markup = renderToStaticMarkup(tree("/share/snapshot-token?slide=2"));

    expect(markup).toContain("1 / 3");
    expect(markup).not.toContain("2 / 3");
  });

  it("opens ?slide=2 on slide 2 with its reveals hidden", () => {
    render(tree("/share/snapshot-token?slide=2"));

    expect(screen.getByText("2 / 3")).toBeTruthy();
    const paragraphs = revealParagraphs();
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) {
      expect(paragraph.getAttribute("data-pstep-state")).toBe("hidden");
    }
  });

  it("hydrates the shell without a mismatch, then opens ?slide=2", async () => {
    // Hydration needs renderToString's text-node comments, not the static markup.
    const shell = renderToString(tree("/share/snapshot-token?slide=2"));
    const host = document.createElement("div");
    host.innerHTML = shell;
    document.body.appendChild(host);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(host, tree("/share/snapshot-token?slide=2"));
      });

      expect(consoleError).not.toHaveBeenCalled();
      expect(screen.getByText("2 / 3")).toBeTruthy();
      for (const paragraph of revealParagraphs()) {
        expect(paragraph.getAttribute("data-pstep-state")).toBe("hidden");
      }
    } finally {
      await act(async () => root?.unmount());
      consoleError.mockRestore();
      host.remove();
    }
  });

  it("opens the first slide without a ?slide= query", () => {
    render(tree("/share/snapshot-token"));

    expect(screen.getByText("1 / 3")).toBeTruthy();
  });
});
