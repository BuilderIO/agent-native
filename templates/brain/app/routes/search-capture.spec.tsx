import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  DEFAULT_LOCALE: "en",
  useOptionalLocale: () => null,
}));
import Search from "./search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const owned: { root: Root; host: HTMLElement; client: QueryClient }[] = [];
const passage = "Previously allowed transcript passage";
const allowed = {
  capture: {
    id: "capture-one",
    title: "Meeting transcript",
    content: passage,
    metadata: {},
    status: "distilled",
    sensitivityDisposition: "allowed",
    contentRedacted: true,
    rawContentIncluded: false,
    withheldPassages: 0,
  },
  source: { id: "source-one", title: "Meeting source", provider: "manual" },
  accessRole: "viewer",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount(url = "/search?captureId=capture-one") {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  client.setQueryData(
    ["action", "get-capture", { id: "capture-one" }],
    allowed,
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  owned.push({ root, host, client });
  let navigate: ReturnType<typeof useNavigate>;
  let location = "";
  function Route() {
    navigate = useNavigate();
    location = useLocation().search;
    return <Search />;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[url]}>
          <Route />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  return {
    host,
    client,
    location: () => location,
    go: async (url: string) =>
      act(async () => {
        await navigate(url);
      }),
  };
}
afterEach(async () => {
  for (const { root, host, client } of owned.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
  }
  vi.unstubAllGlobals();
});

it("unselected Search uses the real action transport without opening a capture", async () => {
  const fetchMock = vi.fn((url: RequestInfo | URL) =>
    Promise.resolve(json({ projects: [], results: [] })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const view = await mount("/search");
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes("list-projects")),
  ).toBe(true);
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes("get-capture")),
  ).toBe(false);
  expect(document.body.textContent).not.toContain(passage);
});

it.each(["revoked", "error"])(
  "reopening requires a new authorized read (%s)",
  async (outcome) => {
    const first = deferred(),
      reopened = deferred();
    let reads = 0;
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: RequestInfo | URL) => {
        if (String(url).includes("get-capture")) {
          requestedUrls.push(String(url));
          return ++reads === 1 ? first.promise : reopened.promise;
        }
        return Promise.resolve(json({ projects: [], results: [] }));
      }),
    );
    const view = await mount();
    expect(document.body.textContent).not.toContain(passage);
    expect(
      reads,
      "selected capture must perform its own read before projecting cached content",
    ).toBe(1);
    await act(async () => {
      first.resolve(json(allowed));
    });
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(passage),
    );
    await view.go("/search");
    expect(document.body.textContent).not.toContain(passage);
    await view.go("/search?captureId=capture-one");
    expect(reads).toBe(2);
    expect(requestedUrls.join(" ")).not.toContain("includeRawContent");
    expect(document.body.textContent).not.toContain(passage);
    await act(async () => {
      reopened.resolve(
        outcome === "revoked"
          ? json({ capture: null, source: null })
          : json({ error: "Read unavailable" }, 503),
      );
    });
    await vi.waitFor(() => expect(view.client.isFetching()).toBe(0));
    expect(document.body.textContent).not.toContain(passage);
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        outcome === "revoked" ? "searchPage.notAvailable" : "ops.failed",
      ),
    );
  },
);

it("hides the previous capture while a different selection is pending", async () => {
  const first = deferred(),
    second = deferred();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes("get-capture"))
        return ++reads === 1 ? first.promise : second.promise;
      return Promise.resolve(json({ projects: [], results: [] }));
    }),
  );
  const view = await mount();
  await act(async () => {
    first.resolve(json(allowed));
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain(passage));
  await view.go("/search?captureId=capture-two");
  expect(document.body.textContent).not.toContain(passage);
  await act(async () => {
    second.resolve(json({ capture: null }));
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("searchPage.notAvailable"),
  );
});

it("withholds a previously allowed body during revalidation and after revocation", async () => {
  const first = deferred(),
    revalidation = deferred();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes("get-capture"))
        return ++reads === 1 ? first.promise : revalidation.promise;
      return Promise.resolve(json({ projects: [], results: [] }));
    }),
  );
  const view = await mount();
  await act(async () => {
    first.resolve(json(allowed));
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain(passage));
  await act(async () => {
    void view.client.invalidateQueries({ queryKey: ["action", "get-capture"] });
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).not.toContain(passage),
  );
  await act(async () => {
    revalidation.resolve(json({ capture: null }));
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("searchPage.notAvailable"),
  );
  expect(document.body.textContent).not.toContain(passage);
});

it("closing a selected capture preserves the query and filters", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(json({ capture: null, projects: [], results: [] })),
    ),
  );
  const view = await mount(
    "/search?q=meeting&type=capture&provider=manual&captureId=capture-one",
  );
  const close =
    document.querySelector<HTMLButtonElement>(
      'button[data-slot="sheet-close"]',
    ) ??
    [...document.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Close"),
    );
  if (!close) throw new Error("Close button missing");
  await act(async () => close.click());
  expect(view.location()).toBe("?q=meeting&type=capture&provider=manual");
});

it("ignores a late response when selection changes during a pending read", async () => {
  const first = deferred();
  const second = deferred();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes("get-capture"))
        return ++reads === 1 ? first.promise : second.promise;
      return Promise.resolve(json({ projects: [], results: [] }));
    }),
  );
  const view = await mount();
  await view.go("/search?captureId=capture-two");
  expect(reads).toBe(2);
  await act(async () => {
    first.resolve(json(allowed));
  });
  expect(document.body.textContent).not.toContain(passage);
  await act(async () => {
    second.resolve(json({ capture: null }));
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("searchPage.notAvailable"),
  );
  expect(document.body.textContent).not.toContain(passage);
});
