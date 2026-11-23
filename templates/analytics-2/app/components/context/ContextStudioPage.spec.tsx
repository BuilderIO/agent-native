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

vi.mock("./ContextSetupView", () => ({
  ContextSetupView: () => <main aria-label="Context setup" />,
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

it("keeps the studio header, active Setup link and backed Setup content together", () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <ContextStudioPage
        route={
          {
            id: "context-studio",
            view: "setup",
          } as never
        }
      />,
    );
  });

  const rail = container.querySelector('nav[aria-label="context.rail.label"]');
  expect(rail).not.toBeNull();
  expect(rail?.textContent).toContain("Context Studio");
  expect(
    rail?.querySelector('a[href="/context-studio/setup"][aria-current="page"]'),
  ).not.toBeNull();
  expect(
    rail?.querySelector('a[href="/context-studio/connections"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('main[aria-label="Context setup"]'),
  ).not.toBeNull();
});

// oracle-change: Context description and empty-state assertions are superseded by Setup and unavailable route coverage.

it("explains unavailable studio views instead of rendering a blank workspace", () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <ContextStudioPage
        route={{ id: "context-studio-evals", view: "evals" } as never}
      />,
    );
  });

  const main = container.querySelector("main.context-studio-content");
  expect(main?.querySelector("h1")?.textContent).toBe("context.rail.evals");
  expect(main?.textContent).toContain("context.unavailable.description");
  expect(main?.querySelector('a[href="/context-studio/setup"]')).not.toBeNull();
});
