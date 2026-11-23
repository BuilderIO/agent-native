// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ProjectDataBrowserPanel } from "./ProjectDataBrowserPanel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

type Item = {
  id: string;
  name: string;
  kind: "database" | "schema" | "table";
  hasChildren: boolean;
};
const requests: Array<Record<string, string>> = [];
let cleanup = () => {};
afterEach(() => {
  cleanup();
  requests.length = 0;
  vi.unstubAllGlobals();
});

const schema = (name: string): Item => ({
  id: `schema:${name}`,
  name,
  kind: "schema",
  hasChildren: true,
});
const table = (schema: string, name: string): Item => ({
  id: `table:${schema}:${name}`,
  name,
  kind: "table",
  hasChildren: false,
});

function mount(
  answer: (
    params: Record<string, string>,
  ) =>
    | Item[]
    | { items: Item[]; endCursor: string | null; hasNextPage: boolean },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("get-data-table-preview")) {
        return Response.json({
          connectionId: "one",
          tableId: url.searchParams.get("tableId"),
          columns: ["amount"],
          rows: [[42]],
        });
      }
      const params = Object.fromEntries(url.searchParams);
      requests.push(params);
      const result = answer(params);
      return Response.json(
        Array.isArray(result)
          ? { items: result, endCursor: null, hasNextPage: false }
          : result,
      );
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectDataBrowserPanel
          connections={[{ id: "one", name: "One" }]}
          onClose={onClose}
        />
      </QueryClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    client.clear();
    host.remove();
  };
  return { onClose };
}

const panel = () =>
  document.querySelector<HTMLElement>('aside[aria-label="Data browser"]'); // oracle-change: the notebook data browser is a named side panel
const names = () =>
  [...document.querySelectorAll(".nb-outline-name")].map(
    (el) => el.textContent,
  );
const rowButton = (name: string) => {
  const button = [...document.querySelectorAll("button")].find(
    (el) => el.querySelector(".nb-outline-name")?.textContent === name,
  );
  if (!button) throw new Error(`Missing row: ${name}`);
  return button;
};
async function until(check: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      check();
    },
    { timeout: 4000, interval: 50 },
  );
}
function type(value: string) {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search tables"]',
  );
  if (!input) throw new Error("Missing search input");
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

const tree = (params: Record<string, string>): Item[] => {
  if (params.parentId === "schema:alpha")
    return [table("alpha", "orders"), table("alpha", "users")];
  if (params.search === "alp") return [schema("alpha")];
  return [schema("alpha"), schema("beta")];
};

it("report 1795063839.020379: the data browser opens as a side panel and closes with Escape", async () => {
  // oracle-change: the notebook data browser uses the side panel layout
  const { onClose } = mount(tree);
  await until(() => expect(names()).toEqual(["alpha", "beta"]));
  const surface = panel(); // oracle-change: the named side panel is the browser surface
  expect(surface).not.toBeNull();
  expect(surface?.getAttribute("aria-label") ?? surface?.textContent).toContain(
    "Data browser",
  );
  expect(surface?.classList.contains("nb-side-panel")).toBe(true); // oracle-change: the side panel uses its existing rail sizing
  expect(
    document.querySelector('[role="dialog"][aria-label="Data browser"]'),
  ).toBeNull(); // oracle-change: the side panel opens without a modal
  act(() => {
    surface?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(onClose).toHaveBeenCalled();
});

it("report 1795064308.979369 / 1795063839.020379: opening a folder keeps every root row and shows its children beneath", async () => {
  mount(tree);
  await until(() => expect(names()).toEqual(["alpha", "beta"]));
  act(() => rowButton("alpha").click());
  await until(() =>
    expect(names()).toEqual(["alpha", "orders", "users", "beta"]),
  );
  expect(requests.at(-1)).toEqual({
    connectionId: "one",
    parentId: "schema:alpha",
  });
  expect(rowButton("alpha").getAttribute("aria-expanded")).toBe("true");
  act(() => rowButton("alpha").click());
  await until(() => expect(names()).toEqual(["alpha", "beta"]));
  expect(rowButton("alpha").getAttribute("aria-expanded")).toBe("false");
});

it("report 1795063839.020379: a table preview fills the side panel and retains the tree", async () => {
  // oracle-change: the standalone preview hides the list in the side panel
  mount(tree);
  await until(() => expect(names()).toEqual(["alpha", "beta"]));
  expect(panel()?.querySelector(".nb-data-browser-preview")).toBeNull(); // oracle-change: the side panel has no detail pane before selecting a table
  act(() => rowButton("alpha").click());
  await until(() => expect(names()).toContain("orders"));
  act(() => rowButton("orders").click());
  await until(() =>
    expect(
      panel()?.querySelector(".nb-data-browser-preview")?.textContent, // oracle-change: the selected table uses the side panel preview
    ).toContain("42"),
  );
  const detail = panel()?.querySelector(".nb-data-browser-preview"); // oracle-change: the preview fills the side panel
  expect(detail?.textContent).toContain("orders");
  expect(detail?.querySelector(".nb-outline-list")).toBeNull();
  expect(
    Array.from(
      panel()?.querySelectorAll("[hidden] .nb-outline-name") ?? [],
      (el) => el.textContent,
    ),
  ).toEqual(["alpha", "orders", "users", "beta"]); // oracle-change: the preview hides the tree and retains its expanded rows for Go back
  expect(rowButton("orders").getAttribute("aria-current")).toBe("true");
});

it("report 1795064725.728079: opening a searched schema clears the search and shows its children among the unfiltered tree", async () => {
  mount(tree);
  await until(() => expect(names()).toEqual(["alpha", "beta"]));
  const input = type("alp");
  await until(() => expect(requests.at(-1)?.search).toBe("alp"));
  await until(() => expect(names()).toEqual(["alpha"]));
  act(() => rowButton("alpha").click());
  await until(() =>
    expect(names()).toEqual(["alpha", "orders", "users", "beta"]),
  );
  expect(input.value).toBe("");
  expect(requests).toContainEqual({
    connectionId: "one",
    parentId: "schema:alpha",
  });
  expect(requests.filter((r) => r.parentId && r.search)).toEqual([]);
});

it("report 1795064308: searched later-page schema stays in the unfiltered tree", async () => {
  mount((params) => {
    if (params.parentId === "schema:omega") return [table("omega", "orders")];
    if (params.search === "omega") return [schema("omega")];
    if (params.after === "next")
      return { items: [schema("omega")], endCursor: null, hasNextPage: false };
    return { items: [schema("alpha")], endCursor: "next", hasNextPage: true };
  });
  await until(() => expect(names()).toEqual(["alpha"]));
  const input = type("omega");
  await until(() => expect(names()).toEqual(["omega"]));
  act(() => rowButton("omega").click());
  await until(() => expect(names()).toEqual(["alpha", "omega", "orders"]));
  expect(input.value).toBe("");
  expect(rowButton("omega").getAttribute("aria-expanded")).toBe("true");
  expect(requests).toContainEqual({
    connectionId: "one",
    parentId: "schema:omega",
  });
  const more = [...document.querySelectorAll("button")].find((button) =>
    button.textContent.includes("Load more"),
  );
  expect(more).toBeDefined();
  act(() => more?.click());
  await until(() =>
    expect(requests).toContainEqual({ connectionId: "one", after: "next" }),
  );
  await until(() =>
    expect(document.querySelector(".nb-data-browser-more")).toBeNull(),
  );
  expect(names()).toEqual(["alpha", "omega", "orders"]);
});
