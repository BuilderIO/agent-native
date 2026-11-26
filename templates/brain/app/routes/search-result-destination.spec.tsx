// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  type: "capture",
  capturedAt: undefined as string | undefined,
  updatedAt: undefined as string | undefined,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string, args: { id?: string }) => ({
    isError: false,
    isLoading: false,
    isFetching: false,
    data:
      name === "get-capture"
        ? {
            capture: {
              id: args.id,
              title: "Selected meeting transcript",
              content: "Approved transcript passage for " + args.id,
              metadata: {},
              status: "distilled",
              sensitivityDisposition: "allowed",
              contentRedacted: true,
              rawContentIncluded: false,
              withheldPassages: 0,
            },
            source: {
              id: "source-one",
              title: "Meeting source",
              provider: "manual",
            },
            accessRole: "viewer",
          }
        : name === "list-projects"
          ? { projects: [] }
          : {
              results: [
                {
                  id: "capture-one",
                  type: fixture.type,
                  title: "Meeting result",
                  snippet: "Approved excerpt",
                  provider: "manual",
                  capturedAt: fixture.updatedAt,
                  citation: fixture.capturedAt
                    ? { capturedAt: fixture.capturedAt }
                    : undefined,
                  updatedAt: fixture.updatedAt,
                },
              ],
            },
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  DEFAULT_LOCALE: "en",
  useOptionalLocale: () => null,
}));
import Search from "./search";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Root[] = [];
async function mount(url: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(Search),
      ),
    );
  });
  return { root, host };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  fixture.capturedAt = undefined;
  fixture.updatedAt = undefined;
});
it("renders a trusted raw capture time but not an import timestamp as a meeting time", async () => {
  fixture.type = "capture";
  fixture.capturedAt = "2026-05-20T15:00:00.000Z";
  fixture.updatedAt = "2026-11-20T15:00:00.000Z";
  await mount("/search?q=meeting");
  expect(document.querySelector("article time")?.getAttribute("datetime")).toBe(
    fixture.capturedAt,
  );
});
it("does not use an update timestamp when the capture time is absent", async () => {
  fixture.type = "capture";
  fixture.updatedAt = "2026-11-20T15:00:00.000Z";
  await mount("/search?q=meeting");
  expect(document.querySelector("article time")).toBeNull();
});
it.each(["capture", "knowledge", "source"])(
  "%s search result offers its exact internal destination",
  async (type) => {
    fixture.type = type;
    await mount("/search?q=meeting");
    expect(document.body.textContent).toContain("Meeting result");
    const expected =
      type === "capture"
        ? "/search?q=meeting&captureId=capture-one"
        : type === "knowledge"
          ? "/knowledge?knowledgeId=capture-one"
          : "/sources?sourceId=capture-one";
    const destinations = [...document.querySelectorAll("a")].map((anchor) =>
      anchor.getAttribute("href"),
    );
    expect(destinations).toContain(expected);
  },
);
