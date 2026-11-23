// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  sourceUrl: undefined as string | undefined,
  capturedAt: undefined as string | undefined,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => "Action failed",
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: (name: string) =>
    name === "list-intelligence"
      ? {
          data: {
            records: [
              {
                id: "action-one",
                title: "Send the launch notes",
                body: "Prepare the agreed launch notes.",
                kind: "action",
                status: "open",
                owner: null,
                dueDate: null,
                revision: 1,
                verification: { state: "unverified" },
                evidence: [
                  {
                    captureId: "capture-one",
                    captureTitle: "Launch meeting transcript",
                    quote: "Send the launch notes.",
                    sourceUrl: fixture.sourceUrl,
                    capturedAt: fixture.capturedAt,
                  },
                ],
              },
            ],
            hasMore: false,
          },
        }
      : {},
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "" }),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));
import Route from "./intelligence";
function render() {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/intelligence?tab=actions"] },
      createElement(Route),
    ),
  );
  return host;
}
afterEach(() => {
  fixture.sourceUrl = undefined;
  fixture.capturedAt = undefined;
});
it("a transcript citation without an external URL opens its saved capture", () => {
  const host = render();
  expect(host.querySelector("blockquote")?.textContent).toBe(
    "Send the launch notes.",
  );
  const evidence = host.querySelector("details");
  const destination = [...(evidence?.querySelectorAll("a,button") ?? [])].find(
    (node) => node.textContent === "Launch meeting transcript",
  );
  expect(
    destination,
    "a citation title must provide an operable destination to its saved transcript",
  ).toBeDefined();
  expect(destination?.getAttribute("href")).toBe(
    "/search?captureId=capture-one",
  );
});
it("displays the supplied meeting time on the citation", () => {
  fixture.capturedAt = "2026-05-20T15:00:00.000Z";
  expect(render().querySelector("details time")?.getAttribute("datetime")).toBe(
    fixture.capturedAt,
  );
});
it("external HTTP citation retains the exact source destination", () => {
  fixture.sourceUrl = "https://example.test/meeting/launch";
  const host = render();
  const link = host.querySelector("details a");
  expect(link?.textContent).toBe("Launch meeting transcript");
  expect(link?.getAttribute("href")).toBe(fixture.sourceUrl);
});

it("uses the capture destination for an unsafe external URL", () => {
  fixture.sourceUrl = "javascript:alert(1)";
  const link = render().querySelector("details a");
  expect(link?.getAttribute("href")).toBe("/search?captureId=capture-one");
});
