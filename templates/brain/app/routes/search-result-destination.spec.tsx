// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ type: "capture" }));

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
                },
              ],
            },
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "" }),
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
