// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({
  Link: ({ to, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props} />
  ),
  useLocation: () => ({ pathname: "/context-studio/overview" }),
}));

vi.mock("./ContextSetupView", () => ({ ContextSetupView: () => null }));

vi.mock("@/components/workspace/DataConnectionsPage", () => ({
  DataConnectionsPage: () => (
    <div data-testid="connections-view">Workspace data connections</div>
  ),
}));

import { ContextStudioPage } from "./ContextStudioPage";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(view: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <ContextStudioPage route={{ id: "context-studio", view } as never} />,
    );
  });
  const rail = container.querySelector('nav[aria-label="context.rail.label"]');
  return { rail, container };
}

it("offers Context setup, Connections and related settings without unbacked destinations", () => {
  const { rail } = render("setup");
  const links = [...(rail?.querySelectorAll("a") ?? [])].map((a) =>
    a.getAttribute("href"),
  );
  expect(links).toEqual([
    "/context-studio/setup",
    "/context-studio/connections",
    "/home/data",
    "/settings/trusted-mode",
    "/settings",
  ]);
  expect(
    rail?.querySelector('[aria-current="page"]')?.getAttribute("href"),
  ).toBe("/context-studio/setup");
});

it("groups Setup under Observability and Connections under Management", () => {
  const { rail } = render("setup");
  const groups = [...(rail?.querySelectorAll(".context-rail-group") ?? [])];
  const group = (heading: string) =>
    groups.find(
      (el) =>
        el.querySelector(".context-rail-heading")?.textContent === heading,
    );
  expect(
    group("context.rail.observability")
      ?.querySelector("a")
      ?.getAttribute("href"),
  ).toBe("/context-studio/setup");
  expect(
    group("context.rail.management")?.querySelector("a")?.getAttribute("href"),
  ).toBe("/context-studio/connections");
});

it("keeps Related settings in the rail body and only Settings pinned below", () => {
  const { rail } = render("setup");
  const body = rail?.querySelector(".context-area-rail-body");
  const footer = rail?.querySelector(".context-area-rail-footer");
  const hrefs = (el: Element | null | undefined) =>
    [...(el?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
  expect(body?.textContent).toContain("Related settings");
  expect(hrefs(body)).toContain("/settings/trusted-mode");
  expect(footer?.textContent).not.toContain("Related settings");
  expect(hrefs(footer)).toEqual(["/settings"]);
});

it("opens the workspace's real connections view at its own route", async () => {
  const { container } = render("connections");
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    container.querySelector('[data-testid="connections-view"]'),
  ).not.toBeNull();
});

// oracle-change: The shell no longer exposes or resolves unbacked Context tabs.
