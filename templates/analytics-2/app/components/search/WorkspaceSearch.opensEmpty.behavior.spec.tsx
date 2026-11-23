// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SearchResult } from "./types";
import { WorkspaceSearch } from "./WorkspaceSearch";

const project = (id: string, title: string): SearchResult =>
  ({
    id,
    title,
    href: `/project/${id}`,
    updatedAt: "2026-11-08T10:00:00.000Z",
    kind: "project",
  }) as SearchResult;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("workspace search opens with recents", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;
  let results: SearchResult[] = [];

  beforeEach(() => {
    results = [project("p1", "Signup funnel")];
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  const render = async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <WorkspaceSearch
          filterOptions={{}}
          onClose={() => undefined}
          onNavigate={() => undefined}
          onSearch={async () => results}
          open
        />,
      );
      await wait(0);
    });
  };

  it("lists up to five recent projects under a Recents heading before anything is typed", async () => {
    results = Array.from({ length: 7 }, (_, i) =>
      project(`p${i}`, `Project ${i}`),
    );
    await render();
    const headings = Array.from(host.querySelectorAll("h3")).map(
      (node) => node.textContent,
    );
    expect(headings).toEqual(["Recents"]);
    const text = host.textContent ?? "";
    expect(text).toContain("Project 0");
    expect(text).toContain("Project 4");
    expect(text).not.toContain("Project 5");
  });

  it("still lists the matching project once the reader types", async () => {
    await render();
    const input = document.querySelector<HTMLInputElement>("input");
    await act(async () => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "signup");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await wait(400);
    });
    expect(host.textContent ?? "").toContain("Signup funnel");
  });

  it("returns focus to the opener when dismissed", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    await render();
    expect(document.activeElement).toBe(host.querySelector("input"));
    await act(async () => root?.render(null));
    expect(document.activeElement).toBe(opener);
  });
});
