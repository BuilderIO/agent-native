// @vitest-environment node
// The public deck route server-renders PresentationView. Node has no DOM at
// all, so a render that reaches DOMParser throws here the way it does in
// production.
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));

import PresentationView from "./PresentationView";

const plainSlide = `<div class="fmd-slide"><div class="text-box"><p>Plain slide</p></div></div>`;
const revealSlide = `<div class="fmd-slide"><div class="text-box"><p>One</p><p>Two</p><p>Three</p></div></div>`;

const slides = [
  { id: "plain", content: plainSlide, layout: "content" },
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
] as unknown as Slide[];

function serverRender(startIndex: number): string {
  return renderToString(
    <MemoryRouter>
      <PresentationView
        slides={slides}
        deckId="deck-1"
        startIndex={startIndex}
      />
    </MemoryRouter>,
  );
}

describe("PresentationView server render", () => {
  it("renders a deck with reveals without DOMParser and keeps the slide content", () => {
    expect(typeof DOMParser).toBe("undefined");

    const markup = serverRender(1);

    expect(markup).toContain("One");
    expect(markup).toContain("Two");
    expect(markup).toContain("Three");
    expect(markup).not.toContain("data-pstep");
  });

  it("holds a reveal slide hidden until the client has annotated its builds", () => {
    expect(serverRender(1)).toContain("visibility:hidden");
  });

  it("renders a slide without reveals visible", () => {
    const markup = serverRender(0);

    expect(markup).toContain("Plain slide");
    expect(markup).not.toContain("visibility:hidden");
  });
});
