// @vitest-environment jsdom
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const loading = vi.hoisted(() => ({ composer: false, cell: false }));
vi.mock("./lazy-route", async () => {
  const { lazy } = await import("react");
  return { lazyRoute: lazy };
});
vi.mock("./HomePageView", () => ({ HomePageView: () => null }));
vi.mock("./NotebookPage", () => ({
  NotebookPage: () => <div>Notebook shell ready</div>,
}));
vi.mock("@/components/agent", async () => {
  loading.composer = true;
  await new Promise(() => {});
});
vi.mock("@/components/notebook/NotebookCell", async () => {
  loading.cell = true;
  await new Promise(() => {});
});

import { preloadHomePage, resolveRoutePage } from "./pages";

it("A2-INTERMITTENT-ROUTE-READINESS: starts the composer with Home without blocking the page on it", async () => {
  await preloadHomePage();
  await vi.waitFor(() => expect(loading.composer).toBe(true));
});

it("A2-INTERMITTENT-ROUTE-READINESS: starts cells with the notebook route before project data exists", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const entry = resolveRoutePage({ id: "logic", view: "logic" } as never);
  expect(entry).toBeDefined();
  const Page = entry!.component;
  try {
    await act(async () => {
      root.render(
        <Suspense fallback={null}>
          <Page route={{ id: "logic", view: "logic" } as never} />
        </Suspense>,
      );
    });
    await vi.waitFor(() =>
      expect(host.textContent).toBe("Notebook shell ready"),
    );
    await vi.waitFor(() => expect(loading.cell).toBe(true));
  } finally {
    await act(async () => root.unmount());
  }
});
