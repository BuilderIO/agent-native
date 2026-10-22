// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const embed = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("@agent-native/core/client/host", () => ({
  getEmbedAuthToken: () => embed.token,
}));
vi.mock("@/components/editor/SuggestionReviewCard", () => ({
  SuggestionReviewCard: (props: {
    documentId: string;
    suggestionIds: string[];
  }) => <div data-card={props.documentId}>{props.suggestionIds.join("|")}</div>,
}));

import SuggestionReviewPage, {
  suggestionReviewIds,
} from "./suggestions.$documentId";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  embed.token = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function open(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/suggestions/:documentId", element: <SuggestionReviewPage /> },
      { path: "/page/:id", element: <div data-page /> },
    ],
    { initialEntries: [path] },
  );
  act(() => root.render(<RouterProvider router={router} />));
  return router;
}

describe("suggestion review route", () => {
  it("reads each suggestion id once", () => {
    expect(suggestionReviewIds("a, b,,a")).toEqual(["a", "b"]);
    expect(suggestionReviewIds(null)).toEqual([]);
  });

  it("shows the card to a host that embeds it", () => {
    embed.token = "scoped-embed-ticket";
    open("/suggestions/doc-1?ids=s1,s2");

    expect(host.querySelector("[data-card='doc-1']")?.textContent).toBe(
      "s1|s2",
    );
  });

  it("sends a browser tab to the first suggestion on its page", () => {
    const router = open("/suggestions/doc-1?ids=s1,s2");

    expect(host.querySelector("[data-page]")).not.toBeNull();
    expect(router.state.location.pathname).toBe("/page/doc-1");
    expect(router.state.location.search).toBe("?suggestion=s1");
  });
});
