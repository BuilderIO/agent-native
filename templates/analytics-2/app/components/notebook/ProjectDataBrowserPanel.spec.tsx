// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectDataBrowserPanel } from "./ProjectDataBrowserPanel";

vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function render(
  connections: Parameters<typeof ProjectDataBrowserPanel>[0]["connections"],
): string {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ items: [], endCursor: null, hasNextPage: false }),
    ),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectDataBrowserPanel connections={connections} onClose={() => {}} />
      </QueryClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    client.clear();
    host.remove();
  };
  return document.body.innerHTML;
}

describe("ProjectDataBrowserPanel", () => {
  it("explains that the workspace has no connection yet", () => {
    const html = render([]);
    expect(html).toContain("Data browser");
    expect(html).toContain("This workspace has no data connection yet.");
  });

  it("offers the connection picker and the table search", () => {
    const html = render([{ id: "conn_1", name: "QA warehouse" } as never]);
    expect(html).toContain("QA warehouse");
    expect(html).toContain("Search tables");
    expect(html).toContain("Close Data browser");
  });

  it("selects the default connection when multiple connections exist", () => {
    render([
      {
        id: "conn_1",
        name: "Non-default connection",
        isDefault: false,
      } as never,
      { id: "conn_2", name: "Default warehouse", isDefault: true } as never,
    ]);
    const select = document.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("conn_2");
  });
});
