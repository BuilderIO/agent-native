// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const transport = vi.fn();
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { ProjectDataBrowserPanel } from "./ProjectDataBrowserPanel";

vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

import type { NotebookConnection } from "./types";

const conn = (id: string): NotebookConnection => ({ id, name: id });
const page = (
  name: string,
  hasChildren = false,
  endCursor: string | null = null,
) => ({
  items: [
    { id: name, name, kind: hasChildren ? "schema" : "table", hasChildren },
  ],
  endCursor,
  hasNextPage: endCursor !== null,
});
let cleanup = () => {};
afterEach(() => {
  cleanup();
  transport.mockReset();
  vi.unstubAllGlobals();
});
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const params = Object.fromEntries(url.searchParams);
      return new Response(JSON.stringify(await transport(params)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const render = (connections: NotebookConnection[]) =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <ProjectDataBrowserPanel
            connections={connections}
            onClose={() => {}}
          />
        </QueryClientProvider>,
      ),
    );
  cleanup = () => {
    act(() => root.unmount());
    client.clear();
    host.remove();
  };
  const click = (label: string) => {
    const button = [...document.querySelectorAll("button")].find((el) =>
      el.textContent?.includes(label),
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    act(() => button.click());
  };
  return { host: document.body, client, render, click };
}

it("loads asynchronously supplied connections, preserves selection, and resets hierarchy when it disappears", async () => {
  transport.mockImplementation(async ({ connectionId, parentId }) =>
    page(
      parentId ? `${connectionId} child` : `${connectionId} root`,
      !parentId,
    ),
  );
  const { host, render, click } = setup();
  render([]);
  render([conn("one"), conn("two")]);
  await flush();
  expect(host.textContent).toContain("one root");
  const select = host.querySelector("select");
  if (!select) throw new Error("Missing connection select");
  act(() => {
    select.value = "two";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  click("two root");
  await flush();
  expect(host.textContent).toContain("two child");
  render([conn("one"), conn("two"), conn("three")]);
  await flush();
  expect(select.value).toBe("two");
  expect(host.textContent).toContain("two child");
  render([conn("one"), conn("three")]);
  await flush();
  expect(host.querySelector("select")?.value).toBe("one");
  expect(host.textContent).toContain("one root");
  expect(transport).toHaveBeenLastCalledWith({ connectionId: "one" });
  render([conn("one"), conn("two"), conn("three")]);
  await flush();
  expect(host.querySelector("select")?.value).toBe("one");
  expect(host.textContent).toContain("one root");
});

it("replaces a refetched cursor page instead of duplicating rows", async () => {
  let revision = 0;
  transport.mockImplementation(async ({ after }) =>
    after
      ? page(revision ? "updated second" : "second")
      : page("first", false, "next"),
  );
  const { host, client, render, click } = setup();
  render([conn("one")]);
  await flush();
  click("Load more");
  await flush();
  expect(host.textContent).toContain("second");
  revision++;
  await act(async () => {
    await client.refetchQueries({
      queryKey: [
        "action",
        "list-connection-datasets",
        { connectionId: "one", after: "next" },
      ],
      exact: true,
    });
  });
  await flush();
  expect(
    [...host.querySelectorAll(".nb-outline-name")].map((el) => el.textContent),
  ).toEqual(["first", "updated second"]);
});

it("report 1795064308 keeps the expanded tree visible while another page loads", async () => {
  let finishPage: (value: ReturnType<typeof page>) => void = () => {
    throw new Error("continuation did not start");
  };
  transport.mockImplementation(({ after, parentId }) => {
    if (after)
      return new Promise((resolve) => {
        finishPage = resolve;
      });
    return Promise.resolve(
      parentId ? page("child") : page("folder", true, "next"),
    );
  });
  const { host, render, click } = setup();
  render([conn("one")]);
  await flush();
  click("folder");
  await flush();
  expect(host.textContent).toContain("child");
  click("Load more");
  await flush();
  expect(host.textContent).toContain("folder");
  expect(host.textContent).toContain("child");
  await act(async () => finishPage(page("second")));
  await flush();
  expect(host.textContent).toContain("second");
  expect(host.textContent).toContain("child");
});

it("does not render a late response from the previous connection", async () => {
  let resolveOld: (value: ReturnType<typeof page>) => void = () => {
    throw new Error("old request did not start");
  };
  transport.mockImplementation(({ connectionId }) =>
    connectionId === "one"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(page("two root")),
  );
  const { host, render } = setup();
  render([conn("one"), conn("two")]);
  await flush();
  const select = host.querySelector("select");
  if (!select) throw new Error("Missing connection select");
  act(() => {
    select.value = "two";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  await act(async () => {
    resolveOld(page("stale one"));
  });
  await flush();
  expect(host.textContent).toContain("two root");
  expect(host.textContent).not.toContain("stale one");
});
