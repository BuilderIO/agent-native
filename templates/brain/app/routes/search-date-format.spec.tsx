// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    isLoading: false,
    data:
      name === "list-projects"
        ? { projects: [] }
        : {
            results: [
              ...[
                "2026-05-20T15:00:00.000Z",
                "2026-05-21T15:00:00.000Z",
                null,
                "invalid",
              ].map((capturedAt, index) => ({
                id: String(index),
                type: "capture",
                title: `Result ${index}`,
                citation: { capturedAt },
              })),
              {
                id: "detail",
                type: "knowledge",
                title: "Closed detail",
                citation: { capturedAt: "2026-05-22T15:00:00.000Z" },
              },
            ],
          },
  }),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
import Search from "./search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("reuses the citation date formatter across results and rerenders", async () => {
  const Original = Intl.DateTimeFormat;
  const expected = new Original("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  let configured = 0;
  Intl.DateTimeFormat = new Proxy(Original, {
    construct(target, args) {
      if (args[1]?.dateStyle === "medium" && args[1]?.timeStyle === "short")
        configured++;
      return Reflect.construct(target, args);
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    createElement(
      MemoryRouter,
      { initialEntries: ["/search?q=meeting"] },
      createElement(Search),
    );
  try {
    await act(async () => root.render(render()));
    const times = [...host.querySelectorAll("article time")];
    expect(times.map((time) => time.textContent)).toEqual([
      expected.format(new Date("2026-05-20T15:00:00.000Z")),
      expected.format(new Date("2026-05-21T15:00:00.000Z")),
    ]);
    await act(async () => root.render(render()));
    expect(configured).toBeLessThanOrEqual(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Intl.DateTimeFormat = Original;
  }
});
