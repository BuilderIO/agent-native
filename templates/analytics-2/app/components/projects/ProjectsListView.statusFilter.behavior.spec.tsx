// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { i18nCatalog } from "@/i18n";

import { ProjectsListView } from "./ProjectsListView";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

it("the status filter lists every status in the catalogue, used or not", () => {
  const names = ["Draft", "In review", "Completed", "Retired", "Blocked"];
  act(() => {
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <ProjectsListView
          status="ready"
          projects={[]}
          currentUser={{ name: "Sam", email: "sam@example.test" }}
          search=""
          onSearchChange={() => undefined}
          filterOptions={{
            statuses: names.map((name, index) => ({ id: `s${index}`, name })),
            categories: [],
          }}
        />
      </AgentNativeI18nProvider>,
    );
  });
  const filter = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Filter"),
  );
  act(() => filter?.click());
  const more = host.querySelector<HTMLButtonElement>(
    'button[aria-label="More filters"]',
  );
  act(() => more?.click());
  const listed = [
    ...host.querySelectorAll(
      '[role="menuitemcheckbox"] .ws-projects-menu-label',
    ),
  ].map((node) => node.textContent);
  expect(listed).toEqual(names);
});
