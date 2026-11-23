// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/context/reference" }),
}));

vi.mock("@agent-native/toolkit/app/sidebar", () => ({
  useAppSidebar: () => ({ collapsed: false }),
}));

import { ContextArea } from "./ContextArea";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

// Row 122: the original keeps the studio's brand header inside the rail column
// and starts the screen's own heading at the top of the content column, rather
// than drawing a header across the whole viewport above both columns.
it("renders the studio header inside the rail column", () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <ContextArea
        header={<div data-testid="studio-header">Context Studio</div>}
      >
        <main data-testid="studio-content">Semantic models</main>
      </ContextArea>,
    );
  });

  const rail = container.querySelector('nav[aria-label="context.rail.label"]');
  expect(rail).not.toBeNull();
  expect(rail?.querySelector('[data-testid="studio-header"]')).not.toBeNull();
  const content = container.querySelector('[data-testid="studio-content"]');
  expect(
    rail?.contains(container.querySelector('[data-testid="studio-content"]')),
  ).toBe(false);
});

it("renders the footer group after the scrolling rail body, inside the rail", () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <ContextArea
        rail={<div data-testid="rail-body">Groups</div>}
        footer={<div data-testid="rail-footer">Related settings</div>}
      >
        <main>Content</main>
      </ContextArea>,
    );
  });

  const rail = container.querySelector('nav[aria-label="context.rail.label"]');
  const body = rail?.querySelector(".context-area-rail-body");
  const footer = rail?.querySelector(".context-area-rail-footer");
  expect(body?.querySelector('[data-testid="rail-body"]')).not.toBeNull();
  expect(footer?.querySelector('[data-testid="rail-footer"]')).not.toBeNull();
  expect(body?.contains(footer ?? null)).toBe(false);
  expect(
    body &&
      footer &&
      body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
