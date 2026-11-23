// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

const project: Project = {
  id: "prj_focus",
  ownerEmail: "qa@workspace.test",
  title: "Revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

const mounted: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function renderView() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <ProjectsListView
          status="ready"
          projects={[project]}
          currentUser={{ name: "QA", email: "qa@workspace.test" }}
          search=""
          onSearchChange={() => {}}
          onCreateProject={() => {}}
          fixture="fixture"
          now={Date.parse("2026-11-05T12:00:00.000Z")}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  mounted.push({ container, root });
  return { container };
}

it("returns focus to Display settings trigger on Escape from inside the popover", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { container } = renderView();
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Display settings"]',
  );
  expect(trigger).not.toBeNull();
  act(() => {
    trigger!.click();
  });
  const select = container.querySelector<HTMLSelectElement>(
    ".ws-projects-popover select",
  );
  expect(select).not.toBeNull();
  act(() => {
    select!.focus();
  });
  expect(document.activeElement).toBe(select);

  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await Promise.resolve();
  });

  expect(container.querySelector(".ws-projects-popover")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  vi.unstubAllGlobals();
});

it("returns focus to Sort trigger on Escape from inside the sort menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { container } = renderView();
  const trigger = container.querySelector<HTMLButtonElement>(
    "button.ws-projects-sort-button",
  );
  expect(trigger).not.toBeNull();
  act(() => {
    trigger!.click();
  });
  const item = container.querySelector<HTMLButtonElement>(
    '.ws-projects-popover button[role="menuitemradio"]',
  );
  expect(item).not.toBeNull();
  act(() => {
    item!.focus();
  });
  expect(document.activeElement).toBe(item);

  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await Promise.resolve();
  });

  expect(container.querySelector(".ws-projects-popover")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  vi.unstubAllGlobals();
});
