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

describe("workspace search shows quick matches while the full read runs", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  const type = async (text: string) => {
    const input = document.querySelector<HTMLInputElement>("input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, text);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await wait(400);
    });
  };

  it("lists partial results before the full search settles, then the full set", async () => {
    let finish: (rows: SearchResult[]) => void = () => undefined;
    const onSearch = (
      query: { text: string },
      onPartial?: (rows: SearchResult[]) => void,
    ) => {
      if (query.text === "") return Promise.resolve([] as SearchResult[]);
      onPartial?.([project("p1", "Signup funnel")]);
      return new Promise<SearchResult[]>((resolve) => {
        finish = resolve;
      });
    };
    await act(async () => {
      root = createRoot(host);
      root.render(
        <WorkspaceSearch
          filterOptions={{}}
          onClose={() => undefined}
          onNavigate={() => undefined}
          onSearch={onSearch}
          open
        />,
      );
      await wait(0);
    });
    await type("signup");
    expect(host.textContent ?? "").toContain("Signup funnel");
    expect(host.textContent ?? "").not.toContain("Signup cohorts");

    await act(async () => {
      finish([project("p1", "Signup funnel"), project("p2", "Signup cohorts")]);
      await wait(0);
    });
    expect(host.textContent ?? "").toContain("Signup funnel");
    expect(host.textContent ?? "").toContain("Signup cohorts");
  });
});
