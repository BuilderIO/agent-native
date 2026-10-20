// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChapterList } from "./chapter-list";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const editsWithCut = JSON.stringify({
  version: 1,
  trims: [{ startMs: 10_000, endMs: 20_000, excluded: true }],
  blurs: [],
});

const chapters = [
  { startMs: 0, title: "Intro" },
  { startMs: 15_000, title: "Cut away" },
  { startMs: 65_000, title: "Demo" },
];

const baseProps = {
  recordingId: "rec_1",
  mediaUpdatedAt: "2026-10-19T00:00:00.000Z",
  updatedAt: "2026-10-19T00:00:00.000Z",
  canEdit: false,
  onSeek: () => {},
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(element: React.ReactElement) {
  act(() => root.render(element));
}

function rows() {
  return Array.from(container.querySelectorAll("li button")).map(
    (button) => button.textContent,
  );
}

describe("ChapterList", () => {
  it("shows times as the trimmed player does and leaves out chapters in a cut", () => {
    render(
      <ChapterList
        {...baseProps}
        chapters={chapters}
        editsJson={editsWithCut}
      />,
    );
    expect(container.querySelector("h3")?.textContent).toBe("chapters.title");
    // The space keeps a screen reader from reading "0:55Demo" as one word.
    expect(rows()).toEqual(["0:00 Intro", "0:55 Demo"]);
  });

  it("seeks to the chapter's stored time when a row is clicked", () => {
    const onSeek = vi.fn();
    render(
      <ChapterList
        {...baseProps}
        chapters={chapters}
        editsJson={editsWithCut}
        onSeek={onSeek}
      />,
    );
    const demo = container.querySelectorAll<HTMLButtonElement>("li button")[1];
    act(() => demo.click());
    expect(onSeek).toHaveBeenCalledWith(65_000);
  });

  it("renders nothing without chapters", () => {
    render(<ChapterList {...baseProps} chapters={[]} editsJson={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when every chapter falls inside a cut", () => {
    render(
      <ChapterList
        {...baseProps}
        chapters={[{ startMs: 12_000, title: "Hidden" }]}
        editsJson={editsWithCut}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("opens the edit box with the times the rows show", () => {
    render(
      <ChapterList
        {...baseProps}
        canEdit
        chapters={chapters}
        editsJson={editsWithCut}
      />,
    );
    const edit = container.querySelector<HTMLButtonElement>(
      'button[aria-label="chapterList.editLabel"]',
    );
    act(() => edit!.click());
    expect(container.querySelector("textarea")?.value).toBe(
      "0:00 Intro\n0:55 Demo",
    );
  });
});
